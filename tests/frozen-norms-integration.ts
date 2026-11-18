import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import { chromium, request, expect } from "playwright/test";
import ExcelJS from "exceljs";
import { db, json } from "../apps/api/src/db";
import { campaignRanks } from "../apps/api/src/cohort";
import { DEFAULT_COMPETENCIES } from "../packages/core/competencies";
import { CONSENT_VERSION } from "../packages/core/assessment-policy";
import { verifyEffectivenessCalibration } from "../packages/core/sjt-calibration";
import { customerReportTemplate } from "../apps/api/src/customer-report";
import { renderPdf } from "../apps/api/src/exports";
import { reportCss } from "../apps/api/src/report-layout";
import { dataReport } from "../packages/core/report-fallback";
import { reportsQueue } from "../apps/api/src/generated-reports";
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Local verification only");
const id = "qa-fixed-" + Date.now(),
  base = "http://localhost:3000",
  password = "Norm-fixture!2026",
  folder = "output/pdf/frozen-norms";
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  }),
  page = await context.newPage();
const admin = await request.newContext(),
  employee = await request.newContext(),
  foreign = await request.newContext();
const checks: string[] = [],
  mark = (s: string) => {
    checks.push(s);
    console.log("PASS", s);
  };
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
  return r;
}
const user = (i: number) => `${id}-p${String(i).padStart(2, "0")}`;
const score = (i: number, testId: string) =>
  testId === "verbal"
    ? {
        algorithm: "cognitive",
        total: i % 31,
        maximum: 30,
        details: [],
        level: (i % 5) + 1,
      }
    : {
        algorithm: "scales",
        scales: {
          N: {
            name: {
              ru: "Эмоциональная устойчивость",
              kk: "Эмоциялық тұрақтылық",
            },
            mean: 2 + (i % 4),
            min: 1,
            max: 5,
            count: 4,
          },
          N1: {
            name: { ru: "Тревожность", kk: "Мазасыздық" },
            mean: 1 + (i % 5),
            min: 1,
            max: 5,
            count: 4,
          },
        },
        qualityFlags: i === 63 ? ["straightlining"] : [],
        reviewRequired: i === 63,
        details: [],
      };
