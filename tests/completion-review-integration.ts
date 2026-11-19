import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { chromium, request, expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { CONSENT_VERSION } from "../packages/core/assessment-policy";

if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Local verification only");
const db = new PrismaClient(),
  base = "http://localhost:3000",
  id = `qa-completion-${Date.now()}`,
  password = "Review-check!2026";
const browser = await chromium.launch(),
  employee = await browser.newContext(),
  admin = await request.newContext();
const page = await employee.newPage(),
  checks: string[] = [],
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
async function call(
  client: any,
  path: string,
  data?: any,
  status = data === undefined ? 200 : 201,
) {
  const res = await client.fetch(base + "/api" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { Origin: base },
    data,
  });
  assert.equal(
    res.status(),
    status,
    `${path}: ${(await res.text()).slice(0, 300)}`,
  );
  return res.json();
}
const api = (path: string, data?: any, status?: number) =>
  call(employee.request, path, data, status);
const mark = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  await db.organization.create({
    data: {
      id,
      slug: id,
      name: "Проверка полноты ответов",
      aiBudget: 0,
      matrixConfig: {},
    },
  });
  for (const role of ["employee", "admin"]) {
    await db.user.create({
      data: {
        id: id + role,
        name: "Проверка " + role,
        email: id + role + "@assessflow.local",
        emailVerified: true,
        mustChangePassword: false,
        accounts: {
          create: {
            accountId: id + role,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
        memberships: { create: { id: id + role, organizationId: id, role } },
      },
    });
  }
  await db.campaign.create({
    data: {
      id,
      organizationId: id,
      name: "Проверка полноты",
      endsAt: new Date(Date.now() + 86400000),
    },
  });
  for (const test of [
    "verbal",
    "numerical",
    "logical",
    "personality",
    "motivation",
    "situations",
  ])
    await db.testAssignment.create({
      data: {
        id: id + test,
        organizationId: id,
        campaignId: id,
        membershipId: id + "employee",
        testVersionId: test + "-v2",
      },
    });
  await api(
    "/auth/sign-in/email",
    { email: id + "employee@assessflow.local", password },
    200,
  );
  await call(
    admin,
    "/auth/sign-in/email",
    { email: id + "admin@assessflow.local", password },
    200,
  );
  await api("/my/assignments", undefined, 403);
  await page.goto(base + "/cabinet");
  await expect(
    page.getByRole("heading", { name: "Согласие на обработку данных" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Принять и продолжить" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Принять и продолжить" }).click();
  await expect(
    page.getByRole("heading", { name: "Согласие на обработку данных" }),
  ).toBeHidden();
  assert.equal(
    (await db.membership.findUniqueOrThrow({ where: { id: id + "employee" } }))
      .consentVersion,
    CONSENT_VERSION,
  );
  assert.equal(
    await db.auditLog.count({
      where: { organizationId: id, action: "consent.accepted" },
    }),
    1,
  );
  mark(
    "First-login consent blocks UI/API until explicit acceptance; date/version/audit recorded",
  );
  const methods = await call(admin, "/tests");
  for (const method of methods)
    if (method.versions[0]?.version === "2.0-2026-10-26")
      assert(method.versions[0].delivery.passport?.rights?.ru);
  const motivation = methods.find((m: any) => m.id === "motivation")
    .versions[0];
  assert.equal(motivation.delivery.questionCount, 49);
  assert.equal(motivation.timeLimitSeconds, null);
  mark("Method passports available; motivation has 49 tasks and no timer");
  const started = await api(`/assignments/${id}verbal/start`, {
    language: "ru",
  });
  await api(`/attempts/${started.id}/presence`, { action: "begin" });
  const state = await api(`/attempts/${started.id}`);
  const now = Date.now(),
    answeredAt = new Date(now - 60000).toISOString();
  await db.testAttempt.update({
    where: { id: started.id },
    data: {
      timerStartedAt: new Date(now - 1320000),
      expiresAt: new Date(now - 1000),
    },
  });
  const empty = await api(`/attempts/${started.id}`);
  assert.equal(empty.status, "retry_required");
  const people = await call(admin, `/people?campaignId=${id}`);
  const person = people.find((p: any) => p.id === id + "employee");
  assert.equal(person.status, "retry_required");
  assert.equal(person.completed, 0);
  assert.equal(person.results.filter((r: any) => r.score).length, 0);
  await call(
    admin,
    "/generated-reports",
    {
      campaignId: id,
      membershipId: id + "employee",
      kind: "individual",
      language: "ru",
    },
    400,
  );
  await page.goto(base + "/test/" + started.id);
  // Verify endpoint and the actual route used by the cabinet (route path is /test/:id).
  mark(
    "Empty timeout excluded from completed count, report generation and analytics",
  );
  for (let i = 0; i < 24; i++) {
    const q = state.questions[i];
    await api(`/attempts/${started.id}/answers`, {
      questionId: q.id,
      value: q.options[0].id,
      revision: 0,
      durationMs: i === 0 ? 1999 : 12000,
      answeredAt,
    });
    if (i === 22)
      assert.equal(
        (await api(`/attempts/${started.id}`)).status,
        "retry_required",
      );
  }
  assert.equal((await api(`/attempts/${started.id}`)).status, "completed");
  const valid = await db.testResult.findFirstOrThrow({
    where: { attemptId: started.id },
  });
  assert.equal((valid.result as any).validity.answered, 24);
  assert((valid.result as any).qualityFlags.includes("too_fast"));
  assert.equal((valid.result as any).responseQuality.fastAnswers, 1);
  mark(
    "23/30 remains excluded; 24/30 late offline answers recover a valid result with quality flags",
  );
  const logical = await api(`/assignments/${id}logical/start`, {
    language: "ru",
  });
  await api(`/attempts/${logical.id}/presence`, { action: "begin" });
  assert.equal(
    (await api(`/attempts/${logical.id}/submit`, {})).status,
    "retry_required",
  );
  const retry = await api(`/assignments/${id}logical/start`, {
    language: "ru",
  });
  assert.notEqual(retry.id, logical.id);
  const retake = await api(`/attempts/${retry.id}`);
  assert.equal(retake.answers.length, 0);
  assert.equal(retake.timerStartedAt, null);
  mark("Insufficient attempt can be restarted without deleting history");
  const sjt = await api(`/assignments/${id}situations/start`, {
    language: "ru",
  });
  await api(`/attempts/${sjt.id}/presence`, { action: "begin" });
  const sq = (await api(`/attempts/${sjt.id}`)).questions;
  for (let i = 0; i < 12; i++)
    await api(`/attempts/${sjt.id}/answers`, {
      questionId: sq[i].id,
      value: {
        most: sq[i].options[0].id,
        least: i === 11 ? "" : sq[i].options[1].id,
      },
      revision: 0,
      durationMs: 30000,
    });
  assert.equal(
    (await api(`/attempts/${sjt.id}/submit`, {})).status,
    "retry_required",
  );
  mark("SJT 11 full pairs plus one half-pair does not pass 80%");
  const motivationStart = await api(`/assignments/${id}motivation/start`, {
    language: "ru",
  });
  await api(`/attempts/${motivationStart.id}/presence`, { action: "begin" });
  const mq = (await api(`/attempts/${motivationStart.id}`)).questions;
  assert(!JSON.stringify(mq).includes("достиг ли я результата"));
  for (const q of mq)
    await api(`/attempts/${motivationStart.id}/answers`, {
      questionId: q.id,
      value: q.type === "ranking" ? { top: [], bottom: [] } : 3,
      revision: 0,
      durationMs: 12000,
    });
  await api(`/attempts/${motivationStart.id}/submit`, {}, 400);
  mark(
    "Motivation with 48 answers and empty priorities is not considered complete",
  );
  const numerical = await api(`/assignments/${id}numerical/start`, {
    language: "ru",
  });
  const oldAttempt = await db.testAttempt.update({
    where: { id: numerical.id },
    data: { status: "completed", submittedAt: new Date() },
  });
  await db.testResult.create({
    data: {
      organizationId: id,
      attemptId: numerical.id,
      scoringKeyId: oldAttempt.scoringKeyId,
      result: { algorithm: "cognitive", total: 0, maximum: 18, details: [] },
    },
  });
  const { repairHistoricalResults } =
    await import("../apps/api/src/result-repair");
  await repairHistoricalResults();
  await (await import("../apps/api/src/db")).db.$disconnect();
  assert.equal(
    (await db.testAttempt.findUniqueOrThrow({ where: { id: numerical.id } }))
      .status,
    "retry_required",
  );
  const repaired = await db.testResult.findFirstOrThrow({
    where: { attemptId: numerical.id },
  });
  assert.equal((repaired.result as any).total, undefined);
  assert.equal((repaired.result as any).validity.eligible, false);
  assert.equal(
    await db.auditLog.count({
      where: {
        organizationId: id,
        action: "result.completion_policy_applied",
        entityId: repaired.id,
      },
    }),
    1,
  );
  mark(
    "Historical zero-answer completion repaired without deleting answers/history; original result audited",
  );
  const administrator = await browser.newContext();
  await administrator.addCookies(
    await admin.storageState().then((s: any) => s.cookies),
  );
  const adminPage = await administrator.newPage();
  await adminPage.goto(base + "/people/" + id + "employee");
  await adminPage.evaluate(
    (campaign) => localStorage.setItem("assessflow.campaign", campaign),
    id,
  );
  await adminPage.reload();
  await expect(
    adminPage.getByText("Ответов быстрее 2 секунд", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await mkdir("output/completion-review", { recursive: true });
  await adminPage.screenshot({
    path: "output/completion-review/admin-quality.png",
    fullPage: true,
  });
  await administrator.close();
  mark("Administrator sees fast-answer counts and quality flags");
  assert.deepEqual(errors, []);
  await writeFile(
    "output/completion-review/checks.json",
    JSON.stringify(checks, null, 2),
  );
} finally {
  await browser.close();
  await admin.dispose();
  const attempts = await db.testAttempt.findMany({
      where: { organizationId: id },
      select: { id: true },
    }),
    ids = attempts.map((a) => a.id);
  await db.userAnswer.deleteMany({ where: { attemptId: { in: ids } } });
  await db.testResult.deleteMany({ where: { attemptId: { in: ids } } });
  await db.testAttempt.deleteMany({ where: { id: { in: ids } } });
  await db.testAssignment.deleteMany({ where: { organizationId: id } });
  await db.campaign.deleteMany({ where: { organizationId: id } });
  await db.organization.deleteMany({ where: { id } });
  await db.user.deleteMany({
    where: { id: { in: [id + "employee", id + "admin"] } },
  });
  await db.auditLog.deleteMany({ where: { organizationId: id } });
  await db.$disconnect();
}
