import {CONSENT_VERSION} from "../packages/core/assessment-policy";
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
const db = new PrismaClient(),
  base = "http://localhost:3000",
  catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Local test only");
const fixture = "qa-new-forms-" + Date.now();
let cookie = "";
const calls: string[] = [];
async function req(path: string, body?: any, expected = 200) {
  const r = await fetch(base + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map((s) => s.split(";")[0]).join("; ");
  const data = await r.json().catch(() => null);
  assert(
    [expected, expected === 200 ? 201 : expected].includes(r.status),
    path + " " + r.status + " " + JSON.stringify(data),
  );
  return data;
}
try {
  const template = await db.testAssignment.findFirstOrThrow({
    where: { membership: { user: { email: "employee@assessflow.local" } } },
  });
  await db.user.create({
    data: {
      id: fixture,
      name: "QA новые формы",
      email: fixture + "@assessflow.local",
      emailVerified: true,
      mustChangePassword: false,
      accounts: {
        create: {
          accountId: fixture,
          providerId: "credential",
          password: await hashPassword("QA-forms!2026"),
        },
      },
      memberships: {
        create: {
          id: fixture,
          organizationId: template.organizationId,
          role: "employee",
          consentAt: new Date(),consentVersion:CONSENT_VERSION,
        },
      },
    },
  });
  for (const m of catalog)
    await db.testAssignment.create({
      data: {
        organizationId: template.organizationId,
        membershipId: fixture,
        campaignId: template.campaignId,
        testVersionId: m.id + "-v2",
        expertId: template.expertId,
      },
    });
  await req("/auth/sign-in/email", {
    email: fixture + "@assessflow.local",
    password: "QA-forms!2026",
  });
  const assignments = await req(
    "/my/assignments?campaignId=" + template.campaignId,
  );
  const expertId = fixture + "-expert";
  await db.user.create({
    data: {
      id: expertId,
      name: "QA эксперт",
      email: expertId + "@assessflow.local",
      emailVerified: true,
      mustChangePassword: false,
      accounts: {
        create: {
          accountId: expertId,
          providerId: "credential",
          password: await hashPassword("QA-forms!2026"),
        },
      },
      memberships: {
        create: {
          id: expertId,
          organizationId: template.organizationId,
          role: "expert",
        },
      },
    },
  });
  await db.testAssignment.updateMany({
    where: { membershipId: fixture },
    data: { expertId },
  });
  assert.equal(assignments.length, 6);
  for (const m of catalog) {
    const a = assignments.find((x: any) => x.testVersion.testId === m.id);
    const { id } = await req("/assignments/" + a.id + "/start", {
      language: "ru",
    });
    let attempt = await req("/attempts/" + id);
    assert.equal(attempt.timerStartedAt, null);
    assert.equal(attempt.expiresAt, null);
    assert(
      !JSON.stringify(attempt).includes('"correct"') ||
        m.delivery.practice.length > 0,
    );
    assert(!attempt.config);
    await req("/attempts/" + id + "/presence", { action: "begin" });
    attempt = await req("/attempts/" + id);
    assert(attempt.timerStartedAt);
    assert.equal(Boolean(attempt.expiresAt), Boolean(m.timeLimitSeconds));
    const answers = Object.fromEntries(
      m.questions.map((q: any) => {
        const k = m.config.items[q.id];
        return [
          q.id,
          k.correct ??
            (q.type === "sjt"
              ? { most: k.most, least: k.least }
              : q.type === "ranking"
                ? {
                    top: q.options.slice(0, 3).map((o: any) => o.id),
                    bottom: q.options.slice(3, 6).map((o: any) => o.id),
                  }
                : k.control === "К1"
                  ? 2
                  : k.control === "К2"
                    ? 4
                    : 3),
        ];
      }),
    );
    if (m.id === "personality") answers["personality-v2-К1"] = 1;
    for (const q of m.questions) {
      await req("/attempts/" + id + "/answers", {
        questionId: q.id,
        value: answers[q.id],
        revision: 0,
        durationMs: 5000,
      });
    }
    // Stale autosave revisions cannot overwrite a later answer.
    const q = m.questions[0];
    await req(
      "/attempts/" + id + "/answers",
      { questionId: q.id, value: answers[q.id], revision: 0 },
      409,
    );
    const one = await req("/attempts/" + id + "/submit", {}),
      two = await req("/attempts/" + id + "/submit", {});
    assert.equal(one.resultId, two.resultId);
    const result = await db.testResult.findUniqueOrThrow({
      where: { id: one.resultId },
    });
    if (m.algorithm !== "scales")
      assert.equal(
        (result.result as any).total,
        m.questions.length * (m.algorithm === "sjt" ? 2 : 1),
      );
    if (m.id === "logical") {
      const response = await fetch(base + attempt.questions[0].imageUrl, {
        headers: { Cookie: cookie },
      });
      assert.equal(response.status, 200);
    }
    calls.push(
      m.id +
        ": preparation, timer, autosave, revision conflict, idempotent scoring OK",
    );
  }
  const personality = await db.testResult.findFirstOrThrow({
    where: {
      attempt: {
        assignment: { membershipId: fixture, testVersionId: "personality-v2" },
      },
    },
  });
  assert.equal((personality.result as any).reviewRequired, true);
  await req("/people/" + fixture + "?campaignId=" + template.campaignId, undefined, 403);
  await req(
    "/results/" + personality.id + "/quality-review",
    { action: "accept", reason: "Проверено на интервью" },
    403,
  );
  const employeeCookie = cookie;
  await req("/auth/sign-in/email", {
    email: expertId + "@assessflow.local",
    password: "QA-forms!2026",
  });
  await req("/results/" + personality.id + "/quality-review", {
    action: "accept",
    reason: "Контрольные ответы проверены в интервью",
  });
  const view = await req("/people/" + fixture + "?campaignId=" + template.campaignId);
  const profile = view.assignments.find(
    (a: any) => a.testVersion.testId === "personality",
  ).attempts[0].results[0].result;
  assert(profile.scales);
  assert.equal(profile.reviewRequired, false);
  cookie = employeeCookie;
  await req("/people/" + fixture + "?campaignId=" + template.campaignId, undefined, 403);
  await req("/generated-reports?campaignId=" + template.campaignId, undefined, 403);
  await req("/generated-reports", { campaignId: template.campaignId, membershipId: fixture, kind: "individual", language: "ru" }, 403);
  await req("/ai/generate", { campaignId: template.campaignId, membershipId: fixture }, 403);
  calls.push("Expert-only review; employee result access and report generation denied OK");
  // Reuse a QA assignment after removing only its completed QA attempt.
  const a = assignments.find((x: any) => x.testVersion.testId === "verbal");
  const old = await db.testAttempt.findMany({ where: { assignmentId: a.id } });
  await db.testResult.deleteMany({
    where: { attemptId: { in: old.map((x) => x.id) } },
  });
  await db.userAnswer.deleteMany({
    where: { attemptId: { in: old.map((x) => x.id) } },
  });
  await db.testAttempt.deleteMany({ where: { assignmentId: a.id } });
  const { id } = await req("/assignments/" + a.id + "/start", {
    language: "ru",
  });
  await req("/attempts/" + id + "/presence", { action: "begin" });
  const past = new Date(Date.now() - 30000);
  await db.testAttempt.update({
    where: { id },
    data: { lastHeartbeatAt: past },
  });
  let paused = await req("/attempts/" + id);
  assert.equal(paused.pausedAt,null);
  const before = new Date(paused.expiresAt).getTime();
  await req("/attempts/" + id + "/presence", { action: "heartbeat" });
  paused = await req("/attempts/" + id);
  assert.equal(paused.pausedAt, null);
  assert.equal(new Date(paused.expiresAt).getTime(),before);
  await req("/attempts/" + id + "/presence", { action: "leave" });
  assert.equal(
    (await db.testAttempt.findUniqueOrThrow({ where: { id } })).departures,
    1,
  );
  await req("/attempts/" + id + "/answers", {
    questionId: "verbal-v2-1",
    value: "verbal-v2-1-A",
    revision: 0,
    durationMs: 5000,
  });
  await db.testAttempt.update({
    where: { id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const settled = await req("/attempts/" + id);
  assert.equal(settled.status, "completed");
  const result = await db.testResult.findFirstOrThrow({
    where: { attemptId: id },
  });
  assert.equal((result.result as any).total, 1);
  assert.equal((result.result as any).maximum, 30);
  calls.push(
    "Timeout scores saved answers; continuous server deadline and voluntary leave OK",
  );
  console.log(calls.join("\n"));
} finally {
  const assignments = await db.testAssignment.findMany({
    where: { membershipId: fixture },
    select: { id: true },
  });
  const attempts = await db.testAttempt.findMany({
    where: { assignmentId: { in: assignments.map((x) => x.id) } },
    select: { id: true },
  });
  const ids = attempts.map((x) => x.id);
  await db.testResult.deleteMany({ where: { attemptId: { in: ids } } });
  await db.userAnswer.deleteMany({ where: { attemptId: { in: ids } } });
  await db.testAttempt.deleteMany({ where: { id: { in: ids } } });
  await db.testAssignment.deleteMany({ where: { membershipId: fixture } });
  await db.membership.deleteMany({
    where: { id: { in: [fixture, fixture + "-expert"] } },
  });
  await db.user.deleteMany({
    where: { id: { in: [fixture, fixture + "-expert"] } },
  });
  await db.$disconnect();
}
