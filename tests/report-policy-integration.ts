import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import { chromium, request, expect } from "playwright/test";
import { db, json } from "../apps/api/src/db";
import {
  persistReportPdf,
  makeFallbackAvailable,
} from "../apps/api/src/report-lifecycle";
import { reportsQueue } from "../apps/api/src/generated-reports";
import { renderPdf } from "../apps/api/src/exports";
import { reportCss } from "../apps/api/src/report-layout";
import { customerReportTemplate } from "../apps/api/src/customer-report";
import { paginateProfessionalReport } from "../apps/api/src/report-pagination";
import {
  reportTextIssues,
  REPORT_POLICY_VERSION,
} from "../packages/core/report-policy";
import { dataReport } from "../packages/core/report-fallback";
import { reviewFixture } from "./fixtures/report-review";
import { CONSENT_VERSION } from "../packages/core/assessment-policy";
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Local verification only");
const id = "qa-report-policy-" + Date.now(),
  password = "Report-review!2026",
  base = "http://localhost:3000",
  folder = "output/pdf/report-review";
const browser = await chromium.launch({ headless: true }),
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  page = await ctx.newPage();
const admin = await request.newContext(),
  employee = await request.newContext(),
  other = await request.newContext();
const checks: string[] = [],
  mark = (s: string) => {
    checks.push(s);
    console.log("PASS", s);
  };
