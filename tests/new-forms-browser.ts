import {CONSENT_VERSION} from "../packages/core/assessment-policy";
import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const db = new PrismaClient(),
  id = "qa-browser-" + Date.now(),
  base = "http://localhost:3000";
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("output/new-forms-qa", { recursive: true });
try {
  const a = await db.testAssignment.findFirstOrThrow({
    where: { membership: { user: { email: "employee@assessflow.local" } } },
  });
  await db.user.create({
    data: {
      id,
      name: "Проверка интерфейса",
      email: id + "@assessflow.local",
      emailVerified: true,
      mustChangePassword: false,
      accounts: {
        create: {
          accountId: id,
          providerId: "credential",
          password: await hashPassword("QA-browser!2026"),
        },
      },
      memberships: {
        create: {
          id,
          organizationId: a.organizationId,
          role: "employee",
          consentAt: new Date(),consentVersion:CONSENT_VERSION,
        },
      },
    },
  });
  for (const testId of [
    "verbal",
    "numerical",
    "logical",
    "personality",
    "motivation",
    "situations",
  ])
    await db.testAssignment.create({
      data: {
        organizationId: a.organizationId,
        membershipId: id,
        campaignId: a.campaignId,
        testVersionId: testId + "-v2",
        expertId: a.expertId,
      },
    });
  await page.goto(base + "/login");
  await page.getByLabel(/Логин|Email/i).fill(id + "@assessflow.local");
  await page.getByLabel("Пароль", { exact: true }).fill("QA-browser!2026");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL("**/cabinet");
  await page.locator(".test-card").first().waitFor();
  assert.equal(await page.locator(".test-card").count(), 6);
  await page.screenshot({
    path: "output/new-forms-qa/cabinet.png",
    fullPage: true,
  });
  async function open(name: string) {
    await page.goto(base + "/cabinet");
    const card = page
      .locator(".test-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card.getByRole("button", { name: /Начать тест|Продолжить/ }).click();
    await page
      .locator(".modal")
      .getByRole("button", { name: /Начать тест|Продолжить/ })
      .click();
    await page
      .getByRole("heading", { name: "Перед началом", exact: true })
      .waitFor();
  }
  async function start() {
    const practice = page.getByRole("button", {
      name: "Перейти к тренировке",
      exact: true,
    });
    if (await practice.count()) {
      await practice.click();
      while (
        await page.getByRole("heading", { name: /Тренировка \d/ }).count()
      ) {
        if (await page.locator(".sjt-option").count()) {
          await page
            .locator(".sjt-option")
            .nth(1)
            .getByRole("radio")
            .first()
            .check();
          await page
            .locator(".sjt-option")
            .nth(3)
            .getByRole("radio")
            .last()
            .check();
          await page
            .getByRole("button", { name: "Проверить ответ", exact: true })
            .click();
        } else await page.locator(".answer-option").first().click();
        await page
          .getByRole("button", { name: "Продолжить", exact: true })
          .click();
      }
    }
    await page
      .getByRole("button", { name: "Начать тест", exact: true })
      .click();
    await page.locator(".new-question").first().waitFor();
  }
  await open("Вербальный анализ");
  await start();
  assert.equal(await page.locator(".new-question .answer-option").count(), 3);
  await page.locator(".new-question .answer-option").first().click();
  await page.getByText("Изменения сохранены", { exact: true }).waitFor();
  await page.reload();
  await page.locator(".new-question").waitFor();
  await page.locator(".question-dots button").first().click();
  assert.equal(await page.locator(".answer-option.selected").count(), 1);
  const russian = await page.locator(".question-text").innerText();
  await page.getByRole("button", { name: "ҚАЗ", exact: true }).click();
  await page.waitForTimeout(300);
  assert.notEqual(await page.locator(".question-text").innerText(), russian);
  await page.screenshot({
    path: "output/new-forms-qa/verbal-kk.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "RU", exact: true }).click();
  const timer = await page.locator(".test-timer").innerText();
  await context.setOffline(true);
  await page.getByText("Пауза: нет связи", { exact: true }).waitFor();
  await page.waitForTimeout(17000);
  await context.setOffline(false);
  await page.reload();
  await page.waitForFunction(
    () => !document.body.textContent?.includes("Пауза: нет связи"),
  );
  assert.notEqual(await page.locator(".test-timer").innerText(), "0:00");
  console.log(
    "Browser: verbal autosave/reload, RU/KK switch and offline saving and a continuous timer OK",
    timer,
  );
  await open("Анализ числовой информации");
  await start();
  assert((await page.locator(".material-table td").count()) > 10);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "output/new-forms-qa/numerical-mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open("Абстрактно-логическое мышление");
  await start();
  await page.locator(".image-options img").first().waitFor();
  assert.equal(await page.locator(".image-options img").count(), 6);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLImageElement>('.matrix-question,.image-options img')).every(i=>i.complete&&i.naturalWidth>0));
  assert(
    await page
      .locator(".matrix-question")
      .evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0),
  );
  await page.screenshot({
    path: "output/new-forms-qa/logical.png",
    fullPage: true,
  });
  await open("Мотивационный профиль");
  await start();
  assert.equal(await page.locator(".new-question").count(), 6);
  await page.locator(".question-dots button").last().click();
  assert.equal(await page.locator(".priority-card").count(), 12);
  const cards = page.locator(".priority-card");
  for (let i = 0; i < 3; i++)
    await cards.nth(i).getByRole("checkbox").first().check();
  for (let i = 3; i < 6; i++)
    await cards.nth(i).getByRole("checkbox").last().check();
  await page.getByText("Изменения сохранены", { exact: true }).waitFor();
  await page.reload();
  await page.locator(".question-dots button").last().click();
  assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 6);
  await page.screenshot({
    path: "output/new-forms-qa/priorities.png",
    fullPage: true,
  });
  await open("Управленческие ситуации");
  await start();
  assert.equal(await page.locator(".new-question .sjt-option").count(), 4);
  const row = page.locator(".new-question .sjt-option").first();
  await row.getByRole("radio").first().check();
  assert(await row.getByRole("radio").last().isDisabled());
  await page.screenshot({
    path: "output/new-forms-qa/sjt.png",
    fullPage: true,
  });
  await open("Личностные характеристики");
  await start();
  assert.equal(await page.locator(".scale-options button").count(), 5);
  assert(
    (await page.locator(".test-timer").innerText()).includes("Без ограничения"),
  );
  await page.locator(".question-dots button").nth(30).click();
  await page.screenshot({
    path: "output/new-forms-qa/personality.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser: numeric table/mobile, OMIB images, motivation 6-item pages and saved priorities OK",
  );
} finally {
  await browser.close();
  const assignments = await db.testAssignment.findMany({
      where: { membershipId: id },
    }),
    attempts = await db.testAttempt.findMany({
      where: { assignmentId: { in: assignments.map((x) => x.id) } },
    }),
    ids = attempts.map((x) => x.id);
  await db.testResult.deleteMany({ where: { attemptId: { in: ids } } });
  await db.userAnswer.deleteMany({ where: { attemptId: { in: ids } } });
  await db.testAttempt.deleteMany({ where: { id: { in: ids } } });
  await db.testAssignment.deleteMany({ where: { membershipId: id } });
  await db.membership.deleteMany({ where: { id } });
  await db.user.deleteMany({ where: { id } });
  await db.$disconnect();
}
