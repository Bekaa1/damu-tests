import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
const password = "AssessFlow!2026";
const suffix = Date.now().toString(36);
const catalog = JSON.parse(await readFile("data/catalog.json", "utf8"));
const questionCount = catalog.reduce(
  (total: number, method: any) => total + method.questions.length,
  0,
);
const results: string[] = [];
function pass(s: string) {
  results.push(s);
  console.log("PASS " + s);
}
class Client {
  cookie = "";
  organization = "";
  async request(path: string, method = "GET", body?: unknown, expected = 200) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.organization
          ? { "x-organization-id": this.organization }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = r.headers.getSetCookie();
    if (cookies.length)
      this.cookie = cookies
        .map((c) => c.split(";")[0])
        .filter((c) => !c.endsWith("="))
        .join("; ");
    if (r.status !== expected && !(expected === 200 && r.status === 201)) {
      const text = await r.text();
      throw new Error(
        `${method} ${path} expected ${expected}, got ${r.status}: ${text.slice(0, 200)}`,
      );
    }
    return r;
  }
  async get(path: string, expected = 200) {
    return (await this.request(path, "GET", undefined, expected)).json();
  }
  async post(path: string, body: unknown = {}, expected = 200) {
    return (await this.request(path, "POST", body, expected)).json();
  }
  async patch(path: string, body: unknown) {
    return (await this.request(path, "PATCH", body)).json();
  }
  async login(email: string, pw: string) {
    await this.post("/auth/sign-in/email", { email, password: pw });
    assert(this.cookie);
  }
}
const owner = new Client(),
  admin = new Client(),
  expert = new Client(),
  employee = new Client();
