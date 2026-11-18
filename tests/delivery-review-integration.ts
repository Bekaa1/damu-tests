import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { chromium, expect } from "playwright/test";
import { CONSENT_VERSION } from "../packages/core/assessment-policy";
import { defaultMatrix } from "../packages/core/contracts";

// Isolated local participants only; do not change the demonstration account.
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Local verification only");
const db = new PrismaClient(),
  base = "http://localhost:3000";
const id = `qa-delivery-${Date.now()}`,
  password = "Delivery-check!2026";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage(),
  checks: string[] = [],
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
async function api(
  path: string,
  data?: any,
  status = data === undefined ? 200 : 201,
) {
  const response = await context.request.fetch(base + "/api" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { Origin: base },
    data,
  });
  assert.equal(
    response.status(),
    status,
    `${path}: ${(await response.text()).slice(0, 300)}`,
  );
  return response.json();
}
const mark = (s: string) => {
  checks.push(s);
  console.log("PASS", s);
};
const snapshot = (attempt: string) => api(`/attempts/${attempt}`);
const start = (test: string) =>
  api(`/assignments/${id}-${test}/start`, { language: "ru" });
async function locale(lang: "ru" | "kk") {
  await page.evaluate(
    (lang) => localStorage.setItem("assessflow.locale", lang),
    lang,
  );
  await page.reload();
}
try {
  await db.organization.create({
    data: {
      id,
      name: "Проверка тренировок",
      slug: id,
      matrixConfig: defaultMatrix,
      aiBudget: 0,
    },
  });
  await db.user.create({
    data: {
      id,
      name: "Арман Ахметов",
      email: id + "@assessflow.local",
      emailVerified: true,
      mustChangePassword: false,
      accounts: {
        create: {
          accountId: id,
          providerId: "credential",
          password: await hashPassword(password),
        },
      },
      memberships: {
        create: {
          id,
          organizationId: id,
          role: "employee",
          consentAt: new Date(),
          consentVersion: CONSENT_VERSION,
        },
      },
    },
  });
  await db.campaign.create({
    data: {
      id,
      organizationId: id,
      name: "Проверка доставки тестов",
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
        id: `${id}-${test}`,
        organizationId: id,
        campaignId: id,
        membershipId: id,
        testVersionId: test + "-v2",
      },
    });
  await api(
    "/auth/sign-in/email",
    { email: id + "@assessflow.local", password },
    200,
  );
  await page.goto(base + "/cabinet");
  await expect(page.locator(".test-card")).toHaveCount(6);
  await expect(page.getByText("24 задания", { exact: true })).toBeVisible();
  await expect(
    page.locator(".test-card").filter({ hasText: "без таймера" }),
  ).toHaveCount(2);
  await expect(page.locator(".user-menu")).toContainText("Арман Ахметов");
  mark(
    "Six cards: correct Russian plural and two unlimited questionnaires; full name displayed",
  );

  const logical = await start("logical");
  await page.goto(base + "/test/" + logical.id);
  await page
    .getByRole("button", { name: "Перейти к тренировке", exact: true })
    .click();
  const options = page.locator(".answer-option");
  await expect(options).toHaveCount(6);
  assert.deepEqual(
    (await options.allTextContents()).map((t) => t.trim()[0]),
    ["A", "B", "C", "D", "E", "F"],
  );
  await options.nth(0).click();
  await expect(page.getByRole("status")).toContainText(
    "Неверно. Правильный ответ: C.",
  );
  await expect(page.locator(".practice-correct img")).toHaveAttribute(
    "src",
    /7082ddf495f7b84f/,
  );
  await expect
    .poll(
      async () =>
        await page
          .locator(".practice-correct img")
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
    )
    .toBe(true);
  await mkdir("output/delivery-review", { recursive: true });
  await page.screenshot({
    path: "output/delivery-review/training-ru.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await options.nth(0).click();
  await expect(page.getByRole("status")).toContainText("Правильный ответ: E.");
  await expect(page.locator(".practice-correct img")).toHaveAttribute(
    "src",
    /f6f187c506f23439/,
  );
  assert.equal((await snapshot(logical.id)).timerStartedAt, null);
  // Training is outside the timer and can be repeated in either language.
  await locale("kk");
  await page
    .getByRole("button", { name: "Жаттығуға өту", exact: true })
    .click();
  await options.nth(0).click();
  await expect(page.getByRole("status")).toContainText("Қате. Дұрыс жауап: C.");
  await page.getByRole("button", { name: "Жалғастыру", exact: true }).click();
  await options.nth(0).click();
  await expect(page.getByRole("status")).toContainText("Дұрыс жауап: E.");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  await page.screenshot({
    path: "output/delivery-review/training-kk-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Жалғастыру", exact: true }).click();
  await page
    .getByRole("button", { name: "Тестті бастау", exact: true })
    .click();
  await expect(page.locator(".new-question")).toBeVisible();
  let state = await snapshot(logical.id);
  const deadline = state.expiresAt;
  assert.equal(
    Date.parse(deadline) - Date.parse(state.timerStartedAt),
    1200000,
  );
  assert.equal(
    state.questions.some((q: any) => "correct" in q || "config" in q),
    false,
  );
  await expect(page.locator(".practice-correct")).toHaveCount(0);
  mark(
    "Abstract training A–F, correct C/E images and explanations in RU/KK; no timer until start or answer hints in main test",
  );

  await page.locator(".new-question .answer-option").first().click();
  await expect
    .poll(async () => (await snapshot(logical.id)).answers.length)
    .toBe(1);
  // Reproduce the stale cached pre-start response that used to open training again.
  await page.evaluate((attempt) => {
    const key = `assessflow.cached.${attempt}`,
      cached = JSON.parse(localStorage.getItem(key)!);
    cached.timerStartedAt = null;
    cached.expiresAt = null;
    localStorage.setItem(key, JSON.stringify(cached));
  }, logical.id);
  await locale("ru");
  await expect(page.locator(".question-number")).toHaveText("Задание 2 / 24");
  await expect(
    page.getByRole("heading", { name: "Перед началом", exact: true }),
  ).toHaveCount(0);
  assert.equal((await snapshot(logical.id)).expiresAt, deadline);
  // A fresh browser has no cached attempt at all.
  const clean = await browser.newContext({
    storageState: { cookies: await context.cookies(), origins: [] },
  });
  const cleanPage = await clean.newPage();
  await cleanPage.goto(base + "/test/" + logical.id);
  await expect(cleanPage.locator(".question-number")).toHaveText(
    "Задание 2 / 24",
  );
  await clean.close();
  mark(
    "Reload with stale cache and new browser both resume at the first unanswered question; server deadline unchanged",
  );

  // The HTML remains accessible while assessment API connectivity is lost.
  await page.route("**/api/attempts/**", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.evaluate((attempt) => {
    const key = `assessflow.cached.${attempt}`,
      cached = JSON.parse(localStorage.getItem(key)!);
    cached.serverTime = new Date(Date.now() - 120000).toISOString();
    localStorage.setItem(key, JSON.stringify(cached));
  }, logical.id);
  await page.reload();
  await expect(page.locator(".new-question")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator(".notice.warning")).toContainText(
    "Нет связи, не закрывайте страницу",
  );
  const clock = (await page.locator(".test-timer").innerText())
    .trim()
    .split(":")
    .map(Number);
  assert.ok(
    clock[0] * 60 + clock[1] <=
      Math.ceil((Date.parse(deadline) - Date.now()) / 1000) + 2,
  );
  await page.locator(".new-question .answer-option").first().click();
  await expect
    .poll(() =>
      page.evaluate(
        (attempt) =>
          Object.keys(
            JSON.parse(
              localStorage.getItem(`assessflow.answers.${attempt}`) || "{}",
            ),
          ).length,
        logical.id,
      ),
    )
    .toBe(1);
  await page.unroute("**/api/attempts/**");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(async () => (await snapshot(logical.id)).answers.length, {
      timeout: 15000,
    })
    .toBe(2);
  assert.equal((await snapshot(logical.id)).expiresAt, deadline);
  await expect
    .poll(() =>
      page.evaluate(
        (attempt) => localStorage.getItem(`assessflow.answers.${attempt}`),
        logical.id,
      ),
    )
    .toBeNull();
  mark(
    "Offline cached resume keeps deadline, queues an answer and automatically sends it on reconnection",
  );

  const sjt = await start("situations");
  await page.goto(base + "/test/" + sjt.id);
  await page
    .getByRole("button", { name: "Перейти к тренировке", exact: true })
    .click();
  await page.locator('input[name="practice-most"]').nth(1).check();
  await page.locator('input[name="practice-least"]').nth(3).check();
  await page
    .getByRole("button", { name: "Проверить ответ", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Неверно.");
  await expect(page.getByRole("status")).toContainText(
    "Наименее эффективно — A",
  );
  await page.locator('input[name="practice-least"]').nth(0).check();
  await page
    .getByRole("button", { name: "Проверить ответ", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Верно.");
  await expect(page.getByRole("status")).not.toContainText("В тесте отметьте");
  await locale("kk");
  await page
    .getByRole("button", { name: "Жаттығуға өту", exact: true })
    .click();
  await page.locator('input[name="practice-most"]').nth(1).check();
  await page.locator('input[name="practice-least"]').nth(0).check();
  await page
    .getByRole("button", { name: "Жауапты тексеру", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Ең тиімсіз нұсқа — A");
  mark(
    "SJT practice validates B/A and rejects B/D with a bilingual training-only explanation",
  );

  for (const test of ["personality", "motivation"]) {
    const a = await start(test);
    await page.goto(base + "/test/" + a.id);
    await locale("ru");
    await expect(page.locator(".test-material").first()).toContainText(
      "Время не ограничено",
    );
    await page
      .getByRole("button", { name: "Начать тест", exact: true })
      .click();
    await expect(page.locator(".new-question").first()).toBeVisible();
    await expect(page.locator(".test-timer")).toHaveCount(0);
    state = await snapshot(a.id);
    assert.equal(state.timeLimitSeconds, null);
    assert.equal(state.expiresAt, null);
    assert.ok(state.timerStartedAt);
    // A break longer than the removed limits must not finish a questionnaire.
    await db.testAttempt.update({
      where: { id: a.id },
      data: { timerStartedAt: new Date(Date.now() - 7200000) },
    });
    await page.reload();
    await expect(page.locator(".new-question").first()).toBeVisible();
    assert.equal((await snapshot(a.id)).status, "in_progress");
    await api(`/attempts/${a.id}/submit`, {}, 400);
    for (const q of state.questions)
      await api(`/attempts/${a.id}/answers`, {
        questionId: q.id,
        revision: 0,
        durationMs: 10000,
        value:
          q.type === "ranking"
            ? {
                top: q.options.slice(0, 3).map((o: any) => o.id),
                bottom: q.options.slice(3, 6).map((o: any) => o.id),
              }
            : 3,
      });
    await api(`/attempts/${a.id}/submit`, {});
    const saved = await db.testAttempt.findUniqueOrThrow({
      where: { id: a.id },
      include: { results: true, _count: { select: { answers: true } } },
    });
    assert.equal(saved.status, "completed");
    assert.equal(saved.expiresAt, null);
    assert.equal(saved.results.length, 1);
    assert.equal(saved._count.answers, state.questions.length);
    mark(
      `${test}: starts without deadline, survives two-hour break, rejects partial submission and scores all saved answers`,
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "output/delivery-review/checks.json",
    JSON.stringify(checks, null, 2),
  );
} catch (error) {
  console.log("Browser errors", errors);
  console.log((await page.locator("body").innerText()).slice(0, 2400));
  throw error;
} finally {
  await browser.close();
  const ids = (
    await db.testAttempt.findMany({
      where: { organizationId: id },
      select: { id: true },
    })
  ).map((a) => a.id);
  await db.userAnswer.deleteMany({ where: { attemptId: { in: ids } } });
  await db.testResult.deleteMany({ where: { attemptId: { in: ids } } });
  await db.testAttempt.deleteMany({ where: { id: { in: ids } } });
  await db.testAssignment.deleteMany({ where: { organizationId: id } });
  await db.campaign.deleteMany({ where: { organizationId: id } });
  await db.organization.deleteMany({ where: { id } });
  await db.user.deleteMany({ where: { id } });
  await db.auditLog.deleteMany({ where: { organizationId: id } });
  await db.$disconnect();
}
