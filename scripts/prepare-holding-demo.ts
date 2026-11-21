import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import catalog from "../data/catalog.json";
import { HOLDING_MODEL_VERSION, HOLDING_PROFILES } from "../packages/core/holding";
import { CONSENT_VERSION } from "../packages/core/assessment-policy";
import { defaultMatrix } from "../packages/core/contracts";
import { externalAiAllowed } from "../packages/core/data-policy";
import { calculateScore, type QuestionInput, type ScoringConfig } from "../packages/core/scoring";
import { assessmentCompletion } from "../packages/core/result-validity";
import { assertDemoOwnership, assertLocalHoldingEnvironment, demoPublicationAction, DEMO_CAMPAIGN_ID, DEMO_NAME, DEMO_ORGANIZATION_ID, DEMO_TEST_IDS, syntheticAnswers, syntheticProvenance, syntheticRoster } from "../packages/core/demo-policy";
import { installHoldingKey } from "./install-holding-key";

export const DEMO_ARTIFACT_DIR = "/root/research/damu-tests/implementation/demo";
export const DEMO_CREDENTIAL_FILE = `${DEMO_ARTIFACT_DIR}/.local-credentials.json`;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
type Login = { email: string; password: string };
export type DemoCredentials = { employee: Login; admin: Login; expert: Login; keyReviewer: Login };
async function credentials(): Promise<DemoCredentials> {
  try { return JSON.parse(await readFile(DEMO_CREDENTIAL_FILE, "utf8")); }
  catch (error: any) { if (error.code !== "ENOENT") throw Error("Protected local credential file is unreadable"); }
  const login = (id: string) => ({ email: `${id}@example.invalid`, password: randomBytes(30).toString("base64url") + "!aA1" });
  const generated = { employee: login("holding-demo-participant-01"), admin: login("holding-demo-admin"), expert: login("holding-demo-expert"), keyReviewer: login("holding-demo-key-reviewer") };
  await mkdir(DEMO_ARTIFACT_DIR, { recursive: true });
  await writeFile(DEMO_CREDENTIAL_FILE, JSON.stringify(generated), { mode: 0o600, flag: "wx" });
  await chmod(DEMO_CREDENTIAL_FILE, 0o600);
  return generated;
}

