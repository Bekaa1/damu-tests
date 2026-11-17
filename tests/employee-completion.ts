import {CONSENT_VERSION} from "../packages/core/assessment-policy";
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { chromium, expect, type APIRequestContext } from "playwright/test";
import { calculateScore } from "../packages/core/scoring";

// Disposable local fixtures: no real employee answers or paid AI requests.
const db = new PrismaClient(), base = "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname))
  throw Error("Local verification only");
const id = "qa-completion-" + Date.now(), adminId = id + "-admin";
const password = "QA-completion!2026";
const browser = await chromium.launch({ headless: true });
const employee = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await employee.newPage();
const errors: string[] = [];
page.on("pageerror", e => errors.push(e.message));
async function request(client: APIRequestContext, path: string, expected: number, body?: unknown) {
  const response = await client.fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: base }, data: body,
  });
  assert.equal(response.status(), expected, path + ": " + (await response.text()).slice(0, 150));
  return response;
}
try {
  const template = await db.membership.findFirstOrThrow({ where: { user: { email: "employee@assessflow.local" } } });
  for (const [userId, role] of [[id, "employee"], [adminId, "admin"]] as const) {
    await db.user.create({ data: {
      id: userId, name: role === "employee" ? "Проверка завершения" : "Администратор проверки",
      email: userId + "@assessflow.local", emailVerified: true, mustChangePassword: false,
      accounts: { create: { accountId: userId, providerId: "credential", password: await hashPassword(password) } },
      memberships: { create: { id: userId, organizationId: template.organizationId, role, consentAt: new Date(),consentVersion:CONSENT_VERSION } },
    } });
  }
  await db.campaign.create({ data: { id, organizationId: template.organizationId, name: "Проверка завершения тестов", endsAt: new Date(Date.now() + 86400000) } });
  const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
  let lastAttempt = "";
  for (const test of catalog) {
    const answers = Object.fromEntries(test.questions.map((q: any) => {
      const key = test.config.items[q.id];
      return [q.id, key.correct ?? (q.type === "sjt" ? { most: key.most, least: key.least } : q.type === "ranking" ? {
        top: q.options.slice(0, 3).map((o: any) => o.id), bottom: q.options.slice(3, 6).map((o: any) => o.id),
      } : key.control === "К1" ? 2 : key.control === "К2" ? 4 : 3)];
    }));
    const last = test.id === "situations";
    const assignment = await db.testAssignment.create({ data: { organizationId: template.organizationId, campaignId: id, membershipId: id, testVersionId: test.id + "-v2" } });
    const attempt = await db.testAttempt.create({ data: {
      organizationId: template.organizationId, assignmentId: assignment.id, language: "ru", scoringKeyId: test.id + "-key-v2",
      status: last ? "in_progress" : "completed", timerStartedAt: new Date(), submittedAt: last ? null : new Date(),
      expiresAt: last ? new Date(Date.now() + 1800000) : null,
    } });
    await db.userAnswer.createMany({ data: Object.entries(answers).map(([questionId, value]) => ({ organizationId: template.organizationId, attemptId: attempt.id, questionId, value: value as any, durationMs: 5000 })) });
    if (last) lastAttempt = attempt.id;
    else await db.testResult.create({ data: { organizationId: template.organizationId, attemptId: attempt.id, scoringKeyId: test.id + "-key-v2", result: JSON.parse(JSON.stringify(calculateScore(test.algorithm, test.config, test.questions, answers))) } });
  }
  await page.goto(base + "/login");
  await page.getByLabel(/Логин|Email/i).fill(id + "@assessflow.local");
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  const signIn = page.waitForResponse(response => response.url().endsWith("/api/auth/sign-in/email"));
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  const signedIn = await signIn;
  assert.equal(signedIn.status(), 200, await signedIn.text());
  await page.waitForURL("**/cabinet");
  await expect(page.locator(".test-card")).toHaveCount(6);
  await expect(page.getByRole("link", { name: "Мои результаты", exact: true })).toHaveCount(0);
  await expect(page.locator(".assessment-complete")).toHaveCount(0);
  await request(admin.request, "/auth/sign-in/email", 200, { email: adminId + "@assessflow.local", password });
  await request(admin.request, "/generated-reports", 400, { campaignId: id, membershipId: id, kind: "individual", language: "ru" });
  await page.goto(base + "/test/" + lastAttempt);
  for (let i = 0; i < 13; i++)
    await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Завершить тест", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить завершение", exact: true }).click();
  await expect(page.locator(".assessment-complete")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Вы успешно прошли все тесты", exact: true })).toBeVisible();
  await expect(page.getByText("Ваши ответы сохранены. Результаты можно уточнить у администратора.", { exact: true })).toBeVisible();
  await mkdir("output/new-forms-qa", { recursive: true });
  await page.screenshot({ path: "output/new-forms-qa/completion-desktop.png", fullPage: true });
  await page.goto(base + "/cabinet");
  await expect(page.locator(".assessment-complete")).toBeVisible();
  await expect(page.locator(".test-card")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const box = await page.locator(".sidebar").boundingBox();
    return box ? box.x + box.width : 0;
  }).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "output/new-forms-qa/completion-mobile.png", fullPage: true, animations: "disabled" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  for (const path of ["/my-results", "/reports", "/team-reports"]) {
    await page.goto(base + path);
    await page.waitForURL("**/cabinet");
    await expect(page.locator(".assessment-complete")).toBeVisible();
  }
  await page.getByRole("button", { name: "ҚАЗ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Сіз барлық тесттерді сәтті аяқтадыңыз", exact: true })).toBeVisible();
  const participant = await (await request(admin.request, "/people/" + id + "?campaignId=" + id, 200)).json();
  assert.equal(participant.allDone, true);
  assert.equal(participant.assignments.length, 6);
  assert(participant.assignments.every((a: any) => a.attempts[0].results.length));
  const snapshot = {
    organization: { name: "Проверка" }, campaign: { id, name: "Проверка" },
    people: [{ id, name: "Проверка завершения", position: "", unit: "", category: "", status: "completed", completed: 6, total: 6, results: [], observations: [], expert: null }],
  };
  const content = {
    summary: [{ text: "Проверка прав доступа", evidenceIds: ["coverage"] }], analytical: [], personality: [], motivation: [], management: [], competencies: [], potential: [], strengths: [], development: [], risks: [],
    recommendations: [{ text: "Практиковать планирование", evidenceIds: ["coverage"] }],
    developmentPlan: [{ focus: "Планирование", action: "Составить план", format: "Рабочая практика", timeframe: "30 дней", success: "Выполненный план", evidenceIds: ["coverage"] }], limitations: [],
  };
  // Reusing an existing pending job verifies admin generation without a paid model call.
  await db.generatedReport.create({ data: { id, organizationId: template.organizationId, campaignId: id, membershipId: id, kind: "individual", language: "ru", status: "pending", participantIds: [id], snapshot, content, inputHash: id, model: "fixture", prompt: "fixture", promptVersion: "test", providerConfig: {}, createdBy: adminId } });
  const generated = await (await request(admin.request, "/generated-reports", 201, { campaignId: id, membershipId: id, kind: "individual", language: "ru" })).json();
  assert.equal(generated.id, id);
  for (const path of ["/people/" + id + "?campaignId=" + id, "/generated-reports?campaignId=" + id, "/generated-reports?campaignId=" + id + "&kind=individual", "/generated-reports/" + id + "/pdf", "/reports/" + id, "/reports/" + id + "/pdf"]) {
    await request(employee.request, path, 403);
  }
  for (const path of ["/generated-reports", "/ai/generate"]) {
    await request(employee.request, path, 403, { campaignId: id, membershipId: id, kind: "individual", language: "ru" });
  }
  await db.generatedReport.update({ where: { id }, data: { status: "completed" } });
  const list = await (await request(admin.request, "/generated-reports?campaignId=" + id, 200)).json();
  assert(list.some((r: any) => r.id === id));
  const pdf = await request(admin.request, "/generated-reports/" + id + "/pdf", 200);
  assert.equal((await pdf.body()).subarray(0, 5).toString(), "%PDF-");
  const adminPage = await admin.newPage();
  await adminPage.goto(base + "/reports");
  await adminPage.locator(".header-campaign select").selectOption(id);
  await expect(adminPage.locator(".main-content").getByText("Проверка завершения", { exact: true }).first()).toBeVisible();
  await request(employee.request, "/generated-reports/" + id + "/pdf", 403);
  assert.deepEqual(errors, []);
  console.log("PASS: 5/6 stays on tests; final submission and cabinet show completion in RU/KK on desktop/mobile; legacy links redirect; employee results/report APIs return 403; admin results, generation reuse, reports UI and PDF remain available.");
} finally {
  await browser.close();
  const attempts = await db.testAttempt.findMany({ where: { assignment: { campaignId: id } }, select: { id: true } });
  const ids = attempts.map(a => a.id);
  await db.generatedReport.deleteMany({ where: { campaignId: id } });
  await db.testResult.deleteMany({ where: { attemptId: { in: ids } } });
  await db.userAnswer.deleteMany({ where: { attemptId: { in: ids } } });
  await db.testAttempt.deleteMany({ where: { id: { in: ids } } });
  await db.testAssignment.deleteMany({ where: { campaignId: id } });
  await db.campaign.deleteMany({ where: { id } });
  await db.user.deleteMany({ where: { id: { in: [id, adminId] } } });
  await db.$disconnect();
}
