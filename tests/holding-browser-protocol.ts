import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PrismaClient, type UserAnswer, type TestResult, type ScoringKey, type TestAttempt, type AuditLog } from "@prisma/client";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { hashPassword } from "better-auth/crypto";
import catalog from "../data/catalog.json";
import { assertLocalHoldingEnvironment, assertDemoOwnership, assertLocalSystemOperatorOwnership, localSystemOperatorPlan, untimedTrainingExemption, DEMO_ORGANIZATION_ID, DEMO_CAMPAIGN_ID, DEMO_TEST_IDS, syntheticAnswers } from "../packages/core/demo-policy";
import { calculateScore, type QuestionInput, type ScoringConfig } from "../packages/core/scoring";
import { externalAiAllowed } from "../packages/core/data-policy";
import { prepareHoldingDemo, DEMO_ARTIFACT_DIR, DEMO_CREDENTIAL_FILE, type DemoCredentials } from "../scripts/prepare-holding-demo";

// All writes are confined to the guarded local DB and synthetic fixture namespace.
const ROOT = "/root/research/damu-tests/implementation/timer-protocol";
const base = process.env.BASE_URL || "http://localhost:3301";
const runId = `holding-browser-${new Date().toISOString().replace(/[^0-9]/g, "")}-${randomBytes(3).toString("hex")}`;
const directory = `${ROOT}/${runId}`;
const operatorSmokeOnly = process.argv.includes("--operator-smoke-only");
const dimensions = ["training_before_start", "configured_limit_and_start", "save_and_resume", "offline_queue_and_reconnect", "finish_and_expiry", "result_ready_within_300s", "pdf_ready_within_300s", "admin_view_and_versioned_recalculation"] as const;
type Dimension = typeof dimensions[number];
type Cell = { status: "not_tested" | "not_applicable" | "pass" | "partial" | "fail" | "blocked"; at?: string; evidence?: any; error?: string };
type Row = { testId: string; attemptId?: string; completedAt?: string; cells: Record<Dimension, Cell> };
const rows: Row[] = DEMO_TEST_IDS.map(testId => ({ testId, cells: Object.fromEntries(dimensions.map(d => [d, { status: "not_tested" }])) as Record<Dimension, Cell> }));
const journal: { at: string; method: string; path: string; status: number }[] = [];
const observations: any[] = [];
const errors: string[] = [];
let browser: Browser | undefined, db: PrismaClient | undefined;
const screenshotPaths: string[] = [];
let topError: string | undefined;
let samplePdfPath: string | null = null;
const openedContexts = new Set<BrowserContext>();
let operatorPlan: ReturnType<typeof localSystemOperatorPlan> | undefined;
let operatorCreatedAt: Date | undefined;
let operatorContext: BrowserContext | undefined;
let credentialsFingerprintBefore: string | undefined;
async function save() {
  const matrix = { runId, mode: operatorSmokeOnly ? "operator_smoke_only" : "six_form_protocol", generatedAt: new Date().toISOString(), target: base, data: "synthetic_only", organizationId: DEMO_ORGANIZATION_ID, realTimerWaitClaim: false, expiryFixtureLabel: "deadline advanced in synthetic fixture", dimensions, tests: rows, observations, errors, readinessError: topError, screenshots: screenshotPaths, requests: journal };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/matrix.json`, JSON.stringify(matrix, null, 2));
  await writeFile(`${ROOT}/${operatorSmokeOnly ? "operator-smoke-latest" : "latest"}.json`, JSON.stringify({ runId, matrix: `${directory}/matrix.json` }, null, 2));
}
async function mark(row: Row, dimension: Dimension, status: Cell["status"], evidence: any) {
  row.cells[dimension] = { status, at: new Date().toISOString(), evidence };
  await save();
}
async function shot(page: Page, name: string) {
  const path = `${directory}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  screenshotPaths.push(path); return path;
}
async function waitUntil<T>(getter: () => Promise<T>, good: (value: T) => boolean, timeoutMs = 20000): Promise<T> {
  const end = Date.now() + timeoutMs;
  do { const value = await getter(); if (good(value)) return value; await new Promise(r => setTimeout(r, 250)); } while (Date.now() < end);
  throw Error(`Observed condition not met within ${timeoutMs}ms`);
}
async function contextFor(login: { email: string; password: string }) {
  const context = await browser!.newContext({ viewport: { width: 1440, height: 1000 } });
  openedContexts.add(context);
  await context.route("**/*", route => {
    const u = new URL(route.request().url());
    if (["data:", "blob:"].includes(u.protocol) || ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return route.continue();
    return route.abort("blockedbyclient");
  });
  const response = await context.request.post(`${base}/api/auth/sign-in/email`, { headers: { Origin: base }, data: login, timeout: 15000 });
  assert.equal(response.status(), 200, "Synthetic local login must succeed; credential values are never logged");
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && !url.pathname.includes("/auth/")) journal.push({ at: new Date().toISOString(), method: response.request().method(), path: url.pathname, status: response.status() });
  });
  return { context, page };
}
async function api(context: BrowserContext, path: string, data?: unknown, expected?: number) {
  const response = await context.request.fetch(`${base}/api${path}`, { method: data === undefined ? "GET" : "POST", headers: { Origin: base, "x-organization-id": DEMO_ORGANIZATION_ID }, data, timeout: 45000 });
  journal.push({ at: new Date().toISOString(), method: data === undefined ? "GET" : "POST", path, status: response.status() });
  if (expected !== undefined) assert.equal(response.status(), expected, `${path}: unexpected status`);
  else assert(response.ok(), `${path}: HTTP ${response.status()} ${(await response.text()).slice(0, 400)}`);
  return response.headers()["content-type"]?.includes("json") ? response.json() : null;
}
async function localOperatorSession(login: DemoCredentials, versionId: string) {
  assert(db, "Local DB is required for the ephemeral QA operator");
  const restricted = await contextFor(login.keyReviewer);
  await api(restricted.context, `/platform/tests/${versionId}`, undefined, 403);
  observations.push({ demoKeyReviewer: { demoOnly: true, platformAdminFlagDoesNotBypass: true, methodReadStatus: 403, accountUnchanged: true } });
  const plan = localSystemOperatorPlan({ ...process.env, BASE_URL: base }, runId);
  // Fresh create only: a collision must fail without adopting/resetting any account.
  // This password exists solely in process memory and is never persisted in artifacts.
  const password = randomBytes(36).toString("base64url") + "!aA1";
  const passwordHash = await hashPassword(password);
  const created = await db.$transaction(async tx => {
    const user = await tx.user.create({ data: { ...plan.user, accounts: { create: { providerId: "credential", accountId: plan.user.id, password: passwordHash } } }, select: { id: true, createdAt: true } });
    await tx.auditLog.create({ data: { actorId: user.id, organizationId: null, action: "holding.local_system_operator_created", entityId: user.id, detail: { ...plan.provenance, note: "Run-owned test mechanism, not demo/Fund access; generated memory-only password, no organization membership" } } });
    return user;
  });
  operatorPlan = plan;
  operatorCreatedAt = created.createdAt;
  const readback = await db.user.findUniqueOrThrow({ where: { id: created.id }, select: { id: true, email: true, name: true, demoOnly: true, platformAdmin: true, _count: { select: { memberships: true } } } });
  assertLocalSystemOperatorOwnership({ ...process.env, BASE_URL: base }, runId, { ...readback, membershipCount: readback._count.memberships });
  const active = await contextFor({ email: plan.user.email, password });
  operatorContext = active.context;
  const method = await api(active.context, `/platform/tests/${versionId}`, undefined, 200);
  assert.equal(method?.id, versionId, "The ephemeral genuine platform operator must reach the real method, not just a 200/null response");
  observations.push({ localSystemOperator: { id: created.id, demoOnly: false, platformAdmin: true, membershipCount: 0, methodReadStatus: 200, createdAt: created.createdAt.toISOString(), provenance: plan.provenance, plaintextCredentialsPersisted: false, credentialsDisclosed: false } });
  await save();
  return { ...active, restrictedContext: restricted.context };
}
async function cleanupLocalOperator() {
  if (!operatorPlan || !operatorCreatedAt || !db) return;
  assertLocalHoldingEnvironment({ ...process.env, BASE_URL: base });
  const plan = operatorPlan, createdAt = operatorCreatedAt;
  let signOutStatus: number | null = null;
  if (operatorContext) {
    const response = await operatorContext.request.post(`${base}/api/auth/sign-out`, { headers: { Origin: base }, timeout: 10000 }).catch(() => null);
    signOutStatus = response?.status() ?? null;
    await operatorContext.close().catch(() => {});
    openedContexts.delete(operatorContext);
  }
  const revokedSessions = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${plan.user.id} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: plan.user.id }, include: { _count: { select: { memberships: true } }, accounts: { select: { providerId: true, accountId: true } } } });
    assertLocalSystemOperatorOwnership({ ...process.env, BASE_URL: base }, runId, { ...user, membershipCount: user._count.memberships });
    assert.equal(user.createdAt.getTime(), createdAt.getTime(), "Cleanup cannot adopt a pre-existing/replaced operator");
    assert.deepEqual(user.accounts, [{ providerId: "credential", accountId: plan.user.id }]);
    const provenance = await tx.auditLog.findFirst({ where: { entityId: plan.user.id, action: "holding.local_system_operator_created", detail: { path: ["runId"], equals: runId } } });
    assert(provenance && (provenance.detail as any).partOfDemoAccess === false, "Run-owned creation provenance required before cleanup");
    const sessions = await tx.session.deleteMany({ where: { userId: plan.user.id } });
    const removed = await tx.user.deleteMany({ where: { id: plan.user.id, email: plan.user.email, createdAt, demoOnly: false, platformAdmin: true, memberships: { none: {} } } });
    assert.equal(removed.count, 1, "Delete only the exact fresh run-owned local operator");
    await tx.auditLog.create({ data: { actorId: null, organizationId: null, action: "holding.local_system_operator_deleted", entityId: plan.user.id, detail: { ...plan.provenance, sessionsRevoked: sessions.count, note: "Exact run-owned account only; existing demo users, credentials and attempts preserved" } } });
    return sessions.count;
  });
  const remaining = { users: await db.user.count({ where: { id: plan.user.id } }), accounts: await db.account.count({ where: { userId: plan.user.id } }), sessions: await db.session.count({ where: { userId: plan.user.id } }), memberships: await db.membership.count({ where: { userId: plan.user.id } }) };
  assert.deepEqual(remaining, { users: 0, accounts: 0, sessions: 0, memberships: 0 });
  observations.push({ localSystemOperatorCleanup: { id: plan.user.id, signOutStatus, revokedSessions, remaining, verifiedAt: new Date().toISOString() } });
}
async function startInBrowser(page: Page, context: BrowserContext, assignmentId: string, label: string, row?: Row) {
  const started = await api(context, `/assignments/${assignmentId}/start`, { language: "ru" });
  const snapshot = () => api(context, `/attempts/${started.id}`);
  await page.goto(`${base}/test/${started.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("heading", { name: "Перед началом", exact: true }).waitFor();
  let state = await snapshot();
  const beforeStart = state;
  assert.equal(state.timerStartedAt, null);
  const introduction = await shot(page, `${label}-01-before-start`);
  const trainingButton = page.getByRole("button", { name: "Перейти к тренировке", exact: true });
  let practiceCount = 0;
  const practiceScreens: string[] = [];
  if (await trainingButton.count()) {
    await trainingButton.click();
    while (await page.getByRole("heading", { name: /Тренировка \d/ }).count()) {
      assert(practiceCount < 10, "Training loop must be bounded");
      if (await page.locator('input[name="practice-most"]').count()) {
        await page.locator('input[name="practice-most"]').nth(0).check();
        await page.locator('input[name="practice-least"]').nth(1).check();
        await page.getByRole("button", { name: "Проверить ответ", exact: true }).click();
      } else await page.locator(".answer-option").first().click();
      await page.getByRole("status").filter({ hasText: /Правильный|Верно|Неверно/ }).waitFor();
      assert.equal((await snapshot()).timerStartedAt, null);
      practiceScreens.push(await shot(page, `${label}-02-training-${++practiceCount}`));
      await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    }
  }
  await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  await page.locator(".new-question").first().waitFor();
  state = await snapshot();
  assert(state.timerStartedAt, "Main test start must be server recorded");
  if (row) {
    const source = catalog.find(form => form.id === row.testId);
    const exemption = !practiceCount && source ? untimedTrainingExemption(row.testId, source, beforeStart, state) : undefined;
    await mark(row, "training_before_start", practiceCount ? "pass" : exemption ? "not_applicable" : "partial", { introduction, practiceCount, practiceScreens, timerBeforePractice: beforeStart.timerStartedAt, deadlineBeforeStart: beforeStart.expiresAt, deadlineAfterStart: state.expiresAt, source: exemption, note: practiceCount ? "Actual browser training completed before timer start" : exemption?.reason ?? "No observed interactive training and no verified canonical untimed exemption; requirement not claimed passed." });
  }
  return { id: started.id as string, state };
}
async function choose(page: Page, state: any, index: number, value: any) {
  const q = state.questions[index];
  await page.locator(".question-dots button").nth(index).click();
  const panel = page.locator(".new-question").nth(state.questions.length === 49 && index < 48 ? index % 6 : 0);
  await panel.waitFor();
  if (["single", "image"].includes(q.type)) await panel.locator(".answer-option").nth(q.options.findIndex((o: any) => o.id === value)).click();
  else if (q.type === "scale") await panel.locator(".scale-options button").nth(Number(value) - 1).click();
  else if (q.type === "sjt") {
    await panel.locator(".sjt-option").nth(q.options.findIndex((o: any) => o.id === value.most)).getByRole("radio").first().check();
    await panel.locator(".sjt-option").nth(q.options.findIndex((o: any) => o.id === value.least)).getByRole("radio").last().check();
  } else if (q.type === "ranking") {
    for (const kind of ["top", "bottom"] as const) for (const id of value[kind]) await panel.locator(".priority-card").nth(q.options.findIndex((o: any) => o.id === id)).getByRole("checkbox").nth(kind === "top" ? 0 : 1).check();
  } else throw Error(`Unsupported installed browser question type: ${q.type}`);
}
async function pdf(context: BrowserContext, campaignId: string, kind: "individual" | "team", file: string, membershipId?: string) {
  const requestedAt = Date.now();
  const created = await api(context, "/generated-reports", { campaignId, kind, language: "ru", ...(membershipId ? { membershipId } : {}) });
  const report = await waitUntil(async () => (await api(context, `/generated-reports?campaignId=${campaignId}&kind=${kind}`)).find((r: any) => r.id === created.id), r => r && ["completed", "manual_review", "failed"].includes(r.status), 300000);
  assert.equal(report.status, "completed", `Data-only ${kind} PDF status: ${report.status}`);
  assert(report.readyAt, "Persisted PDF readiness time required");
  const response = await context.request.get(`${base}/api/generated-reports/${report.id}/pdf`, { headers: { "x-organization-id": DEMO_ORGANIZATION_ID }, timeout: 45000 });
  assert(response.ok(), `PDF download HTTP ${response.status()}`);
  const bytes = await response.body(); assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  await writeFile(file, bytes);
  const readback = await db!.generatedReport.findUniqueOrThrow({ where: { id: report.id }, include: { artifact: true } });
  assert(readback.artifact && readback.artifact.bytes.length === bytes.length, "PDF artifact readback must match the actual downloaded file");
  assert.notEqual(readback.generationMode, "ai", "External AI must not generate synthetic sample");
  return { id: report.id, file, bytes: bytes.length, readyAt: report.readyAt, generationMode: readback.generationMode, requestToDownloadedMs: Date.now() - requestedAt, artifactSha256: readback.artifact.sha256 };
}
try {
  await mkdir(directory, { recursive: true });
  assertLocalHoldingEnvironment({ ...process.env, BASE_URL: base });
  assert.equal(externalAiAllowed({ purpose: "assessment", dataMode: "synthetic" }), false);
  const fixture = operatorSmokeOnly ? undefined : await prepareHoldingDemo();
  const ready = await fetch(base, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!ready || !ready.ok) throw Error("Readiness: parent's LOCAL web/API services are not available; no duplicate server started");
  db = new PrismaClient();
  const org = await db.organization.findUniqueOrThrow({ where: { id: DEMO_ORGANIZATION_ID }, include: { memberships: { include: { user: true } } } });
  assertDemoOwnership(org, org.memberships.map(m => m.user));
  const credentialBytes = await readFile(DEMO_CREDENTIAL_FILE);
  credentialsFingerprintBefore = createHash("sha256").update(credentialBytes).digest("hex");
  const login: DemoCredentials = JSON.parse(credentialBytes.toString("utf8"));
  browser = await chromium.launch({ headless: true });
  if (operatorSmokeOnly) {
    await localOperatorSession(login, "verbal-v2");
    observations.push({ operatorSmoke: { status: "pass", scope: "Live demo-only 403 versus fresh local system operator 200; no six-form run, no key/result/attempt mutation" } });
  } else {
  assert(fixture, "Prepared canonical synthetic fixture required for six-form protocol");
  const admin = await contextFor(login.admin);
  await admin.page.goto(`${base}/people`, { waitUntil: "domcontentloaded" });
  await admin.page.getByText("Демо-участник 01", { exact: true }).first().waitFor();
  const adminRoster = await shot(admin.page, "00-admin-synthetic-roster");
  observations.push({ adminRoster, fixture: `${DEMO_ARTIFACT_DIR}/fixture.json` });
  const sample = await pdf(admin.context, DEMO_CAMPAIGN_ID, "team", `${DEMO_ARTIFACT_DIR}/Холдинг-синтетический-командный-образец-ru.pdf`);
  samplePdfPath = sample.file;
  observations.push({ syntheticTeamSample: sample, note: "65 generated synthetic results. Not real participants, observed behaviors, national norms, expert approval or browser/timer evidence." });
  await writeFile(`${DEMO_ARTIFACT_DIR}/sample-pdf.json`, JSON.stringify(sample, null, 2));
  if (!process.argv.includes("--sample-only")) {
    const campaignId = runId;
    await db.campaign.create({ data: { id: campaignId, organizationId: org.id, name: `Браузерный протокол — вымышленные данные ${runId}`, country: "Казахстан", startsAt: new Date(), endsAt: new Date(Date.now() + 86400000), description: "Synthetic actual-browser run; separate from 65 generated sample records. Deadline acceleration only in separate expiry campaign." } });
    const employee = await contextFor(login.employee);
    const versions = await db.testVersion.findMany({ where: { id: { in: fixture.forms.map(v => v.versionId) } }, include: { questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } }, keys: { orderBy: { createdAt: "desc" }, take: 1 } } });
    const completedRows: Row[] = [];
    for (const row of rows) {
      let currentDimension: Dimension = "training_before_start";
      try {
        const v = versions.find(v => v.testId === row.testId)!;
        const assignment = await db.testAssignment.create({ data: { organizationId: org.id, campaignId, membershipId: "holding-demo-participant-01", testVersionId: v.id, expertId: "holding-demo-expert" } });
        const started = await startInBrowser(employee.page, employee.context, assignment.id, row.testId, row);
        row.attemptId = started.id;
        const state = started.state, deadline = state.expiresAt;
        currentDimension = "configured_limit_and_start";
        const expectedLimit = ({ verbal: 1320, numerical: 1500, logical: 1200, situations: 1800 } as Record<string, number>)[row.testId] ?? null;
        assert.equal(state.timeLimitSeconds, expectedLimit);
        if (expectedLimit) {
          assert.equal(Date.parse(deadline) - Date.parse(state.timerStartedAt), expectedLimit * 1000);
          assert.equal(await employee.page.locator(".test-timer").count(), 1);
        } else { assert.equal(deadline, null); assert.equal(await employee.page.locator(".test-timer").count(), 0); }
        await mark(row, currentDimension, "pass", { expectedLimit, timeLimitSeconds: state.timeLimitSeconds, timerStartedAt: state.timerStartedAt, expiresAt: deadline, serverTime: state.serverTime, screenshot: await shot(employee.page, `${row.testId}-03-main-started`) });
        const config = v.keys[0].config as unknown as ScoringConfig;
        const answers = syntheticAnswers(row.testId, v.questions as unknown as QuestionInput[], config, 1);
        const snapshot = () => api(employee.context, `/attempts/${started.id}`);
        currentDimension = "save_and_resume";
        await choose(employee.page, state, 0, answers[state.questions[0].id]);
        await waitUntil(snapshot, s => s.answers.some((a: any) => a.questionId === state.questions[0].id));
        await employee.page.reload();
        await employee.page.locator(".new-question").first().waitFor();
        let saved = await snapshot();
        assert.equal(saved.expiresAt, deadline);
        assert.deepEqual(saved.answers.find((a: any) => a.questionId === state.questions[0].id).value, answers[state.questions[0].id]);
        await mark(row, currentDimension, "pass", { deadlineBefore: deadline, deadlineAfter: saved.expiresAt, savedAnswerCount: saved.answers.length, screenshot: await shot(employee.page, `${row.testId}-04-resumed`) });
        currentDimension = "offline_queue_and_reconnect";
        await employee.context.setOffline(true);
        await employee.page.locator(".notice.warning").filter({ hasText: "Нет связи" }).waitFor();
        await choose(employee.page, state, 1, answers[state.questions[1].id]);
        const queued = await waitUntil(() => employee.page.evaluate(id => JSON.parse(localStorage.getItem(`assessflow.answers.${id}`) || "{}"), started.id), q => Object.keys(q).length > 0);
        const offlineScreenshot = await shot(employee.page, `${row.testId}-05-offline-queued`);
        const beforeReconnect: UserAnswer[] = await db.userAnswer.findMany({ where: { attemptId: started.id } });
        assert.equal(beforeReconnect.some(a => a.questionId === state.questions[1].id), false);
        await employee.context.setOffline(false);
        saved = await waitUntil(snapshot, s => s.answers.some((a: any) => a.questionId === state.questions[1].id));
        await waitUntil(() => employee.page.evaluate(id => localStorage.getItem(`assessflow.answers.${id}`), started.id), q => q === null);
        assert.equal(saved.expiresAt, deadline);
        await mark(row, currentDimension, "pass", { queuedQuestionIds: Object.keys(queued), offlineServerAnswerCount: beforeReconnect.length, reconnectedServerAnswerCount: saved.answers.length, deadlineUnchanged: saved.expiresAt === deadline, offlineScreenshot, reconnectedScreenshot: await shot(employee.page, `${row.testId}-06-reconnected`) });
        currentDimension = "finish_and_expiry";
        // Remaining answers are entered via actual rendered controls, not inserted through the API/DB.
        for (let i = 2; i < state.questions.length; i++) await choose(employee.page, state, i, answers[state.questions[i].id]);
        await waitUntil(snapshot, s => s.answers.length === state.questions.length, 30000);
        await employee.page.locator(".question-dots button").last().click();
        await employee.page.getByRole("button", { name: "Завершить тест", exact: true }).click();
        await employee.page.getByRole("button", { name: "Подтвердить завершение", exact: true }).click();
        const attempt = await waitUntil(() => db!.testAttempt.findUniqueOrThrow({ where: { id: started.id }, include: { results: true, _count: { select: { answers: true } } } }), a => a.status !== "in_progress");
        assert.equal(attempt.status, "completed");
        assert.equal(attempt._count.answers, state.questions.length);
        row.completedAt = attempt.submittedAt!.toISOString();
        completedRows.push(row);
        await mark(row, currentDimension, expectedLimit ? "partial" : "pass", { manualSubmit: true, status: attempt.status, submittedAt: row.completedAt, questionCount: state.questions.length, savedAnswerCount: attempt._count.answers, expiry: expectedLimit ? "Separate controlled synthetic deadline run follows" : "Not applicable: untimed", screenshot: await shot(employee.page, `${row.testId}-07-completed`), note: "Fast automated browser answers have genuine quality flags; no durations or flags were rewritten." });
        currentDimension = "result_ready_within_300s";
        const result = await waitUntil(() => db!.testResult.findFirst({ where: { attemptId: started.id }, orderBy: { createdAt: "asc" } }), r => !!r, 300000);
        const observedReadyAt = new Date();
        const measuredMs = observedReadyAt.getTime() - attempt.submittedAt!.getTime();
        const storedTimestampDeltaMs = result!.createdAt.getTime() - attempt.submittedAt!.getTime();
        assert(measuredMs <= 300000 && measuredMs >= 0);
        await mark(row, currentDimension, "pass", { completedAt: row.completedAt, observedReadyAt: observedReadyAt.toISOString(), resultCreatedAt: result!.createdAt.toISOString(), measuredMs, storedTimestampDeltaMs, resultId: result!.id, scoringKeyId: result!.scoringKeyId, qualityFlags: (result!.result as any).qualityFlags, note: "Acceptance uses actual readback time after completion. Insert timestamp may precede completion by milliseconds in the same transaction and is recorded separately." });
        await save();
      } catch (error) {
        row.cells[currentDimension] = { status: "fail", at: new Date().toISOString(), error: String(error).slice(0, 2000) };
        errors.push(`${row.testId}: ${String(error).slice(0, 500)}`);
        await employee.context.setOffline(false).catch(() => {});
        await shot(employee.page, `${row.testId}-failure`).catch(() => {});
        await save();
      }
    }
    if (completedRows.length === 6) {
      const resultPdf = await pdf(admin.context, campaignId, "individual", `${directory}/Холдинг-браузерный-протокол-участник-ru.pdf`, "holding-demo-participant-01");
      observations.push({ browserBatteryPdf: resultPdf });
      for (const row of completedRows) {
        const measuredFromThisFormMs = Date.parse(resultPdf.readyAt) - Date.parse(row.completedAt!);
        const measuredFromBatteryCompletionMs = Date.parse(resultPdf.readyAt) - Math.max(...completedRows.map(r => Date.parse(r.completedAt!)));
        await mark(row, "pdf_ready_within_300s", measuredFromThisFormMs <= 300000 ? "pass" : "fail", { ...resultPdf, thisFormCompletedAt: row.completedAt, measuredFromThisFormMs, measuredFromBatteryCompletionMs, note: "Individual PDF becomes eligible after all six forms; both per-form and whole-battery elapsed times are explicit." });
      }
    } else for (const row of rows) await mark(row, "pdf_ready_within_300s", "blocked", { reason: "Not all six real-browser forms completed. Sample DB-fixture PDF is not browser-PDF acceptance evidence." });
    const reviewer = await localOperatorSession(login, versions[0].id);
    for (const row of completedRows) {
      try {
        const v = versions.find(v => v.testId === row.testId)!;
        const oldResults: TestResult[] = await db.testResult.findMany({ where: { attemptId: row.attemptId }, orderBy: { createdAt: "asc" } });
        const config = v.keys[0].config as unknown as ScoringConfig;
        const generated = syntheticAnswers(row.testId, v.questions as unknown as QuestionInput[], config, 1);
        const expected = calculateScore(v.keys[0].algorithm, config, v.questions as unknown as QuestionInput[], generated);
        const keyVersion = `synthetic-browser-${runId}`;
        const key = await api(reviewer.context, `/platform/tests/${v.id}/keys`, { version: keyVersion, config, source: "Local synthetic protocol only: append-only identical scoring config for explicit versioned recalculation", controlExamples: [{ name: "Generated synthetic reference answers", answers: generated, expected }] });
        const keyReadback: ScoringKey = await db.scoringKey.findUniqueOrThrow({ where: { id: key.id } });
        assert.equal(keyReadback.version, keyVersion);
        await api(admin.context, `/attempts/${row.attemptId}/recalculate`, { keyId: key.id }, 403);
        await api(reviewer.restrictedContext, `/attempts/${row.attemptId}/recalculate`, { keyId: key.id }, 403);
        const recalculated = await api(reviewer.context, `/attempts/${row.attemptId}/recalculate`, { keyId: key.id });
        const readback: TestResult = await db.testResult.findUniqueOrThrow({ where: { id: recalculated.id } });
        assert.equal(readback.scoringKeyId, key.id);
        assert.equal(readback.reason, "manual_recalculation");
        const afterOld: TestResult[] = await db.testResult.findMany({ where: { id: { in: oldResults.map(r => r.id) } }, orderBy: { createdAt: "asc" } });
        assert.deepEqual(afterOld.map(r => r.result), oldResults.map(r => r.result), "Historical result versions must not be overwritten");
        const people = await api(admin.context, `/people/holding-demo-participant-01?campaignId=${campaignId}`);
        await admin.page.goto(`${base}/people/holding-demo-participant-01`, { waitUntil: "domcontentloaded" });
        await admin.page.getByText("Демо-участник 01", { exact: true }).first().waitFor();
        await mark(row, "admin_view_and_versioned_recalculation", "pass", { administratorVisible: true, administratorRecalculationStatus: 403, demoOnlyKeyReviewerRecalculationStatus: 403, localSystemOperator: { id: operatorPlan!.user.id, role: "superadmin", demoOnly: false, ephemeral: true, partOfDemoAccess: false, cleanup: "verified in final lifecycle observation" }, previousResultIds: oldResults.map(r => r.id), previousResultsUnchanged: true, newResultId: readback.id, newKeyId: key.id, newKeyVersion: keyVersion, newResultReason: readback.reason, apiParticipantId: people.member?.id ?? people.id, screenshot: await shot(admin.page, `${row.testId}-08-admin-view`) });
      } catch (error) { await mark(row, "admin_view_and_versioned_recalculation", "fail", { error: String(error).slice(0, 1500) }); }
    }
    // Separate assignments exercise expiry without changing a completed browser result.
    const expiryCampaign = `${runId}-expiry`;
    await db.campaign.create({ data: { id: expiryCampaign, organizationId: org.id, name: "Синтетическая проверка срока — deadline advanced in synthetic fixture", country: "Казахстан", startsAt: new Date(), endsAt: new Date(Date.now() + 86400000), description: "No claim of waiting 20–30 minutes. Only the local synthetic attempt deadline is advanced." } });
    for (const row of rows.filter(r => ["verbal", "numerical", "logical", "situations"].includes(r.testId))) {
      try {
        const v = versions.find(v => v.testId === row.testId)!;
        const assignment = await db.testAssignment.create({ data: { organizationId: org.id, campaignId: expiryCampaign, membershipId: "holding-demo-participant-01", testVersionId: v.id, expertId: "holding-demo-expert" } });
        const started = await startInBrowser(employee.page, employee.context, assignment.id, `${row.testId}-expiry`);
        const accelerated = new Date(Date.now() + 1800);
        const guarded: { organizationId: string; assignment: { campaignId: string; membership: { user: { demoOnly: boolean } } } } = await db.testAttempt.findUniqueOrThrow({ where: { id: started.id }, include: { assignment: { include: { membership: { include: { user: true } } } } } });
        assert.equal(guarded.organizationId, org.id); assert(guarded.assignment.membership.user.demoOnly); assert.equal(guarded.assignment.campaignId, expiryCampaign);
        await db.testAttempt.update({ where: { id: started.id }, data: { expiresAt: accelerated } });
        const adjusted: TestAttempt = await db.testAttempt.findUniqueOrThrow({ where: { id: started.id } });
        assert.equal(adjusted.expiresAt!.toISOString(), accelerated.toISOString());
        await db.auditLog.create({ data: { organizationId: org.id, action: "holding.synthetic_deadline_advanced", entityId: started.id, detail: { label: "deadline advanced in synthetic fixture", previousDeadline: started.state.expiresAt, fixtureDeadline: accelerated.toISOString(), real20MinuteWait: false } } });
        await employee.page.reload();
        const final = await waitUntil(() => db!.testAttempt.findUniqueOrThrow({ where: { id: started.id } }), a => a.status !== "in_progress", 20000);
        assert.equal(final.status, "retry_required", "Zero-answer expiry must be honest, not a completed passing assessment");
        const audit: AuditLog | null = await db.auditLog.findFirst({ where: { entityId: started.id, action: "attempt.insufficient_answers" }, orderBy: { createdAt: "desc" } });
        assert.equal((audit?.detail as any)?.reason, "deadline");
        await employee.page.waitForTimeout(1200);
        const previousEvidence = row.cells.finish_and_expiry.evidence || {};
        await mark(row, "finish_and_expiry", previousEvidence.manualSubmit ? "pass" : "partial", { ...previousEvidence, expiry: { label: "deadline advanced in synthetic fixture", attemptId: started.id, previousDeadline: started.state.expiresAt, advancedDeadline: accelerated.toISOString(), status: final.status, submittedAt: final.submittedAt?.toISOString(), auditReason: (audit?.detail as any)?.reason, real20MinuteWait: false, screenshot: await shot(employee.page, `${row.testId}-09-expired-fixture`) } });
      } catch (error) { await mark(row, "finish_and_expiry", "fail", { previous: row.cells.finish_and_expiry.evidence, expiryError: String(error).slice(0, 1500) }); }
    }
    // The ephemeral system operator stays available only until the outer finally,
    // which signs it out, revokes sessions and deletes this exact run-owned user.
    await employee.context.close();
  }
  await admin.context.close();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as any)?.code;
  topError = typeof code === "string" && /^P[0-9]{4}$/.test(code) ? `Readiness: local Holding schema/database/client unavailable (${code}); apply parent-owned migrations and regenerate Prisma` : message.startsWith("Readiness:") || /Local|loopback|test database/.test(message) ? message : `Readiness/integration failure: ${message.slice(0, 1600)}`;
  errors.push(topError);
} finally {
  try { await cleanupLocalOperator(); }
  catch (error) { topError = `Ephemeral local operator cleanup failed: ${String(error).slice(0, 1200)}`; errors.push(topError); }
  for (const context of openedContexts) {
    await context.request.post(`${base}/api/auth/sign-out`, { headers: { Origin: base }, timeout: 10000 }).catch(() => {});
    await context.close().catch(() => {});
  }
  await browser?.close().catch(() => {});
  if (credentialsFingerprintBefore) {
    const after = createHash("sha256").update(await readFile(DEMO_CREDENTIAL_FILE)).digest("hex");
    const unchanged = after === credentialsFingerprintBefore;
    observations.push({ protectedDemoCredentials: { unchanged, operatorPasswordAdded: false, valuesPrinted: false } });
    if (!unchanged) { topError = "Protected demo credential file changed during QA run"; errors.push(topError); }
  }
  await db?.$disconnect();
  await save();
  const summary = { runId, evidence: `${directory}/matrix.json`, samplePdf: samplePdfPath, status: topError ? "blocked" : operatorSmokeOnly ? "operator_smoke_only" : rows.every(row => dimensions.every(d => row.cells[d].status === "pass" || (d === "training_before_start" && row.cells[d].status === "not_applicable"))) ? "pass" : process.argv.includes("--sample-only") ? "sample_only" : "partial", cells: Object.fromEntries(["pass", "not_applicable", "partial", "fail", "blocked", "not_tested"].map(status => [status, rows.flatMap(r => Object.values(r.cells)).filter(c => c.status === status).length])), readinessError: topError };
  console.log(JSON.stringify(summary, null, 2));
  if (["partial", "blocked"].includes(summary.status)) process.exitCode = 1;
}