/** Creates only its fixed local namespace. Never overwrites users or attempts. */
export async function prepareHoldingDemo() {
  assertLocalHoldingEnvironment(process.env);
  if (externalAiAllowed({ purpose: "assessment", dataMode: "synthetic" })) throw Error("Readiness: external AI must be disabled by policy before preparing demo");
  const db = new PrismaClient();
  try {
    // Validate parent-owned schema before publishing local drafts or appending keys.
    await db.organization.findFirst({ select: { dataMode: true } });
    await db.user.findFirst({ select: { demoOnly: true } });
    await db.membership.findFirst({ select: { profileRow: true, targetLevelModel: true, block: true } });
    await db.campaign.findFirst({ select: { country: true } });
    // No org/users/credentials are written before all installed forms and keys exist.
    const versions = await db.testVersion.findMany({
      where: { testId: { in: [...DEMO_TEST_IDS] } },
      include: { questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } }, keys: { orderBy: [{ createdAt: "desc" }, { version: "desc" }] } },
    });
    const forms = DEMO_TEST_IDS.map(testId => {
      const entry = catalog.find(form => form.id === testId)!;
      const version = versions.find(v => v.testId === testId && v.version === entry.version);
      if (!version || !version.questions.length || !version.keys.length) throw Error(`Readiness: installed canonical form/key missing for ${testId}; install data/catalog.json first`);
      demoPublicationAction(version, entry.version);
      if (version.timeLimitSeconds !== entry.timeLimitSeconds) throw Error(`Readiness: configured timer mismatch for ${testId}`);
      return version;
    });
    const roster = syntheticRoster(HOLDING_PROFILES);
    const staff = [
      { id: "holding-demo-admin", name: "Демо-администратор", role: "admin", platformAdmin: false },
      { id: "holding-demo-expert", name: "Демо-эксперт", role: "expert", platformAdmin: false },
      { id: "holding-demo-key-reviewer", name: "Демо-проверка версий ключа", role: "admin", platformAdmin: true },
    ];
    const plannedUsers = [...roster, ...staff.map(s => ({ ...s, email: `${s.id}@example.invalid`, demoOnly: true }))];
    const org = { id: DEMO_ORGANIZATION_ID, slug: DEMO_ORGANIZATION_ID, name: DEMO_NAME, purpose: "assessment", dataMode: "synthetic" };
    const existingOrg = await db.organization.findFirst({ where: { OR: [{ id: org.id }, { slug: org.slug }] }, include: { memberships: { include: { user: true } } } });
    if (existingOrg) assertDemoOwnership(existingOrg, existingOrg.memberships.map(m => m.user));
    const existingUsers = await db.user.findMany({ where: { OR: [{ id: { in: plannedUsers.map(u => u.id) } }, { email: { in: plannedUsers.map(u => u.email) } }] }, include: { memberships: true, accounts: true } });
    assertDemoOwnership(org, existingUsers);
    for (const user of existingUsers) {
      const planned = plannedUsers.find(p => p.id === user.id && p.email === user.email);
      if (!planned || planned.name !== user.name || user.memberships.some(m => m.organizationId !== org.id) || user.accounts.filter(a => a.providerId === "credential").length !== 1) throw Error("Synthetic identity conflict; existing account will not be adopted or overwritten");
      const expectedPlatform = staff.find(s => s.id === user.id)?.platformAdmin ?? false;
      if (user.platformAdmin !== expectedPlatform) throw Error("Synthetic account privilege conflict");
    }
    const existingCampaign = await db.campaign.findUnique({ where: { id: DEMO_CAMPAIGN_ID } });
    if (existingCampaign && (existingCampaign.organizationId !== org.id || existingCampaign.country !== "Казахстан" || !existingCampaign.description.includes("generated_no_real_data"))) throw Error("Synthetic campaign namespace conflict");
    if (existingUsers.length && !existingOrg) throw Error("Synthetic namespace conflict: users predate the dedicated organization");
    if (existingUsers.length) {
      try { await readFile(DEMO_CREDENTIAL_FILE); } catch { throw Error("Existing demo credential file missing; refusing to reset accounts or completed work"); }
    }
    const keyInstallation = await installHoldingKey(db, { apply: true, actorId: "holding-demo-preparation", reason: "DEMO_ONLY: local synthetic Holding fixtures require an append-only matching key; no answer-key changes or expert approval" });
    for (const v of forms) {
      if (demoPublicationAction(v, catalog.find(f => f.id === v.testId)!.version) === "publish_demo_only") {
        await db.$transaction(async tx => {
          const currentVersion = await tx.testVersion.findUniqueOrThrow({ where: { id: v.id } });
          await tx.testVersion.update({ where: { id: v.id }, data: { status: "published", approvedBy: "DEMO_ONLY", approvedAt: null, delivery: json({ ...(currentVersion.delivery as object), demoOnlyPublication: true, publicationProvenance: syntheticProvenance() }) } });
          await tx.auditLog.create({ data: { organizationId: null, actorId: "holding-demo-preparation", action: "test.synthetic_published", entityId: v.id, detail: json({ ...syntheticProvenance(), approvedBy: "DEMO_ONLY", methodologicalApproval: false }) } });
        });
      }
      const readback = await db.testVersion.findUniqueOrThrow({ where: { id: v.id } });
      if (readback.status !== "published") throw Error(`Readiness: local canonical form publication failed for ${v.testId}`);
      v.keys = await db.scoringKey.findMany({ where: { testVersionId: v.id }, orderBy: [{ createdAt: "desc" }, { version: "desc" }] });
      if (v.testId === "situations" && (v.keys[0].config as any).holdingModelVersion !== HOLDING_MODEL_VERSION) throw Error("Readiness: append-only Holding key was not installed");
    }
    const login = await credentials();
    for (const [role, id] of [["employee", "holding-demo-participant-01"], ["admin", "holding-demo-admin"], ["expert", "holding-demo-expert"], ["keyReviewer", "holding-demo-key-reviewer"]] as const) {
      if (login[role].email !== `${id}@example.invalid` || login[role].password.length < 20) throw Error("Protected synthetic credential provenance conflict");
    }
    const hashes = Object.fromEntries(await Promise.all(Object.entries(login).map(async ([role, value]) => [role, await hashPassword(value.password)])));
    const before = { users: existingUsers.length, attempts: await db.testAttempt.count({ where: { organizationId: org.id } }), results: await db.testResult.count({ where: { organizationId: org.id } }) };
    await db.$transaction(async tx => {
      await tx.organization.upsert({ where: { id: org.id }, update: {}, create: { ...org, matrixConfig: defaultMatrix, aiBudget: 0, employeeLimit: 65, assessmentLimit: 1000 } });
      await tx.campaign.upsert({ where: { id: DEMO_CAMPAIGN_ID }, update: {}, create: { id: DEMO_CAMPAIGN_ID, organizationId: org.id, name: "Холдинг · синтетическая демонстрация 65 профилей", description: JSON.stringify(syntheticProvenance()), country: "Казахстан", startsAt: new Date("2026-11-21T00:00:00Z"), endsAt: new Date("2027-01-20T23:59:59Z") } });
      for (const person of plannedUsers) {
        const staffPerson = staff.find(s => s.id === person.id);
        const profile = roster.find(p => p.id === person.id);
        const hash = hashes[staffPerson?.id === "holding-demo-key-reviewer" ? "keyReviewer" : staffPerson?.role ?? "employee"];
        await tx.user.upsert({ where: { id: person.id }, update: {}, create: { id: person.id, name: person.name, email: person.email, demoOnly: true, emailVerified: true, mustChangePassword: false, platformAdmin: staffPerson?.platformAdmin ?? false, accounts: { create: { providerId: "credential", accountId: person.id, password: hash } } } });
        const saved = await tx.membership.upsert({ where: { organizationId_userId: { organizationId: org.id, userId: person.id } }, update: {}, create: { id: person.id, organizationId: org.id, userId: person.id, role: staffPerson?.role ?? "employee", profileRow: profile?.profileRow, targetLevelModel: profile?.targetLevelModel ?? "В", block: profile?.block, position: profile?.position ?? "Синтетическая служебная роль", unit: profile?.unit ?? "Демонстрация", consentAt: new Date(), consentVersion: CONSENT_VERSION } });
        if (saved.id !== person.id || saved.role !== (staffPerson?.role ?? "employee") || (profile && (saved.profileRow !== profile.profileRow || saved.unit !== profile.unit || saved.position !== profile.position || saved.block !== profile.block || saved.targetLevelModel !== profile.targetLevelModel))) throw Error("Synthetic membership conflict; no existing work reset");
      }
      for (const person of roster) for (const v of forms) {
        const key = v.keys[0];
        const assignment = await tx.testAssignment.upsert({ where: { campaignId_membershipId_testVersionId: { campaignId: DEMO_CAMPAIGN_ID, membershipId: person.id, testVersionId: v.id } }, update: {}, create: { organizationId: org.id, campaignId: DEMO_CAMPAIGN_ID, membershipId: person.id, testVersionId: v.id, expertId: "holding-demo-expert" } });
        if (await tx.testAttempt.count({ where: { assignmentId: assignment.id } })) continue;
        const questions = v.questions as unknown as QuestionInput[], config = key.config as unknown as ScoringConfig;
        const answers = syntheticAnswers(v.testId, questions, config, person.profileRow);
        const durations = Object.fromEntries(questions.map(q => [q.id, v.testId === "situations" ? 90000 : 25000]));
        const validity = assessmentCompletion(questions, answers, config, key.algorithm === "scales");
        if (!validity.eligible) throw Error(`Generated ${v.testId} answers do not satisfy completeness`);
        const elapsedMs = Object.values(durations).reduce((sum, n) => sum + n, 0);
        const score = calculateScore(key.algorithm, config, questions, answers, { durations, elapsedMs });
        const submittedAt = new Date(), startedAt = new Date(submittedAt.getTime() - elapsedMs);
        const attempt = await tx.testAttempt.create({ data: { organizationId: org.id, assignmentId: assignment.id, scoringKeyId: key.id, language: "ru", status: "completed", startedAt, timerStartedAt: startedAt, submittedAt, manuallySubmittedAt: submittedAt, expiresAt: v.timeLimitSeconds ? new Date(startedAt.getTime() + v.timeLimitSeconds * 1000) : null } });
        await tx.userAnswer.createMany({ data: questions.map((q, i) => ({ organizationId: org.id, attemptId: attempt.id, questionId: q.id, value: json(answers[q.id]), durationMs: durations[q.id], answeredAt: new Date(startedAt.getTime() + (i + 1) * durations[q.id]), receivedAt: submittedAt })) });
        await tx.testResult.create({ data: { organizationId: org.id, attemptId: attempt.id, scoringKeyId: key.id, reason: "synthetic_generated_fixture_not_browser", result: json({ ...score, validity, demo: true, provenance: syntheticProvenance(), simulatedResponseDurations: true }) } });
        await tx.auditLog.create({ data: { organizationId: org.id, action: "holding.synthetic_fixture_created", entityId: attempt.id, detail: json({ ...syntheticProvenance(), campaignId: DEMO_CAMPAIGN_ID, profileRow: person.profileRow }) } });
      }
    }, { timeout: 120000, maxWait: 10000 });
    const readback = await db.organization.findUniqueOrThrow({ where: { id: org.id }, include: { memberships: { include: { user: true } }, campaigns: { where: { id: DEMO_CAMPAIGN_ID } } } });
    assertDemoOwnership(readback, readback.memberships.map(m => m.user));
    const employees = readback.memberships.filter(m => m.role === "employee");
    if (employees.length !== 65 || new Set(employees.map(m => m.profileRow)).size !== 65 || readback.campaigns[0]?.country !== "Казахстан") throw Error("Synthetic fixture readback count/profile/country mismatch");
    const attempts = await db.testAttempt.findMany({ where: { assignment: { campaignId: DEMO_CAMPAIGN_ID } }, select: { status: true, results: { select: { reason: true } } } });
    if (attempts.length !== 390) throw Error("Synthetic fixture readback expected 65 × 6 attempts");
    const result = { preparedAt: new Date().toISOString(), organizationId: org.id, campaignId: DEMO_CAMPAIGN_ID, country: "Казахстан", syntheticParticipants: employees.length, staff: staff.map(s => ({ email: `${s.id}@example.invalid`, role: s.platformAdmin ? "demo-only-admin-no-platform-bypass" : s.role })), assignments: 390, attemptStatuses: Object.fromEntries([...new Set(attempts.map(a => a.status))].map(status => [status, attempts.filter(a => a.status === status).length])), source: syntheticProvenance(), before, completedWorkPreserved: true, credentialsPrinted: false, credentialsFile: DEMO_CREDENTIAL_FILE, keyInstallation, forms: forms.map(v => ({ testId: v.testId, versionId: v.id, version: v.version, keyId: v.keys[0].id, keyVersion: v.keys[0].version, timeLimitSeconds: v.timeLimitSeconds })) };
    await mkdir(DEMO_ARTIFACT_DIR, { recursive: true });
    await writeFile(`${DEMO_ARTIFACT_DIR}/fixture.json`, JSON.stringify(result, null, 2));
    return result;
  } finally { await db.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareHoldingDemo().then(result => console.log(JSON.stringify(result, null, 2))).catch(async error => {
    const message = error instanceof Error ? error.message : "Demo preparation failed";
    // Database-driver errors can include SQL or connection details; keep raw errors off stdout.
    const safe = message.startsWith("Readiness:") || /Synthetic|synthetic|Local|loopback|Holding test database|external AI|credential|Generated|fixture readback/.test(message) ? message.split("\n")[0] : "Readiness: local schema/database unavailable; apply parent-owned migrations and regenerate Prisma first";
    await mkdir(DEMO_ARTIFACT_DIR, { recursive: true });
    await writeFile(`${DEMO_ARTIFACT_DIR}/readiness-error.json`, JSON.stringify({ at: new Date().toISOString(), status: "blocked", error: safe }, null, 2));
    console.error(safe); process.exitCode = 1;
  });
}