try {
  await mkdir(folder, { recursive: true });
  for (const org of [id, id + "-foreign"])
    await db.organization.create({
      data: {
        id: org,
        name: "Контроль фиксированной нормы",
        slug: org,
        matrixConfig: {},
        aiBudget: 0,
      },
    });
  for (const role of ["admin", "expert", "foreign"]) {
    const uid = id + "-" + role;
    await db.user.create({
      data: {
        id: uid,
        name: "Контрольный " + role,
        email: uid + "@assessflow.local",
        emailVerified: true,
        mustChangePassword: false,
        accounts: {
          create: {
            providerId: "credential",
            accountId: uid,
            password: await hashPassword(password),
          },
        },
        memberships: {
          create: {
            id: uid,
            organizationId: role === "foreign" ? id + "-foreign" : id,
            role: role === "foreign" ? "expert" : role,
          },
        },
      },
    });
  }
  await db.user.createMany({
    data: Array.from({ length: 65 }, (_, i) => ({
      id: user(i),
      name: "Нормирование " + String(i).padStart(2, "0"),
      email: user(i) + "@assessflow.local",
      emailVerified: true,
      mustChangePassword: false,
    })),
  });
  await db.account.create({
    data: {
      providerId: "credential",
      accountId: user(0),
      userId: user(0),
      password: await hashPassword(password),
    },
  });
  await db.membership.createMany({
    data: Array.from({ length: 65 }, (_, i) => ({
      id: user(i),
      organizationId: id,
      userId: user(i),
      role: "employee",
      consentAt: new Date(),
      consentVersion: CONSENT_VERSION,
      position: "Директор филиала",
      unit: "Контрольный филиал",
    })),
  });
  await db.campaign.create({
    data: {
      id,
      organizationId: id,
      name: "Закрытая контрольная группа 65",
      endsAt: new Date(Date.now() + 86400000),
    },
  });
  const versions = await db.testVersion.findMany({
    where: { id: { in: ["verbal-v2", "personality-v2"] } },
    include: { keys: { take: 1, orderBy: { createdAt: "desc" } } },
  });
  assert.equal(versions.length, 2);
  const tasks = Array.from({ length: 65 }, (_, i) =>
    versions.map((v) => ({
      id: `${user(i)}-${v.testId}`,
      organizationId: id,
      campaignId: id,
      membershipId: user(i),
      testVersionId: v.id,
      expertId: id + "-expert",
    })),
  ).flat();
  await db.testAssignment.createMany({ data: tasks });
  await db.testAttempt.createMany({
    data: tasks.map((t) => ({
      id: t.id,
      organizationId: id,
      assignmentId: t.id,
      language: "ru",
      status: t.id === `${user(64)}-personality` ? "in_progress" : "completed",
      scoringKeyId: versions.find((v) => v.id === t.testVersionId)!.keys[0].id,
      submittedAt: new Date(),
    })),
  });
  await db.testResult.createMany({
    data: tasks.map((t) => {
      const i = Number(t.membershipId.split("-p").at(-1));
      return {
        id: t.id,
        organizationId: id,
        attemptId: t.id,
        scoringKeyId: versions.find((v) => v.id === t.testVersionId)!.keys[0]
          .id,
        result: json(
          score(i, versions.find((v) => v.id === t.testVersionId)!.testId),
        ),
      };
    }),
  });
  for (const [client, uid] of [
    [admin, id + "-admin"],
    [context.request, id + "-expert"],
    [employee, user(0)],
    [foreign, id + "-foreign"],
  ] as const)
    await api(
      client,
      "/auth/sign-in/email",
      { email: uid + "@assessflow.local", password },
      200,
    );
  assert.equal((await campaignRanks(id, id)).size, 0);
  await api(
    context.request,
    `/campaigns/${id}/norm/freeze`,
    { confirm: true, reason: "Контроль завершения группы" },
    400,
  );
  await api(
    admin,
    `/campaigns/${id}/norm/freeze`,
    { confirm: true, reason: "Контроль запрета администратору" },
    403,
  );
  await api(employee, `/campaigns/${id}/norm`, undefined, 403);
  await api(foreign, `/campaigns/${id}/norm`, undefined, 404);
  const requested = await (
    await api(admin, "/generated-reports", {
      campaignId: id,
      membershipId: user(0),
      kind: "individual",
      language: "ru",
    })
  ).json();
  let report: any;
  for (let i = 0; i < 60; i++) {
    report = await db.generatedReport.findUniqueOrThrow({
      where: { id: requested.id },
    });
    if (["completed", "manual_review"].includes(report.status)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(report.status, "completed", report.error || "No pre-norm PDF");
  const originalHash = (
    await db.reportArtifact.findUniqueOrThrow({
      where: { reportId: report.id },
    })
  ).sha256;
  assert.equal((report.snapshot as any).norm, null);
  mark(
    "No live norm before completion; preliminary PDF is available; role and tenant guards hold",
  );
  await db.testAttempt.update({
    where: { id: `${user(64)}-personality` },
    data: { status: "completed" },
  });
  await api(
    context.request,
    `/campaigns/${id}/norm/freeze`,
    { confirm: true, reason: "Контроль ожидания проверки качества" },
    400,
  );
  await api(
    context.request,
    `/results/${user(63)}-personality/quality-review`,
    {
      action: "accept",
      reason: "Контрольный эксперт проверил качество ответов",
    },
  );
  await page.goto(base + "/criteria");
  const normPanel = page
    .locator(".panel")
    .filter({ has: page.getByText("Норма закрытой группы", { exact: true }) });
  await normPanel
    .getByLabel("Основание фиксации")
    .fill("Состав контрольной группы и качество результатов проверены.");
  await normPanel
    .getByRole("checkbox", {
      name: "Качество проверено. Подтверждаю окончательную фиксацию нормы.",
    })
    .check();
  await normPanel
    .getByRole("button", { name: "Зафиксировать норму", exact: true })
    .click();
  await expect(
    normPanel.getByText("Норма зафиксирована", { exact: true }),
  ).toBeVisible();
  const norm = await db.frozenNorm.findFirstOrThrow({
      where: { campaignId: id },
    }),
    frozenJSON = JSON.stringify(norm.metrics),
    ranks = await campaignRanks(id, id),
    oldRank = JSON.stringify(ranks.get(`${user(20)}-verbal`));
  await assert.rejects(
    db.frozenNorm.update({
      where: { id: norm.id },
      data: { sourceHash: "changed" },
    }),
  );
  const repeat = await (
    await api(context.request, `/campaigns/${id}/norm/freeze`, {
      confirm: true,
      reason: "Повторное нажатие не меняет норму",
    })
  ).json();
  assert.equal(repeat.id, norm.id);
  assert.equal(
    await db.auditLog.count({
      where: { entityId: norm.id, action: "norm.frozen" },
    }),
    1,
  );
  mark(
    "Expert freezes once through UI; database rejects updates; repeated confirmation is idempotent",
  );
  await db.user.create({
    data: {
      id: user(65),
      name: "Дополнительный участник 66",
      email: user(65) + "@assessflow.local",
      memberships: {
        create: { id: user(65), organizationId: id, role: "employee" },
      },
    },
  });
  const v = versions.find((v) => v.testId === "verbal")!;
  await db.testAssignment.create({
    data: {
      id: user(65),
      organizationId: id,
      campaignId: id,
      membershipId: user(65),
      testVersionId: v.id,
      expertId: id + "-expert",
    },
  });
  await db.testAttempt.create({
    data: {
      id: user(65),
      organizationId: id,
      assignmentId: user(65),
      language: "ru",
      status: "completed",
      scoringKeyId: v.keys[0].id,
      submittedAt: new Date(),
    },
  });
  await db.testResult.create({
    data: {
      organizationId: id,
      attemptId: user(65),
      scoringKeyId: v.keys[0].id,
      result: json(score(30, "verbal")),
    },
  });
  const after = await campaignRanks(id, id);
  assert.equal(JSON.stringify(after.get(`${user(20)}-verbal`)), oldRank);
  assert.equal(
    after.get(
      (await db.testResult.findFirstOrThrow({ where: { attemptId: user(65) } }))
        .id,
    ).reportNorm.n,
    65,
  );
  assert.equal(
    JSON.stringify(
      (await db.frozenNorm.findUniqueOrThrow({ where: { id: norm.id } }))
        .metrics,
    ),
    frozenJSON,
  );
  assert.equal(
    (
      await db.reportArtifact.findUniqueOrThrow({
        where: { reportId: report.id },
      })
    ).sha256,
    originalHash,
  );
  const newReport = await (
    await api(admin, "/generated-reports", {
      campaignId: id,
      membershipId: user(0),
      kind: "individual",
      language: "ru",
      regenerate: true,
    })
  ).json();
  for (let i = 0; i < 60; i++) {
    const r = await db.generatedReport.findUniqueOrThrow({
      where: { id: newReport.id },
    });
    if (r.readyAt) {
      assert.equal((r.snapshot as any).norm.id, norm.id);
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const pdf = await api(admin, `/generated-reports/${newReport.id}/pdf`);
  await writeFile(folder + "/individual-frozen-ru.pdf", await pdf.body());
  mark(
    "66th participant uses the old norm; existing ranks, norm payload and PDF bytes stay unchanged; new version records norm ID",
  );
  // SJT authoring: a single actual expert, no fabricated panel, no publication.
  const sjt = await (await api(context.request, "/sjt-expert-key")).json();
  await api(admin, "/sjt-expert-key", undefined, 403);
  await api(employee, "/sjt-expert-key", undefined, 403);
  const ratings = Object.fromEntries(
    sjt.questions.map((q: any) => [
      q.id,
      Object.fromEntries(q.options.map((o: any, i: number) => [o.id, i + 1])),
    ]),
  );
  await api(
    context.request,
    "/sjt-expert-key",
    { version: 0, ratings: {}, approve: true },
    400,
  );
  await api(context.request, "/sjt-expert-key", {
    version: 0,
    ratings,
    approve: true,
  });
  const exported = await (
    await api(context.request, "/sjt-expert-key/export")
  ).json();
  verifyEffectivenessCalibration(exported.questions, exported.config);
  assert.equal(exported.config.calibration.mode, "single");
  assert.equal(exported.config.calibration.experts.length, 1);
  assert.equal(exported.questions.length, 16);
  assert.notEqual(exported.questions[0].id, sjt.questions[0].id);
  assert.equal(
    await db.testVersion.count({ where: { version: exported.version } }),
    0,
  );
  mark(
    "Single-expert SJT key validates and exports with unique question IDs; published tests remain untouched",
  );
  await page.goto(base + "/groups");
  await page
    .getByRole("button", { name: "Добавить группу", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить группу", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить группу", exact: true })
    .click();
  const fieldsets = page.locator("fieldset");
  for (let i = 0; i < 3; i++) {
    const f = fieldsets.nth(i);
    await f
      .getByLabel("Название · RU", { exact: true })
      .fill("Контрольная группа " + i);
    await f
      .getByLabel("Название · KK", { exact: true })
      .fill("Бақылау тобы " + i);
    await f
      .getByLabel("Критерии отнесения · RU", { exact: true })
      .fill("Контрольный критерий ручного распределения");
    await f
      .getByLabel("Критерии отнесения · KK", { exact: true })
      .fill("Қолмен бөлудің бақылау критерийі");
  }
  await page
    .getByRole("button", {
      name: "Утвердить согласованный справочник",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "Справочник утверждён экспертом после согласования с клиентом",
    ),
  ).toBeVisible();
  const scheme = await db.groupScheme.findFirstOrThrow({
      where: { organizationId: id },
      orderBy: { version: "desc" },
    }),
    groupId = (scheme.content as any).groups[0].id;
  await api(
    admin,
    "/group-scheme",
    { version: 1, content: scheme.content, approve: true },
    403,
  );
  await api(employee, `/campaigns/${id}/groups-export`, undefined, 403);
  await api(
    context.request,
    `/campaigns/${id}/groups/${user(0)}`,
    {
      schemeId: scheme.id,
      groupId,
      reason: "Контрольное распределение без итоговых оценок запрещено",
    },
    400,
  );
  const model = await db.competencyModel.create({
    data: {
      organizationId: id,
      version: 1,
      status: "approved",
      content: json(DEFAULT_COMPETENCIES),
      authorId: id + "-expert",
    },
  });
  await db.competencyConsensus.create({
    data: {
      organizationId: id,
      campaignId: id,
      membershipId: user(0),
      modelId: model.id,
      version: 1,
      authorId: id + "-expert",
      scores: json({
        roleId: "director_branch",
        ratings: DEFAULT_COMPETENCIES.competencies.map((c) => ({
          competencyId: c.id,
          value: 3,
          reason: "Контрольная согласованная итоговая оценка.",
          evidenceIds: [`${user(0)}-verbal`],
        })),
      }),
    },
  });
  const person = page
    .locator("tbody tr")
    .filter({ has: page.getByText("Нормирование 00", { exact: true }) });
  await person.getByRole("button", { name: "Назначить группу" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Группа", { exact: true }).selectOption(groupId);
  await dialog
    .getByLabel("Обоснование эксперта")
    .fill("Распределение выполнено по контрольным согласованным критериям.");
  await dialog.getByRole("button", { name: "Сохранить назначение" }).click();
  await expect(dialog).not.toBeVisible();
  const xlsx = await api(admin, `/campaigns/${id}/groups-export`),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(await xlsx.body());
  assert.equal(
    book.worksheets[0].getRow(2).getCell(1).value,
    "Нормирование 00",
  );
  assert.equal(
    book.worksheets[0].getRow(2).getCell(4).value,
    "Контрольная группа 0",
  );
  await page.screenshot({
    path: folder + "/groups-expert.png",
    fullPage: true,
  });
  mark(
    "Configurable three-group scheme and manual expert assignment work through UI; separate named XLSX is access controlled",
  );
  await writeFile(
    folder + "/checks.json",
    JSON.stringify(
      { checks, normId: norm.id, method: (norm.metrics as any).method },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await admin.dispose();
  await employee.dispose();
  await foreign.dispose();
  const attempts = await db.testAttempt.findMany({
      where: { organizationId: id },
      select: { id: true },
    }),
    ids = attempts.map((a) => a.id);
  await db.generatedReport.deleteMany({ where: { organizationId: id } });
  await db.participantGroup.deleteMany({ where: { organizationId: id } });
  await db.groupScheme.deleteMany({ where: { organizationId: id } });
  await db.sjtExpertKey.deleteMany({ where: { organizationId: id } });
  await db.competencyConsensus.deleteMany({ where: { organizationId: id } });
  await db.competencyModel.deleteMany({ where: { organizationId: id } });
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
  await reportsQueue.close();
  await db.$disconnect();
}