let orgId = "";
const createdUserIds: string[] = [];
try {
  await new Client().get("/me", 401);
  await owner.login("owner@assessflow.local", password);
  assert.equal((await owner.get("/me")).role, "superadmin");
  pass("Session authentication and anonymous access rejection");
  const created = await owner.post("/platform/organizations", {
    name: "Контрольная организация API",
    slug: "qa-" + suffix,
    adminName: "Тестовый Администратор",
    adminEmail: `qa-admin-${suffix}@example.test`,
  });
  orgId = created.organization.id;
  owner.organization = orgId;
  admin.organization = orgId;
  await admin.login(
    `qa-admin-${suffix}@example.test`,
    created.admin.temporaryPassword,
  );
  await admin.get("/people", 403);
  await admin.post("/me/password", {
    currentPassword: created.admin.temporaryPassword,
    newPassword: "Testing!Changed2026",
  });
  pass("Administrator provisioning and mandatory password change");
  const emp = await admin.post("/people", {
    name: "Контрольный Участник",
    email: `qa-employee-${suffix}@example.test`,
    unit: "Филиал",
    locale: "kk",
  });
  const exp = await admin.post("/people", {
    name: "Ответственный Эксперт",
    email: `qa-expert-${suffix}@example.test`,
    unit: "Головной офис",
    role: "expert",
  });
  employee.organization = orgId;
  expert.organization = orgId;
  await employee.login(emp.user.email, emp.temporaryPassword);
  await employee.post("/me/password", {
    currentPassword: emp.temporaryPassword,
    newPassword: "Employee!Changed2026",
  });
  await expert.login(exp.user.email, exp.temporaryPassword);
  await expert.post("/me/password", {
    currentPassword: exp.temporaryPassword,
    newPassword: "Expert!Changed2026",
  });
  const campaign = await admin.post("/campaigns", {
    name: "Контрольная кампания",
    endsAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const availableTests = await admin.get("/tests");
  const latestPublishedVersion = new Map(
    availableTests.map((test: any) => [
      test.id,
      test.versions.find((version: any) => version.status === "published")?.id,
    ]),
  );
  const assignment = {
    campaignId: campaign.id,
    membershipIds: [emp.id],
    testVersionIds: catalog.map(
      (m: any) => latestPublishedVersion.get(m.id) ?? `${m.id}-v1`,
    ),
    expertId: exp.id,
  };
  await admin.post("/assignments", assignment);
  await admin.post("/assignments", assignment);
  const tasks = await employee.get("/my/assignments?campaignId=" + campaign.id);
  assert.equal(tasks.length, 6);
  pass("Six versioned assignments; repeated assignment is idempotent");
  await employee.get("/people?campaignId=" + campaign.id, 403);
  await employee.get("/platform/tests/situations-v1", 403);
  await expert.get("/settings", 403);
  const originalOrg = employee.organization;
  employee.organization = "demo-organization";
  await employee.get("/people", 403);
  employee.organization = originalOrg;
  const demoMember = await db.membership.findFirstOrThrow({
    where: { organizationId: "demo-organization", role: "employee" },
  });
  await admin.get(`/people/${demoMember.id}?campaignId=demo-campaign`, 403);
  const csrf = await fetch(base + "/api/settings", {
    method: "PATCH",
    headers: {
      Cookie: admin.cookie,
      "Content-Type": "application/json",
      "x-organization-id": orgId,
      Origin: "https://untrusted.example",
    },
    body: JSON.stringify({ name: "CSRF" }),
  });
  assert.equal(csrf.status, 403);
  pass(
    "Role checks, tenant ID substitution, foreign participant and CSRF rejected",
  );
  await employee.post(
    `/assignments/${tasks[0].id}/start`,
    { language: "kk" },
    403,
  );
  await employee.post("/me/consent", { accepted: true });
  pass("Consent is required before starting");
  const attempts: any[] = [];
  for (const task of tasks) {
    const started = await employee.post(`/assignments/${task.id}/start`, {
      language: "kk",
    });
    const resume = await employee.post(`/assignments/${task.id}/start`, {
      language: "ru",
    });
    assert.equal(resume.id, started.id);
    const a = await employee.get(`/attempts/${started.id}`);
    assert.equal(a.language, "kk");
    assert.equal(a.scoringKeyId, undefined);
    assert.equal(a.config, undefined);
    await employee.post(`/attempts/${a.id}/submit`, {}, 400);
    const m = catalog.find((m: any) => m.id === task.testVersion.testId);
    for (const [i, q] of a.questions.entries()) {
      const key = m.config.items[q.id];
      const value =
        q.type === "sjt"
          ? { most: key.most, least: key.least }
          : q.type === "scale"
            ? 3
            : key.correct;
      const saved = await employee.post(`/attempts/${a.id}/answers`, {
        questionId: q.id,
        value,
        revision: 0,
      });
      assert.equal(saved.revision, 1);
      if (i === 0) {
        await employee.post(
          `/attempts/${a.id}/answers`,
          { questionId: q.id, value, revision: 0 },
          409,
        );
        const reload = await employee.get(`/attempts/${a.id}`);
        assert.equal(reload.answers[0].revision, 1);
      }
    }
    const submitted = await Promise.all([
      employee.post(`/attempts/${a.id}/submit`),
      employee.post(`/attempts/${a.id}/submit`),
    ]);
    assert.equal(submitted[0].resultId, submitted[1].resultId);
    const result = await db.testResult.findUniqueOrThrow({
      where: { id: submitted[0].resultId },
    });
    const s = result.result as any;
    if (m.algorithm !== "scales") assert.equal(s.total, s.maximum);
    attempts.push({ id: a.id, method: m.id, resultId: result.id });
  }
  pass(
    `${questionCount} bilingual answers, resume, revision conflicts, server scoring and duplicate submission`,
  );
  const details = await expert.get(
    `/people/${emp.id}?campaignId=${campaign.id}`,
  );
  assert.equal(details.allDone, true);
  assert.equal(details.assignments.length, 6);
  const ai = await admin.post("/ai/generate", {
    membershipId: emp.id,
    campaignId: campaign.id,
  });
  assert.equal(ai.status, "awaiting_configuration");
  pass("OpenRouter absence does not interrupt completion; no fake AI result");
  const exercise = await admin.post("/exercises", {
    type: "interview",
    name: { ru: "Структурированное интервью", kk: "Құрылымдалған сұхбат" },
    criteria: [
      {
        id: "planning",
        name: "Планирование",
        indicators: ["Фиксирует сроки и ответственных"],
        scale: [1, 2, 3, 4, 5].map((value) => ({
          value,
          description: `Описание ${value}`,
        })),
        allowNotObserved: true,
      },
    ],
  });
  const observation = await expert.post("/observations", {
    campaignId: campaign.id,
    membershipId: emp.id,
    exerciseId: exercise.id,
    scores: { planning: null },
    notes: "Поведение по данному индикатору в этом упражнении не наблюдалось.",
  });
  assert.equal(observation.scores.planning, null);
  const content = {
    conclusion:
      "Контрольное экспертное заключение по полному набору сохранённых результатов. Используется исключительно для проверки программного процесса.",
    strengths:
      "Выводы сформулированы экспертом на основании первичных результатов.",
    development:
      "Проверить перенос навыков на рабочие задачи в практическом упражнении.",
    risks: "Отсутствуют локальные нормативы; методики требуют согласования.",
    recommendations:
      "Составить план развития и оценить наблюдаемое поведение повторно.",
    developmentPlan: [
      {
        goal: "Планирование",
        action: "Провести рабочую сессию",
        deadline: "30 дней",
        success: "Письменный план с ответственными",
      },
    ],
  };
  const reportPayload = {
    campaignId: campaign.id,
    membershipId: emp.id,
    content,
    matrixX: 2,
    matrixY: 3,
    matrixReason:
      "Оценки выставлены экспертом вручную для проверки матрицы. Не являются кадровым решением.",
  };
  const draft = await expert.post("/reports", reportPayload);
  await employee.get("/reports/" + draft.id, 403);
  await expert.post(
    "/reports",
    {
      ...reportPayload,
      approve: true,
      content: { ...content, developmentPlan: [] },
    },
    400,
  );
  const approved = await expert.post("/reports", {
    ...reportPayload,
    approve: true,
  });
  assert.equal(approved.version, 2);
  assert.equal(
    (await employee.get("/reports/" + approved.id)).report.status,
    "approved",
  );
  assert.deepEqual(
    (await expert.get("/reports/" + draft.id)).report.content,
    content,
  );
  pass(
    "Editable criteria, null observation, manual 9-box and immutable approved report",
  );
  const unassigned = await admin.post("/people", {
    name: "Другой Эксперт",
    email: `qa-other-${suffix}@example.test`,
    unit: "Офис",
    role: "expert",
  });
  const other = new Client();
  other.organization = orgId;
  await other.login(unassigned.user.email, unassigned.temporaryPassword);
  await other.post("/me/password", {
    currentPassword: unassigned.temporaryPassword,
    newPassword: "Another!Changed2026",
  });
  await other.get(`/people/${emp.id}?campaignId=${campaign.id}`, 403);
  pass("Unassigned expert cannot read the participant");
  const xlsx = await admin.request("/export/people?campaignId=" + campaign.id);
  assert(xlsx.headers.get("content-type")?.includes("spreadsheetml"));
  assert((await xlsx.arrayBuffer()).byteLength > 1000);
  pass("Excel export from persisted results");
  const personal = await admin.get("/people/" + emp.id + "/data");
  assert.equal(personal.user.email, emp.user.email);
  assert.equal(personal.assignments.length, 6);
  assert.equal(personal.user.password, undefined);
  await employee.get("/people/" + emp.id + "/data", 403);
  pass("Personal data export excludes credentials and respects role checks");
  await admin.post("/people/member-owner/reset-password", {}, 403);
  const disposable = await admin.post("/people", {
    name: "Удаляемый Участник",
    email: "qa-delete-" + suffix + "@example.test",
    unit: "Тест",
  });
  await admin.request(
    "/people/" + disposable.id,
    "DELETE",
    { confirmEmail: "wrong@example.test" },
    400,
  );
  await admin.request("/people/" + disposable.id, "DELETE", {
    confirmEmail: disposable.user.email,
  });
  assert.equal(
    await db.membership.findUnique({ where: { id: disposable.id } }),
    null,
  );
  pass(
    "Personal data deletion requires exact confirmation and removes the employee",
  );
  if (process.env.TEST_PDF === "true") {
    await mkdir("artifacts", { recursive: true });
    const pdf = Buffer.from(
      await (await expert.request(`/reports/${approved.id}/pdf`)).arrayBuffer(),
    );
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    await writeFile("artifacts/assessflow-individual.pdf", pdf);
    const team = Buffer.from(
      await (
        await admin.request("/export/team?campaignId=" + campaign.id)
      ).arrayBuffer(),
    );
    assert.equal(team.subarray(0, 4).toString(), "%PDF");
    await writeFile("artifacts/assessflow-team.pdf", team);
    pass("Individual and team PDF generation");
    await expert.patch("/me/locale", { locale: "kk" });
    const kk = Buffer.from(
      await (
        await expert.request("/reports/" + approved.id + "/pdf")
      ).arrayBuffer(),
    );
    await writeFile("artifacts/assessflow-individual-kk.pdf", kk);
    await expert.patch("/me/locale", { locale: "ru" });
    const asset = await expert.post("/files", {
      campaignId: campaign.id,
      membershipId: emp.id,
      name: "observation.pdf",
      contentType: "application/pdf",
      base64: pdf.toString("base64"),
    });
    const stored = Buffer.from(
      await (await expert.request("/files/" + asset.id)).arrayBuffer(),
    );
    assert.deepEqual(stored, pdf);
    await employee.get("/files/" + asset.id, 403);
    await other.get("/files/" + asset.id, 403);
    pass("Private S3 upload/download and file permission checks");
  }
  // Real HTTP sessions for 30 distinct participants; shared office IP must not block them.
  if (process.env.TEST_LOAD === "true") {
    const clients: { client: Client; id: string }[] = [];
    for (let i = 0; i < 30; i++) {
      const p = await admin.post("/people", {
        name: `Нагрузочный Участник ${i + 1}`,
        email: `qa-load-${suffix}-${i}@example.test`,
        unit: "Нагрузочная проверка",
      });
      const c = new Client();
      c.organization = orgId;
      await c.login(p.user.email, p.temporaryPassword);
      await c.post("/me/password", {
        currentPassword: p.temporaryPassword,
        newPassword: `LoadTest!Participant${i}`,
      });
      await c.post("/me/consent", { accepted: true });
      clients.push({ client: c, id: p.id });
    }
    await admin.post("/assignments", {
      ...assignment,
      membershipIds: clients.map((c) => c.id),
      testVersionIds: ["verbal-v1"],
    });
    const start = Date.now();
    await Promise.all(
      clients.map(async ({ client }) => {
        const tasks = await client.get(
          "/my/assignments?campaignId=" + campaign.id,
        );
        const started = await client.post(`/assignments/${tasks[0].id}/start`, {
          language: "ru",
        });
        const a = await client.get("/attempts/" + started.id);
        for (const q of a.questions)
          await client.post(`/attempts/${a.id}/answers`, {
            questionId: q.id,
            value: q.options[0].id,
            revision: 0,
          });
        await client.post(`/attempts/${a.id}/submit`);
      }),
    );
    pass(
      `30 simultaneous participant flows completed in ${Date.now() - start} ms`,
    );
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    process.env.TEST_PDF === "true" && process.env.TEST_LOAD === "true"
      ? "artifacts/integration-results.json"
      : "artifacts/integration-smoke.json",
    JSON.stringify(
      { date: new Date().toISOString(), checks: results },
      null,
      2,
    ),
  );
} finally {
  if (orgId) {
    const { removeStoredFiles } = await import("../apps/api/src/storage");
    const fileMembers = await db.fileAsset.findMany({
      where: { organizationId: orgId },
      select: { membershipId: true },
    });
    for (const id of new Set(fileMembers.map((f) => f.membershipId)))
      await removeStoredFiles(orgId, id);
    const members = await db.membership.findMany({
      where: { organizationId: orgId },
    });
    createdUserIds.push(...members.map((m) => m.userId));
    await db.$transaction(async (tx) => {
      for (const table of [
        "user_answers",
        "test_results",
        "test_attempts",
        "test_assignments",
        "ai_reports",
        "expert_observations",
        "final_reports",
        "file_assets",
        "assessment_exercises",
        "audit_logs",
      ])
        await tx.$executeRawUnsafe(
          `DELETE FROM ${table} WHERE "organizationId" = $1`,
          orgId,
        );
      await tx.organization.delete({ where: { id: orgId } });
      await tx.user.deleteMany({ where: { id: { in: createdUserIds } } });
    });
  }
  await db.$disconnect();
  const { db: sharedDb } = await import("../apps/api/src/db");
  await sharedDb.$disconnect();
}