async function api(
  client: any,
  path: string,
  body?: any,
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
    `${path}: ${(await r.text()).slice(0, 500)}`,
  );
  return r;
}
try {
  await mkdir(folder, { recursive: true });
  await db.organization.create({
    data: {
      id,
      name: "Проверка новых отчётов",
      slug: id,
      aiBudget: 0,
      matrixConfig: {},
    },
  });
  for (const role of ["admin", "expert", "other", "employee"])
    await db.user.create({
      data: {
        id: id + "-" + role,
        name: role === "employee" ? "Контрольный участник" : `Проверка ${role}`,
        email: id + "-" + role + "@assessflow.local",
        emailVerified: true,
        mustChangePassword: false,
        accounts: {
          create: {
            providerId: "credential",
            accountId: id + "-" + role,
            password: await hashPassword(password),
          },
        },
        memberships: {
          create: {
            id: id + "-" + role,
            organizationId: id,
            role: role === "other" ? "expert" : role,
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
      name: "Контроль выпуска отчётов",
      endsAt: new Date(Date.now() + 86400000),
    },
  });
  const version = await db.testVersion.findFirstOrThrow({
    where: { testId: "verbal", status: "published" },
  });
  await db.testAssignment.create({
    data: {
      organizationId: id,
      campaignId: id,
      membershipId: id + "-employee",
      testVersionId: version.id,
      expertId: id + "-expert",
    },
  });
  const s = reviewFixture(1);
  s.people[0].id = id + "-employee";
  s.people[0].name = "Контрольный участник";
  s.campaign.id = id;
  const c = dataReport(s, "ru");
  c.summary[0].text = "Участник конфликтный.";
  const row = await db.generatedReport.create({
    data: {
      organizationId: id,
      campaignId: id,
      membershipId: id + "-employee",
      kind: "individual",
      language: "ru",
      participantIds: [id + "-employee"],
      snapshot: json(s),
      inputHash: id,
      model: "local-verification",
      prompt: "",
      promptVersion: "test",
      providerConfig: {},
      createdBy: id + "-admin",
      policyVersion: REPORT_POLICY_VERSION,
    },
  });
  await persistReportPdf(row.id, c, "data");
  assert.equal(
    (await db.generatedReport.findUniqueOrThrow({ where: { id: row.id } }))
      .status,
    "manual_review",
  );
  assert.equal(
    await db.reportArtifact.count({ where: { reportId: row.id } }),
    0,
  );
  await makeFallbackAvailable(row.id);
  assert.equal(
    (await db.generatedReport.findUniqueOrThrow({ where: { id: row.id } }))
      .status,
    "manual_review",
  );
  mark("Stoplist blocks PDF; data fallback cannot bypass manual review");
  await db.generatedReport.update({
    where: { id: row.id },
    data: { status: "processing", generationMode: "expert" },
  });
  await makeFallbackAvailable(row.id);
  assert.equal(
    (await db.generatedReport.findUniqueOrThrow({ where: { id: row.id } }))
      .status,
    "processing",
  );
  assert.equal(
    await db.reportArtifact.count({ where: { reportId: row.id } }),
    0,
  );
  await db.generatedReport.update({
    where: { id: row.id },
    data: { status: "manual_review" },
  });
  mark("Automatic fallback cannot overwrite an expert review in progress");
  for (const [client, role] of [
    [admin, "admin"],
    [ctx.request, "expert"],
    [other, "other"],
    [employee, "employee"],
  ] as const)
    await api(
      client,
      "/auth/sign-in/email",
      { email: id + "-" + role + "@assessflow.local", password },
      200,
    );
  await api(admin, "/generated-reports/" + row.id + "/pdf", undefined, 400);
  await api(admin, "/generated-reports/" + row.id + "/review", undefined, 403);
  await api(other, "/generated-reports/" + row.id + "/review", undefined, 403);
  await api(employee, "/generated-reports/" + row.id + "/pdf", undefined, 403);
  mark(
    "Admin cannot download blocked PDF; only assigned expert can edit; employee access remains blocked",
  );
  await page.goto(base + "/reports");
  await page
    .getByRole("button", { name: "Проверка эксперта", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Исправьте перед выпуском PDF")).toBeVisible();
  await dialog
    .getByRole("textbox")
    .first()
    .fill(
      "Результаты объединяют сохранённые данные оценки и практические рекомендации.",
    );
  await dialog
    .getByRole("button", { name: "Проверить и выпустить PDF" })
    .click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  const released = await db.generatedReport.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(released.status, "completed");
  assert.equal(released.generationMode, "expert");
  const pdf = await api(admin, "/generated-reports/" + row.id + "/pdf");
  await writeFile(folder + "/individual-reviewed-ru.pdf", await pdf.body());
  assert.equal(
    await db.auditLog.count({
      where: { entityId: row.id, action: "generated_report.reviewed" },
    }),
    1,
  );
  await page.screenshot({
    path: folder + "/expert-report-center.png",
    fullPage: true,
  });
  mark("Expert edits through UI, PDF is released and review audit is recorded");
  const stale = await api(
    ctx.request,
    "/generated-reports/" + row.id + "/review",
  );
  const payload = await stale.json();
  await api(
    ctx.request,
    "/generated-reports/" + row.id + "/review",
    { content: payload.content, updatedAt: payload.updatedAt },
    400,
  );
  mark("Published report cannot be overwritten by a stale editor");
  // setContent preserves a window's timers; discard the Next.js page before measuring PDFs.
  await page.goto("about:blank");
  for (const [count, kind, language] of [
    [10, "team", "ru"],
    [65, "team", "kk"],
    [1, "individual", "kk"],
  ] as const) {
    const snap = reviewFixture(count);
    if (count > 1)
      snap.people[0].results[1].score.qualityFlags = ["straightlining"];
    const content = dataReport(snap, language, kind),
      rendered = customerReportTemplate(snap, content, {
        kind,
        language,
        createdAt: new Date(),
      });
    const bytes = await renderPdf(
      rendered.html,
      rendered.label,
      language,
      reportCss,
      (text) => assert.deepEqual(reportTextIssues(text), []),
    );
    const prefix = `${kind}-${count}-${language}`;
    await writeFile(`${folder}/${prefix}.pdf`, bytes);
    await page.setContent(
      `<html lang="${language}"><style>${reportCss}</style><body>${rendered.html}</body></html>`,
    );
    await paginateProfessionalReport(page);
    const dimensions = await page.locator(".report-page").evaluateAll((nodes) =>
      nodes.map((n) => ({
        height: n.getBoundingClientRect().height,
        text: n.textContent?.length || 0,
      })),
    );
    assert(dimensions.length >= 5, `${prefix}: ${JSON.stringify(dimensions)}`);
    assert(
      dimensions.every((d) => d.height <= 985 && d.text > 25),
      JSON.stringify(dimensions),
    );
    await page
      .locator(".report-page")
      .nth(1)
      .screenshot({ path: `${folder}/${prefix}-page2.png` });
    await page
      .locator(".report-page")
      .nth(2)
      .screenshot({ path: `${folder}/${prefix}-page3.png` });
    mark(
      `${prefix}: valid PDF, no stop words, paginated without overflow (${dimensions.length} pages)`,
    );
  }
  await writeFile(folder + "/checks.json", JSON.stringify({ checks }, null, 2));
} finally {
  await browser.close();
  await admin.dispose();
  await employee.dispose();
  await other.dispose();
  await db.generatedReport.deleteMany({ where: { organizationId: id } });
  await db.testAssignment.deleteMany({ where: { organizationId: id } });
  await db.campaign.deleteMany({ where: { organizationId: id } });
  await db.membership.deleteMany({ where: { organizationId: id } });
  await db.organization.deleteMany({ where: { id } });
  await db.user.deleteMany({ where: { id: { startsWith: id } } });
  await db.auditLog.deleteMany({ where: { organizationId: id } });
  await reportsQueue.close();
  await db.$disconnect();
}
