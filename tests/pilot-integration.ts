import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { chromium, request, expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { CONSENT_VERSION } from "../packages/core/assessment-policy";
import {
  PILOT_CONSENT_VERSION,
  PILOT_CONSENT_TEXT,
} from "../packages/core/pilot";

if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Local verification only");
const db = new PrismaClient(),
  base = "http://localhost:3000";
const id = `qa-pilot-${Date.now()}`,
  outsiderId = id + "-other";
const password = "Pilot-check!2026",
  folder = "output/pilot-review";
const browser = await chromium.launch();
const employee = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const admin = await browser.newContext(),
  outsider = await request.newContext();
const page = await employee.newPage(),
  adminPage = await admin.newPage();
const checks: string[] = [],
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
adminPage.on("pageerror", (e) => errors.push(e.message));
async function api(
  client: any,
  path: string,
  data?: any,
  status = data === undefined ? 200 : 201,
  headers = {},
) {
  const response = await client.fetch(base + "/api" + path, {
    method: data === undefined ? "GET" : "POST",
    data,
    headers: { Origin: base, ...headers },
  });
  assert.equal(
    response.status(),
    status,
    `${path}: ${(await response.text()).slice(0, 250)}`,
  );
  return response.json();
}
const mark = (text: string) => {
  checks.push(text);
  console.log("PASS", text);
};
const login = (client: any, role: string) =>
  api(
    client,
    "/auth/sign-in/email",
    { email: `${id}-${role}@assessflow.local`, password },
    200,
  );
try {
  await mkdir(folder, { recursive: true });
  for (const [organizationId, purpose] of [
    [id, "pilot"],
    [outsiderId, "assessment"],
  ])
    await db.organization.create({
      data: {
        id: organizationId,
        name: purpose === "pilot" ? "Пилот — проверка" : "Другая организация",
        slug: organizationId,
        purpose,
        matrixConfig: {},
        aiBudget: 0,
      },
    });
  for (const role of ["employee", "admin", "outsider"]) {
    await db.user.create({
      data: {
        id: `${id}-${role}`,
        name: "Проверка " + role,
        email: `${id}-${role}@assessflow.local`,
        emailVerified: true,
        mustChangePassword: false,
        accounts: {
          create: {
            accountId: `${id}-${role}`,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
        memberships: {
          create: {
            id: `${id}-${role}`,
            organizationId: role === "outsider" ? outsiderId : id,
            role: role === "employee" ? "employee" : "admin",
            consentAt: new Date(),
            consentVersion: CONSENT_VERSION,
          },
        },
      },
    });
  }
  for (const orgId of [id, outsiderId])
    await db.campaign.create({
      data: {
        id: orgId,
        organizationId: orgId,
        name: "Проверка пилота",
        endsAt: new Date(Date.now() + 86400000),
      },
    });
  for (const method of [
    "verbal",
    "numerical",
    "logical",
    "personality",
    "motivation",
    "situations",
  ])
    await db.testAssignment.create({
      data: {
        id: `${id}-${method}`,
        organizationId: id,
        campaignId: id,
        membershipId: `${id}-employee`,
        testVersionId: method + "-v2",
      },
    });
  await login(employee.request, "employee");
  await login(admin.request, "admin");
  await login(outsider, "outsider");
  const me = await api(employee.request, "/me");
  assert.equal(me.consent.version, PILOT_CONSENT_VERSION);
  await api(employee.request, "/my/assignments", undefined, 403);
  await api(
    employee.request,
    "/me/consent",
    { accepted: true, version: CONSENT_VERSION },
    400,
  );
  await api(
    employee.request,
    "/me/consent",
    { accepted: false, version: PILOT_CONSENT_VERSION },
    400,
  );
  await page.goto(base + "/cabinet");
  await expect(
    page.getByRole("heading", { name: "Согласие на участие в пилоте" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Принять и продолжить" }),
  ).toBeDisabled();
  await page.screenshot({ path: folder + "/consent-ru.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox").selectOption("kk");
  await expect(
    page.getByRole("heading", { name: "Пилотқа қатысуға келісім" }),
  ).toBeVisible();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: folder + "/consent-kk-mobile.png",
    fullPage: true,
  });
  await page.getByRole("combobox").selectOption("ru");
  await page.getByRole("button", { name: "Отказаться и выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  assert.equal(
    await db.auditLog.count({
      where: { organizationId: id, action: "consent.accepted" },
    }),
    0,
  );
  mark(
    "Pilot-specific RU/KK consent, voluntary refusal, no preselected acceptance, no mobile overflow",
  );
  await login(employee.request, "employee");
  await page.goto(base + "/cabinet");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Принять и продолжить" }).click();
  await expect(page.locator(".test-card")).toHaveCount(6);
  const consent = await db.auditLog.findFirstOrThrow({
    where: { organizationId: id, action: "consent.accepted" },
  });
  assert.deepEqual((consent.detail as any).text, PILOT_CONSENT_TEXT);
  assert.equal((consent.detail as any).version, PILOT_CONSENT_VERSION);
  assert.equal((consent.detail as any).purpose, "pilot");
  assert(
    (consent.detail as any).textHash && (consent.detail as any).acceptedAt,
  );
  mark(
    "Ordinary consent is not reused for pilot; explicit acceptance stores text/version/date/hash atomically",
  );
  await expect(
    page.getByRole("button", { name: "Начать тест", exact: true }).first(),
  ).toBeDisabled();
  await api(
    employee.request,
    `/assignments/${id}-logical/start`,
    { language: "ru" },
    403,
  );
  const permission = {
    employer: "Тестовая компания",
    reference: "Тестовое разрешение для автоматизированной проверки",
    receivedAt: new Date().toISOString().slice(0, 10),
    confirmed: true,
  };
  await api(
    employee.request,
    `/campaigns/${id}/employer-permission`,
    permission,
    403,
  );
  await api(
    admin.request,
    `/campaigns/${outsiderId}/employer-permission`,
    permission,
    404,
  );
  await adminPage.goto(base + "/campaigns");
  await adminPage
    .getByRole("button", { name: "Разрешение работодателя", exact: true })
    .click();
  await adminPage
    .getByLabel("Работодатель участников", { exact: true })
    .fill(permission.employer);
  await adminPage
    .getByLabel("Письмо или описание согласования")
    .fill(permission.reference);
  await adminPage
    .getByLabel("Дата получения разрешения")
    .fill(permission.receivedAt);
  await adminPage.getByLabel("Подтверждаю, что разрешение получено").check();
  await adminPage
    .getByRole("button", { name: "Сохранить подтверждение" })
    .click();
  await expect(
    adminPage.getByText("Разрешение работодателя подтверждено.", {
      exact: false,
    }),
  ).toBeVisible();
  await adminPage.screenshot({
    path: folder + "/campaign.png",
    fullPage: true,
  });
  assert.equal(
    await db.auditLog.count({
      where: {
        organizationId: id,
        action: "pilot.employer_permission_recorded",
      },
    }),
    1,
  );
  mark(
    "Employer permission enforced in UI/API and recorded by pilot administrator with audit",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Начать тест", exact: true }).first(),
  ).toBeEnabled();
  const start = await api(
    employee.request,
    `/assignments/${id}-logical/start`,
    { language: "ru" },
  );
  await api(employee.request, `/attempts/${start.id}/presence`, {
    action: "begin",
  });
  await db.testAttempt.update({
    where: { id: start.id },
    data: {
      timerStartedAt: new Date(Date.now() - 1200000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const empty = await api(employee.request, `/attempts/${start.id}`);
  assert.equal(empty.status, "retry_required");
  const people = await api(admin.request, `/people?campaignId=${id}`);
  assert.equal(people[0].completed, 0);
  assert(people[0].results.every((row: any) => row.score === null));
  await api(
    admin.request,
    "/generated-reports",
    {
      campaignId: id,
      kind: "individual",
      membershipId: `${id}-employee`,
      language: "ru",
    },
    403,
  );
  assert.equal(
    (
      await api(admin.request, "/ai/generate", {
        campaignId: id,
        membershipId: `${id}-employee`,
      })
    ).status,
    "disabled_for_pilot",
  );
  assert.equal(
    await db.generatedReport.count({ where: { organizationId: id } }),
    0,
  );
  assert.equal(await db.aiReport.count({ where: { organizationId: id } }), 0);
  mark(
    "Empty pilot timeout excluded from analytics; AI requests and automatic report pipeline disabled",
  );
  assert(
    (await api(outsider, "/me")).organizations.every(
      (org: any) => org.id !== id,
    ),
  );
  assert(
    (await api(outsider, "/campaigns")).every(
      (campaign: any) => campaign.organizationId === outsiderId,
    ),
  );
  await api(outsider, "/campaigns", undefined, 403, {
    "x-organization-id": id,
  });
  await api(outsider, `/people?campaignId=${id}`, undefined, 404);
  await api(outsider, `/export/people?campaignId=${id}`, undefined, 404);
  await api(
    outsider,
    `/people/${id}-employee?campaignId=${id}`,
    undefined,
    403,
  );
  mark(
    "Another organization's administrator cannot discover, read or export pilot data, including forged organization header",
  );
  assert.deepEqual(errors, []);
  await writeFile(folder + "/checks.json", JSON.stringify(checks, null, 2));
} finally {
  await browser.close();
  await outsider.dispose();
  const orgs = [id, outsiderId];
  await db.userAnswer.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.testResult.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.testAttempt.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.testAssignment.deleteMany({
    where: { organizationId: { in: orgs } },
  });
  await db.campaign.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.organization.deleteMany({ where: { id: { in: orgs } } });
  await db.user.deleteMany({
    where: {
      id: {
        in: ["employee", "admin", "outsider"].map((role) => `${id}-${role}`),
      },
    },
  });
  await db.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.$disconnect();
}
