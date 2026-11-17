import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import {
  chromium,
  request,
  expect,
  type APIRequestContext,
} from "playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  DEFAULT_COMPETENCIES,
  exerciseCriteria,
} from "../packages/core/competencies";
import { CONSENT_VERSION } from "../packages/core/assessment-policy";
import { defaultMatrix } from "../packages/core/contracts";
const db = new PrismaClient(),
  base = "http://localhost:3000",
  id = `qa-quality-${Date.now()}`,
  password = "Quality-check!2026";
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Local verification only");
const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
const browser = await chromium.launch({ headless: true }),
  employee = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  }),
  page = await employee.newPage();
const admin = await request.newContext(),
  one = await request.newContext(),
  two = await request.newContext();
const checks: string[] = [],
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
async function api(
  client: APIRequestContext,
  path: string,
  body?: unknown,
  status = body === undefined ? 200 : 201,
) {
  const r = await client.fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: base },
    data: body,
  });
  assert.equal(
    r.status(),
    status,
    `${path}: ${(await r.text()).slice(0, 250)}`,
  );
  return r;
}
const json = async (
  client: APIRequestContext,
  path: string,
  body?: unknown,
  status?: number,
) => (await api(client, path, body, status)).json();
const mark = (value: string) => {
  checks.push(value);
  console.log("PASS", value);
};
async function waitFor<T>(
  get: () => Promise<T>,
  predicate: (v: T) => boolean,
  timeout = 30000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await get();
    if (predicate(v)) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("Timed out waiting for persisted state");
}
try {
  await waitFor(
    async () => {
      try {
        return (await fetch(base + "/api/health")).status;
      } catch {
        return 0;
      }
    },
    (s) => s === 200,
  );
  await db.organization.create({
    data: {
      id,
      name: "Проверка качества",
      slug: id,
      matrixConfig: defaultMatrix,
      aiBudget: 0,
    },
  });
  for (const role of ["employee", "admin", "one", "two"]) {
    const uid = `${id}-${role}`;
    await db.user.create({
      data: {
        id: uid,
        name: role === "employee" ? "Арман Ахметова" : `Ассессор ${role}`,
        email: `${uid}@assessflow.local`,
        emailVerified: true,
        mustChangePassword: false,
        accounts: {
          create: {
            accountId: uid,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
        memberships: {
          create: {
            id: uid,
            organizationId: id,
            role: role === "one" || role === "two" ? "expert" : role,
          },
        },
      },
    });
  }
  const member = `${id}-employee`,
    expert1 = `${id}-one`,
    expert2 = `${id}-two`;
  await db.competencyModel.create({
    data: {
      id,
      organizationId: id,
      version: 1,
      content: DEFAULT_COMPETENCIES,
      authorId: `${id}-admin`,
    },
  });
  await db.campaign.create({
    data: {
      id,
      organizationId: id,
      name: "Проверка новых правил",
      endsAt: new Date(Date.now() + 86400000),
    },
  });
  for (const type of [
    "group",
    "roleplay",
    "presentation",
    "interview",
    "facts",
  ])
    await db.assessmentExercise.create({
      data: {
        organizationId: id,
        type,
        name: { ru: `Упражнение ${type}`, kk: `Жаттығу ${type}` },
        criteria: exerciseCriteria(DEFAULT_COMPETENCIES, type),
      },
    });
  const assignments: any[] = [];
  for (const test of catalog)
    assignments.push(
      await db.testAssignment.create({
        data: {
          organizationId: id,
          campaignId: id,
          membershipId: member,
          testVersionId: `${test.id}-v2`,
          expertId: expert1,
          assessorIds: [expert1, expert2],
        },
      }),
    );
  for (const [client, role] of [
    [employee.request, "employee"],
    [admin, "admin"],
    [one, "one"],
    [two, "two"],
  ] as const)
    await api(
      client,
      "/auth/sign-in/email",
      { email: `${id}-${role}@assessflow.local`, password },
      200,
    );
  await api(employee.request, "/my/assignments", undefined, 403);
  await page.goto(base + "/cabinet");
  await expect(
    page.getByRole("heading", {
      name: "Согласие на обработку данных",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Принять и продолжить" }).click();
  await expect(page.locator(".test-card")).toHaveCount(6);
  assert.equal(
    (await db.membership.findUniqueOrThrow({ where: { id: member } }))
      .consentVersion,
    CONSENT_VERSION,
  );
  await expect(
    page.getByText("Здравствуйте, Арман Ахметова", { exact: true }).first(),
  ).toBeVisible();
  mark(
    "First-login consent gates API and UI; greeting uses the full profile name",
  );
  const task = assignments.find((a) => a.testVersionId === "personality-v2");
  const attempt = await json(
    employee.request,
    `/assignments/${task.id}/start`,
    { language: "ru" },
  );
  const empty = await json(
    employee.request,
    `/my/assignments?campaignId=${id}`,
  );
  assert.equal(
    empty.find((a: any) => a.id === task.id).attempts[0]._count.answers,
    0,
  );
  await page.reload();
  await expect(
    page
      .locator(".test-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Личностные характеристики",
          exact: true,
        }),
      })
      .getByText("Не начато", { exact: true }),
  ).toBeVisible();
  await page.goto(base + "/test/" + attempt.id);
  await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  await expect(page.locator(".test-timer")).toContainText(/24:|25:/);
  const before = await db.testAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  // A stale heartbeat must no longer pause or shift the server clock.
  await db.testAttempt.update({
    where: { id: attempt.id },
    data: { lastHeartbeatAt: new Date(Date.now() - 60000) },
  });
  await json(employee.request, `/attempts/${attempt.id}/presence`, {
    action: "heartbeat",
  });
  const after = await db.testAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  assert.equal(after.expiresAt!.getTime(), before.expiresAt!.getTime());
  assert.equal(after.pausedAt, null);
  mark(
    "Empty attempts stay not-started; all questionnaires show a large server-owned timer",
  );
  const button = page.locator(".scale-options button").nth(2);
  await page
    .getByRole("checkbox", {
      name: "Автоматически переходить к следующему вопросу",
    })
    .uncheck();
  await page.route(`**/api/attempts/${attempt.id}/answers`, async (route) => {
    await new Promise((r) => setTimeout(r, 120));
    await route.continue();
  });
  await button.click();
  await page.locator(".scale-options button").nth(1).click();
  await waitFor(
    () => db.userAnswer.findFirst({ where: { attemptId: attempt.id } }),
    (a) => a?.revision === 2 && a.value === 2,
  );
  await page.unroute(`**/api/attempts/${attempt.id}/answers`);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await waitFor(
    () => db.userAnswer.count({ where: { attemptId: attempt.id } }),
    (n) => n === 1,
  );
  await employee.setOffline(true);
  await page.locator(".scale-options button").nth(1).click();
  await expect(
    page.getByText(/Нет связи, не закрывайте страницу/),
  ).toBeVisible();
  const queued = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("assessflow.answers."))
      .map((k) => JSON.parse(localStorage.getItem(k)!)),
  );
  assert(queued.some((q) => Object.keys(q).length));
  // Expire the authoritative server clock while keeping a legitimate queued answer.
  await db.testAttempt.update({
    where: { id: attempt.id },
    data: { expiresAt: new Date(Date.now() + 100) },
  });
  await new Promise((r) => setTimeout(r, 350));
  await employee.setOffline(false);
  await json(employee.request, `/attempts/${attempt.id}/submit`, {});
  await waitFor(
    () => db.userAnswer.count({ where: { attemptId: attempt.id } }),
    (n) => n === 2,
  );
  assert.equal(
    (await db.testAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .status,
    "completed",
  );
  assert(
    await db.auditLog.count({
      where: { organizationId: id, action: "answer.delayed_received" },
    }),
  );
  mark(
    "Offline responses persist locally, sync automatically after deadline, and timeout completes the attempt",
  );
  await api(
    employee.request,
    `/attempts/${attempt.id}/extend`,
    { seconds: 60, reason: "Проверка прав доступа" },
    403,
  );
  await api(
    admin,
    `/attempts/${attempt.id}/extend`,
    { seconds: 60, reason: "" },
    400,
  );
  await api(admin, `/attempts/${attempt.id}/extend`, {
    seconds: 1500,
    reason: "Восстановление времени после проверочного сетевого сбоя",
  });
  assert.equal(
    (await db.testAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .extraSeconds,
    1500,
  );
  assert.equal(
    await db.auditLog.count({
      where: { organizationId: id, action: "incident.time_added" },
    }),
    1,
  );
  // Presence events are idempotent and do not affect the deadline.
  const leave = {
    action: "leave",
    eventId: "qa-leave",
    at: new Date().toISOString(),
  };
  await json(employee.request, `/attempts/${attempt.id}/presence`, leave);
  await json(employee.request, `/attempts/${attempt.id}/presence`, leave);
  await new Promise((r) => setTimeout(r, 250));
  await json(employee.request, `/attempts/${attempt.id}/presence`, {
    action: "return",
    eventId: "qa-return",
    at: new Date().toISOString(),
  });
  const presence = await db.testAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  assert.equal(presence.departures, 1);
  assert(presence.awayMs >= 200, JSON.stringify(presence));
  mark(
    "Only admin can extend a timer with an audited reason; departure events retain count/duration without duplicates",
  );
  for (const test of catalog) {
    const a = assignments.find((a) => a.testVersionId === `${test.id}-v2`);
    const started = await json(employee.request, `/assignments/${a.id}/start`, {
      language: "ru",
    });
    await json(employee.request, `/attempts/${started.id}/presence`, {
      action: "begin",
    });
    const existing = await json(employee.request, `/attempts/${started.id}`);
    for (const q of test.questions) {
      const key = test.config.items[q.id];
      const value =
        key.correct ??
        (q.type === "sjt"
          ? { most: key.most, least: key.least }
          : q.type === "ranking"
            ? {
                top: q.options.slice(0, 3).map((o: any) => o.id),
                bottom: q.options.slice(3, 6).map((o: any) => o.id),
              }
            : key.control === "К1"
              ? 2
              : key.control === "К2"
                ? 4
                : 3);
      const previous = existing.answers.find((a: any) => a.questionId === q.id);
      await json(employee.request, `/attempts/${started.id}/answers`, {
        questionId: q.id,
        value,
        revision: previous?.revision ?? 0,
        durationMs: 10000,
        answeredAt: new Date().toISOString(),
      });
    }
    await json(employee.request, `/attempts/${started.id}/submit`, {});
  }
  const first = await waitFor(
    () =>
      db.generatedReport.findFirst({
        where: { organizationId: id },
        orderBy: { createdAt: "desc" },
      }),
    (r) => Boolean(r?.readyAt),
    90000,
  );
  assert(first?.readyAt);
  assert(
    first.readyAt.getTime() - first.assessmentCompletedAt!.getTime() < 300000,
  );
  assert.equal(first.generationMode, "data");
  assert(await db.reportArtifact.findUnique({ where: { reportId: first.id } }));
  const initialPdf = await api(admin, `/generated-reports/${first.id}/pdf`);
  assert.equal((await initialPdf.body()).subarray(0, 5).toString(), "%PDF-");
  await api(
    employee.request,
    `/generated-reports/${first.id}/pdf`,
    undefined,
    403,
  );
  await page.goto(base + "/cabinet");
  await expect(page.locator(".assessment-complete")).toBeVisible();
  mark(
    "All six tests submit; an automatically saved PDF is available within five minutes; employee sees only completion",
  );
  const exercises = await json(one, "/exercises");
  for (const [client, n] of [
    [one, 1],
    [two, 2],
  ] as const)
    for (const e of exercises) {
      await json(client, "/observations", {
        campaignId: id,
        membershipId: member,
        exerciseId: e.id,
        scores: Object.fromEntries(
          e.criteria.map((c: any) => [c.id, n === 1 ? 3 : 4]),
        ),
        indicatorExamples: Object.fromEntries(
          e.criteria.map((c: any) => [
            c.id,
            `Ассессор ${n}: участник назвал конкретное действие, срок и ответственного.`,
          ]),
        ),
        notes: `Ассессор ${n} наблюдал действия участника в рабочей ситуации и зафиксировал примеры.`,
      });
    }
  const evidence = await json(
    two,
    `/participants/${member}/competencies?campaignId=${id}`,
  );
  assert.equal(evidence.cards.length, 8);
  assert(evidence.cards.every((c: any) => c.methodCount >= 2));
  const both = await db.expertObservation.findMany({
    where: { organizationId: id },
  });
  assert.equal(both.length, 10);
  assert.equal(new Set(both.map((o) => o.expertId)).size, 2);
  if (process.env.ASSESSFLOW_LIVE_AI === "1")
    await db.organization.update({ where: { id }, data: { aiBudget: 2 } });
  await json(two, `/participants/${member}/consensus`, {
    campaignId: id,
    modelId: id,
    roleId: "director_hq",
    ratings: evidence.cards.map((c: any) => ({
      competencyId: c.id,
      value: 4,
      reason:
        "Эксперт сопоставил тестовые результаты и конкретные наблюдения двух ассессоров.",
      evidenceIds: c.sourceIds,
    })),
  });
  const final = await waitFor(
    () =>
      db.generatedReport.findFirst({
        where: { organizationId: id, id: { not: first.id } },
        orderBy: { createdAt: "desc" },
      }),
    (r) => Boolean(r?.readyAt),
    180000,
  );
  assert(final?.readyAt);
  if (process.env.ASSESSFLOW_LIVE_AI === "1") {
    console.log(
      "Live provider report mode",
      final.generationMode,
      "cost",
      final.cost,
    );
    assert.equal(final.generationMode, "ai");
  }
  const snap = final.snapshot as any;
  assert.equal(snap.people[0].observations.length, 10);
  assert.equal(
    snap.people[0].competencyProfile.consensus.scores.ratings.length,
    8,
  );
  const finalPdf = await api(admin, `/generated-reports/${final.id}/pdf`);
  await mkdir("output/pdf/assessment-quality", { recursive: true });
  await writeFile(
    "output/pdf/assessment-quality/individual-ru.pdf",
    await finalPdf.body(),
  );
  assert.equal(
    (
      await db.reportArtifact.findUniqueOrThrow({
        where: { reportId: first.id },
      })
    ).bytes.length,
    (await initialPdf.body()).length,
  );
  const adminBrowser = await browser.newContext({
      storageState: await admin.storageState(),
      viewport: { width: 1440, height: 1000 },
    }),
    adminPage = await adminBrowser.newPage();
  await adminPage.goto(base + "/people/" + member);
  await adminPage
    .getByRole("button", { name: "Время и инциденты", exact: true })
    .click();
  await expect(
    adminPage.getByText(
      "Восстановление времени после проверочного сетевого сбоя",
      { exact: false },
    ),
  ).toHaveCount(1);
  await adminPage.screenshot({
    path: "output/pdf/assessment-quality/admin-incidents.png",
    fullPage: true,
  });
  const expertBrowser = await browser.newContext({
      storageState: await two.storageState(),
      viewport: { width: 1440, height: 1000 },
    }),
    expertPage = await expertBrowser.newPage();
  await expertPage.goto(base + "/people/" + member);
  await expertPage
    .getByRole("button", { name: "Компетенции и согласование", exact: true })
    .click();
  await expect(expertPage.locator(".consensus-card")).toHaveCount(8);
  await expertPage.screenshot({
    path: "output/pdf/assessment-quality/expert-consensus.png",
    fullPage: true,
  });
  await expertPage.goto(base + "/criteria");
  await expect(
    expertPage.getByRole("heading", {
      name: "Модель управленческих компетенций",
      exact: true,
    }),
  ).toBeVisible();
  mark(
    "Two assessors retain separate indicator scores and behavior; eight expert consensus scores and evidence appear in a new PDF version",
  );
  assert.equal(
    await db.auditLog.count({
      where: { organizationId: id, action: "report.available" },
    }),
    2,
  );
  const kz = await json(admin, "/generated-reports", {
    campaignId: id,
    membershipId: member,
    kind: "individual",
    language: "kk",
  });
  const kzReady = await waitFor(
    () => db.generatedReport.findUnique({ where: { id: kz.id } }),
    (r) => Boolean(r?.readyAt),
    90000,
  );
  const kzPdf = await api(admin, `/generated-reports/${kz.id}/pdf`);
  await writeFile(
    "output/pdf/assessment-quality/individual-kk.pdf",
    await kzPdf.body(),
  );
  const team = await json(admin, "/generated-reports", {
    campaignId: id,
    kind: "team",
    language: "kk",
  });
  await waitFor(
    () => db.generatedReport.findUnique({ where: { id: team.id } }),
    (r) => Boolean(r?.readyAt),
    90000,
  );
  const teamPdf = await api(admin, `/generated-reports/${team.id}/pdf`);
  await writeFile(
    "output/pdf/assessment-quality/team-kk.pdf",
    await teamPdf.body(),
  );
  mark("Individual and team PDFs also render in Kazakh");
  assert.deepEqual(errors, []);
  await writeFile(
    "output/pdf/assessment-quality/checks.json",
    JSON.stringify(
      {
        checks,
        reports: [first.id, final.id],
        seconds: [first, final].map(
          (r) =>
            (r!.readyAt!.getTime() - r!.assessmentCompletedAt!.getTime()) /
            1000,
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await admin.dispose();
  await one.dispose();
  await two.dispose();
  const attempts = await db.testAttempt.findMany({
      where: { organizationId: id },
      select: { id: true },
    }),
    ids = attempts.map((a) => a.id);
  await db.generatedReport.deleteMany({ where: { organizationId: id } });
  await db.competencyConsensus.deleteMany({ where: { organizationId: id } });
  await db.expertObservation.deleteMany({ where: { organizationId: id } });
  await db.finalReport.deleteMany({ where: { organizationId: id } });
  await db.aiReport.deleteMany({ where: { organizationId: id } });
  await db.testResult.deleteMany({ where: { attemptId: { in: ids } } });
  await db.userAnswer.deleteMany({ where: { attemptId: { in: ids } } });
  await db.testAttempt.deleteMany({ where: { id: { in: ids } } });
  await db.testAssignment.deleteMany({ where: { organizationId: id } });
  await db.campaign.deleteMany({ where: { organizationId: id } });
  await db.assessmentExercise.deleteMany({ where: { organizationId: id } });
  await db.competencyModel.deleteMany({ where: { organizationId: id } });
  await db.organization.deleteMany({ where: { id } });
  await db.user.deleteMany({ where: { id: { startsWith: id } } });
  await db.auditLog.deleteMany({ where: { organizationId: id } });
  await db.$disconnect();
}
