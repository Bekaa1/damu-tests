import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { chromium, request, expect } from "playwright/test";
import {
  CONSENT_VERSION,
  displayAttemptStatus,
} from "../packages/core/assessment-policy";
import { defaultMatrix } from "../packages/core/contracts";
const db = new PrismaClient(),
  base = "http://localhost:3000",
  id = `qa-retakes-${Date.now()}`,
  password = "Retake-check!2026";
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Local verification only");
const browser = await chromium.launch(),
  admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  employee = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
const expert = await request.newContext(),
  foreign = await request.newContext(),
  adminPage = await admin.newPage(),
  page = await employee.newPage();
const checks: string[] = [],
  errors: string[] = [];
for (const p of [adminPage, page])
  p.on("pageerror", (e) => errors.push(e.message));
async function api(
  client: any,
  path: string,
  data?: any,
  status = data === undefined ? 200 : 201,
) {
  const r = await client.fetch(base + "/api" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { Origin: base },
    data,
  });
  assert.equal(
    r.status(),
    status,
    `${path}: ${(await r.text()).slice(0, 400)}`,
  );
  return r.json();
}
const mark = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  for (const suffix of ["", "-foreign"])
    await db.organization.create({
      data: {
        id: id + suffix,
        name: "Проверка повторных попыток",
        slug: id + suffix,
        matrixConfig: defaultMatrix,
        aiBudget: 0,
      },
    });
  const hash = await hashPassword(password);
  for (const role of ["admin", "employee", "expert", "foreign"]) {
    const uid = id + "-" + role;
    await db.user.create({
      data: {
        id: uid,
        name: role === "employee" ? "Арман Ахметова" : role,
        email: uid + "@assessflow.local",
        emailVerified: true,
        mustChangePassword: false,
        accounts: {
          create: { accountId: uid, providerId: "credential", password: hash },
        },
        memberships: {
          create: {
            id: uid,
            organizationId: role === "foreign" ? id + "-foreign" : id,
            role: role === "foreign" ? "admin" : role,
            consentAt: new Date(),
            consentVersion: CONSENT_VERSION,
          },
        },
      },
    });
  }
  const member = id + "-employee";
  await db.campaign.create({
    data: {
      id,
      organizationId: id,
      name: "Проверка повторного прохождения",
      endsAt: new Date(Date.now() + 86400000),
    },
  });
  const versions = await db.testVersion.findMany({
    where: {
      id: {
        in: [
          "verbal",
          "numerical",
          "logical",
          "personality",
          "motivation",
          "situations",
        ].map((t) => t + "-v2"),
      },
    },
    include: {
      keys: { orderBy: { createdAt: "desc" }, take: 1 },
      test: true,
      questions: { include: { options: true } },
    },
  });
  assert.equal(versions.length, 6);
  for (const v of versions) {
    const aid = id + "-" + v.testId;
    await db.testAssignment.create({
      data: {
        id: aid,
        organizationId: id,
        campaignId: id,
        membershipId: member,
        expertId: id + "-expert",
        testVersionId: v.id,
      },
    });
    await db.testAttempt.create({
      data: {
        id: aid,
        organizationId: id,
        assignmentId: aid,
        status: "completed",
        language: "ru",
        scoringKeyId: v.keys[0].id,
        timerStartedAt: new Date(Date.now() - 10000),
        submittedAt: new Date(),
        expiresAt: new Date(),
        results: {
          create: {
            scoringKeyId: v.keys[0].id,
            result: {
              algorithm: "cognitive",
              total: 1,
              maximum: 30,
              percent: 100 / 30,
              details: [],
            },
          },
        },
      },
    });
  }
  const report = await db.generatedReport.create({
    data: {
      organizationId: id,
      campaignId: id,
      membershipId: member,
      kind: "individual",
      language: "ru",
      status: "completed",
      readyAt: new Date(),
      participantIds: [member],
      snapshot: { control: "immutable old snapshot" },
      inputHash: id,
      model: "fixture",
      prompt: "fixture",
      promptVersion: "fixture",
      providerConfig: {},
      createdBy: id + "-admin",
      artifact: {
        create: { bytes: Buffer.from("fixture-artifact"), sha256: "fixture" },
      },
    },
    include: { artifact: true },
  });
  const frozen = await db.frozenNorm.create({
    data: {
      organizationId: id,
      campaignId: id,
      excludedCount: 0,
      metrics: { control: "immutable reference" },
      sourceHash: id,
      createdBy: id + "-expert",
    },
  });
  for (const [client, role] of [
    [admin.request, "admin"],
    [employee.request, "employee"],
    [expert, "expert"],
    [foreign, "foreign"],
  ] as const)
    await api(
      client,
      "/auth/sign-in/email",
      { email: `${id}-${role}@assessflow.local`, password },
      200,
    );
  await page.goto(base + "/cabinet");
  await expect(
    page.getByText("Вы успешно прошли все тесты", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Здравствуйте, Арман Ахметова",
      exact: true,
    }),
  ).toBeVisible();
  const initial = await db.testAttempt.findMany({
    where: { organizationId: id },
    include: { results: true, answers: true },
    orderBy: { id: "asc" },
  });
  const target = versions.find((v) => v.testId === "personality")!;
  const taskId = id + "-personality",
    body = {
      campaignId: id,
      attempts: [{ assignmentId: taskId, previousAttemptId: taskId }],
      reason: "Проверка полного повторного прохождения",
    };
  await api(employee.request, `/people/${member}/retakes`, body, 403);
  await api(expert, `/people/${member}/retakes`, body, 403);
  await api(foreign, `/people/${member}/retakes`, body, 404);
  await api(
    admin.request,
    `/people/${member}/retakes`,
    { ...body, reason: "" },
    400,
  );
  await db.campaign.update({
    where: { id },
    data: { endsAt: new Date(Date.now() - 1000) },
  });
  await api(admin.request, `/people/${member}/retakes`, body, 400);
  await db.campaign.update({
    where: { id },
    data: { endsAt: new Date(Date.now() + 86400000) },
  });
  await adminPage.goto(base + `/people/${member}`);
  assert.equal(
    (await api(admin.request, `/people/${member}?campaignId=${id}`)).member
      .role,
    "employee",
  );
  await adminPage
    .getByRole("button", {
      name: "Назначить повторное прохождение",
      exact: true,
    })
    .click();
  const dialog = adminPage.getByRole("dialog");
  await dialog.getByLabel("Выбрать все завершённые", { exact: true }).uncheck();
  await dialog
    .getByLabel((target.test.name as any).ru, { exact: true })
    .check();
  await dialog.getByLabel("Причина повторного прохождения").fill(body.reason);
  await dialog.getByRole("button", { name: "Назначить новые попытки" }).click();
  await expect(dialog).not.toBeVisible();
  await api(admin.request, `/people/${member}/retakes`, body, 409);
  await expect(page.locator(".test-card")).toHaveCount(6, { timeout: 20000 });
  await expect(
    page.getByText("Вы успешно прошли все тесты", { exact: true }),
  ).not.toBeVisible();
  const card = page.locator(".test-card").filter({
    has: page.getByRole("heading", {
      name: (target.test.name as any).ru,
      exact: true,
    }),
  });
  await expect(card.getByText("Не начато", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Начать тест", exact: true }),
  ).toBeEnabled();
  let fresh = await db.testAttempt.findFirstOrThrow({
    where: { assignmentId: taskId },
    orderBy: { attemptNumber: "desc" },
  });
  assert.equal(fresh.attemptNumber, 2);
  assert.equal(fresh.expiresAt, null);
  assert.equal(fresh.timerStartedAt, null);
  assert.equal(
    await db.testAttempt.count({ where: { organizationId: id } }),
    7,
  );
  mark(
    "Admin selects one completed test through UI; employee completion screen updates automatically; new attempt is empty and untimed; duplicate and unauthorized requests rejected",
  );
  // The same action supports all remaining completed tests. Concurrent double-click creates only one batch.
  const remaining = initial
    .filter((a) => a.id !== taskId)
    .map((a) => ({ assignmentId: a.assignmentId, previousAttemptId: a.id }));
  const responses = await Promise.all(
    [0, 1].map(() =>
      admin.request.post(base + `/api/people/${member}/retakes`, {
        headers: { Origin: base },
        data: { ...body, attempts: remaining },
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status()).sort(), [201, 409]);
  assert.equal(
    await db.testAttempt.count({ where: { organizationId: id } }),
    12,
  );
  await api(
    admin.request,
    `/attempts/${taskId}/extend`,
    { seconds: 60, reason: "Нельзя оживить прежнюю попытку" },
    400,
  );
  const started = await api(employee.request, `/assignments/${taskId}/start`, {
    language: "kk",
  });
  assert.equal(started.id, fresh.id);
  assert.equal(
    (await db.testAttempt.findUniqueOrThrow({ where: { id: fresh.id } }))
      .language,
    "kk",
  );
  await api(employee.request, `/assignments/${taskId}/start`, {
    language: "ru",
  });
  await page.goto(base + "/test/" + fresh.id);
  await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  await expect(page.locator(".test-timer")).toContainText(/24:|25:/);
  fresh = await db.testAttempt.findUniqueOrThrow({ where: { id: fresh.id } });
  assert.equal(
    fresh.expiresAt!.getTime() - fresh.timerStartedAt!.getTime(),
    target.timeLimitSeconds! * 1000,
  );
  const question = target.questions[0];
  await api(employee.request, `/attempts/${fresh.id}/answers`, {
    questionId: question.id,
    value: 3,
    revision: 0,
    durationMs: 1000,
  });
  await api(employee.request, `/attempts/${fresh.id}/submit`, {});
  const done = await db.testAttempt.findUniqueOrThrow({
    where: { id: fresh.id },
    include: { results: true },
  });
  assert.equal(done.status, "completed");
  assert.equal(done.results.length, 1);
  await api(
    employee.request,
    `/attempts/${taskId}/answers`,
    {
      questionId: question.id,
      value: 2,
      revision: 0,
      answeredAt: initial
        .find((a) => a.id === taskId)!
        .timerStartedAt!.toISOString(),
    },
    409,
  );
  assert.deepEqual(
    await db.testAttempt.findMany({
      where: { id: { in: initial.map((a) => a.id) } },
      include: { results: true, answers: true },
      orderBy: { id: "asc" },
    }),
    initial,
  );
  assert.deepEqual(
    await db.generatedReport.findUniqueOrThrow({
      where: { id: report.id },
      include: { artifact: true },
    }),
    report,
  );
  assert.deepEqual(
    await db.frozenNorm.findUniqueOrThrow({ where: { id: frozen.id } }),
    frozen,
  );
  mark(
    "Bulk retake is atomic and duplicate-safe; full server timer starts on employee action; answer and submission work; old results, report artifact and frozen norm are unchanged",
  );
  await adminPage.reload();
  await adminPage.getByRole("button", { name: "История", exact: true }).click();
  await expect(
    adminPage.getByText("История прохождений", { exact: true }),
  ).toBeVisible();
  await expect(
    adminPage.getByText(body.reason, { exact: false }).first(),
  ).toBeVisible();
  const details = await api(
    admin.request,
    `/people/${member}?campaignId=${id}`,
  );
  assert.equal(details.attemptHistory.length, 12);
  assert.equal(details.retakes.length, 2);
  assert.equal(details.allDone, false);
  const mine = await api(employee.request, `/my/assignments?campaignId=${id}`);
  assert.equal(
    mine.filter(
      (a: any) => displayAttemptStatus(a.attempts[0]) === "not_started",
    ).length,
    5,
  );
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage
    .getByRole("button", {
      name: "Назначить повторное прохождение",
      exact: true,
    })
    .click();
  await expect(adminPage.getByRole("dialog")).toBeVisible();
  assert.equal(
    await adminPage.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  await mkdir("output/retakes", { recursive: true });
  await adminPage.screenshot({ path: "output/retakes/admin-mobile.png" });
  assert.deepEqual(errors, []);
  mark(
    "History shows both attempts and audited reasons; administrator dialog works on mobile; no browser errors",
  );
  await writeFile(
    "output/retakes/checks.json",
    JSON.stringify(checks, null, 2),
  );
} catch (error) {
  console.log(
    "Browser diagnostics",
    errors,
    await adminPage.locator("body").innerText(),
  );
  throw error;
} finally {
  await browser.close();
  await expert.dispose();
  await foreign.dispose();
  await db.generatedReport.deleteMany({ where: { organizationId: id } });
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
  await db.organization.deleteMany({
    where: { id: { in: [id, id + "-foreign"] } },
  });
  await db.user.deleteMany({ where: { id: { startsWith: id } } });
  await db.auditLog.deleteMany({
    where: { organizationId: { in: [id, id + "-foreign"] } },
  });
  await db.$disconnect();
}
