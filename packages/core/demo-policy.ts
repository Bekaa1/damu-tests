import type { HoldingProfile } from "./holding";
import { calculateScore, type Answer, type QuestionInput, type ScoringConfig } from "./scoring";

export const DEMO_ORGANIZATION_ID = "holding-synthetic-demo-20261121";
export const DEMO_CAMPAIGN_ID = `${DEMO_ORGANIZATION_ID}-assessment`;
export const DEMO_NAME = "Демонстрация — вымышленные данные";
export const DEMO_TEST_IDS = ["verbal", "numerical", "logical", "personality", "motivation", "situations"] as const;
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Never echo rejected URLs: they can contain passwords. No remote override exists. */
export function assertLocalHoldingEnvironment(env: Record<string, string | undefined>) {
  let database: URL;
  try { database = new URL(env.DATABASE_URL || ""); } catch { throw Error("Local test database URL required"); }
  if (!["postgresql:", "postgres:"].includes(database.protocol) || !loopback.has(database.hostname)) throw Error("Local loopback test database required");
  if (!/^\/assessflow_holding_[0-9]{8}(?:_[a-z0-9]+)*$/.test(database.pathname) || database.hash || [...database.searchParams].some(([key, value]) => key !== "schema" || value !== "public") || database.searchParams.getAll("schema").length > 1) throw Error("Explicit local Holding test database required; connection overrides forbidden");
  for (const key of ["BASE_URL", "API_URL", "APP_URL", "REDIS_URL", "S3_ENDPOINT"]) {
    if (!env[key]) continue;
    let value: URL;
    try { value = new URL(env[key]!); } catch { throw Error(`${key}: loopback URL required`); }
    if (!loopback.has(value.hostname)) throw Error(`${key}: loopback URL required`);
  }
}
type TrainingSource = { timeLimitSeconds: number | null; delivery?: { practice?: readonly unknown[] } };
type TrainingState = TrainingSource & { timerStartedAt: string | null; expiresAt: string | null };
/** No invented training: N/A requires explicit canonical absence AND observed untimed start. */
export function untimedTrainingExemption(testId: string, source: TrainingSource, before: TrainingState, after: TrainingState) {
  const explicitEmptyPractice = (value: TrainingSource) => Array.isArray(value.delivery?.practice) && value.delivery.practice.length === 0;
  if (!["personality", "motivation"].includes(testId) || source.timeLimitSeconds !== null || !explicitEmptyPractice(source) || before.timeLimitSeconds !== null || after.timeLimitSeconds !== null || !explicitEmptyPractice(before) || !explicitEmptyPractice(after) || before.timerStartedAt !== null || before.expiresAt !== null || after.expiresAt !== null || typeof after.timerStartedAt !== "string" || !Number.isFinite(Date.parse(after.timerStartedAt))) return undefined;
  return { status: "not_applicable", source: "data/catalog.json", testId, practiceCount: 0, timeLimitSeconds: null, reason: `data/catalog.json: ${testId}.delivery.practice=[]; ${testId}.timeLimitSeconds=null. Source provides no interactive training or timed deadline; server snapshots confirm no deadline before/after actual start.` } as const;
}
/** QA-only local system operator, never an account supplied as demo/Fund access. */
export function localSystemOperatorPlan(env: Record<string, string | undefined>, runId: string) {
  assertLocalHoldingEnvironment(env);
  if (!/^holding-browser-[0-9]{17}-[a-f0-9]{6}$/.test(runId)) throw Error("Exact fresh browser run ID required for local operator");
  const id = `${runId}-local-operator`;
  return {
    user: { id, email: `${id}@example.invalid`, name: `LOCAL SYSTEM OPERATOR — synthetic QA only — ${runId}`, demoOnly: false, platformAdmin: true, mustChangePassword: false, emailVerified: true, locale: "ru" },
    provenance: { synthetic: true, runId, purpose: "local_system_operator_test_mechanism", partOfDemoAccess: false, ephemeral: true, namespace: DEMO_ORGANIZATION_ID },
  } as const;
}
/** Call only after successful fresh create; never adopt/upsert an existing identity. */
export function assertLocalSystemOperatorOwnership(env: Record<string, string | undefined>, runId: string, user: { id: string; email: string; name: string; demoOnly: boolean; platformAdmin: boolean; membershipCount: number }) {
  const expected = localSystemOperatorPlan(env, runId).user;
  if (user.id !== expected.id || user.email !== expected.email || user.name !== expected.name || user.demoOnly !== false || user.platformAdmin !== true || user.membershipCount !== 0) throw Error("Local system operator ownership conflict; refusing cleanup/adoption");
}
export function demoPublicationAction(version: { id: string; testId: string; version: string; status: string }, canonicalVersion: string): "keep" | "publish_demo_only" {
  if (!(DEMO_TEST_IDS as readonly string[]).includes(version.testId) || version.id !== `${version.testId}-v2` || version.version !== canonicalVersion) throw Error("Readiness: installed canonical test version required");
  if (version.status === "published") return "keep";
  if (version.status !== "draft") throw Error("Readiness: only an installed canonical draft may be published for this local demo");
  return "publish_demo_only";
}
export function syntheticProvenance() {
  return { synthetic: true, source: "generated_no_real_data", namespace: DEMO_ORGANIZATION_ID, browserVerified: false, timerVerified: false, note: "Синтетическая запись для образца отчёта; не свидетельство реального прохождения или проверки таймера" } as const;
}
export function syntheticRoster(profiles: readonly HoldingProfile[]) {
  if (profiles.length !== 65 || new Set(profiles.map(p => p.profileRow)).size !== 65 || profiles.some(p => !Number.isInteger(p.profileRow) || p.profileRow < 1 || p.profileRow > 65)) throw Error("Exactly 65 unique authoritative profile numbers required");
  return [...profiles].sort((a, b) => a.profileRow - b.profileRow).map(p => {
    const serial = String(p.profileRow).padStart(2, "0");
    // Whitelist source fields: identity/person/answer properties are never copied.
    return { id: `holding-demo-participant-${serial}`, email: `holding-demo-participant-${serial}@example.invalid`, name: `Демо-участник ${serial}`, demoOnly: true as const, profileRow: p.profileRow, block: p.block, unit: p.unit, position: p.position, targetLevelModel: p.targetLevelModel };
  });
}
export function assertDemoOwnership(org: { id: string; slug: string; name: string; purpose: string; dataMode: string }, users: readonly { id: string; email: string; demoOnly: boolean }[]) {
  if (org.id !== DEMO_ORGANIZATION_ID || org.slug !== DEMO_ORGANIZATION_ID || org.name !== DEMO_NAME || org.purpose !== "assessment" || org.dataMode !== "synthetic") throw Error("Synthetic demo namespace conflict");
  for (const user of users) {
    if (!user.demoOnly || !/^holding-demo-(participant-(?:0[1-9]|[1-5][0-9]|6[0-5])|admin|expert|key-reviewer)$/.test(user.id) || user.email !== `${user.id}@example.invalid`) throw Error("Demo-only user namespace conflict");
  }
}
/** Deterministic generated answers; not a copy of any existing participant. */
export function syntheticAnswers(testId: string, questions: readonly QuestionInput[], config: ScoringConfig, seed: number): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  const scaleIds = Object.keys(config.scales || {});
  for (const [i, q] of questions.entries()) {
    const item = config.items[q.id];
    if (!item) throw Error("Installed key does not cover fixture questions");
    if (q.type === "scale") {
      let n = 2 + ((i * 7 + seed * 3) % 3);
      if (testId === "motivation" && item.scales?.length) {
        const scaleIndex = scaleIds.indexOf(item.scales[0]);
        const desired = 2 + ((scaleIndex + seed) % 3);
        n = Math.max(1, Math.min(5, desired + ((i + seed) % 3 === 0 ? 1 : 0)));
        if (item.reverse) n = 6 - n;
      }
      if (item.control) n = q.id.endsWith("-К2") ? 4 : 2;
      if (testId === "personality" && [15, 4, 6, 2, 12].some(x => q.id === `personality-v2-${x}`)) n = 3;
      answers[q.id] = n;
    } else if (q.type === "ranking") answers[q.id] = { top: q.options.slice(0, 3).map(o => o.id), bottom: q.options.slice(-3).map(o => o.id) };
    else if (q.type === "sjt") {
      if (!item.most || !item.least) throw Error("Installed SJT option-ID key required");
      answers[q.id] = (i + seed) % 5 === 0 ? { most: item.least, least: item.most } : { most: item.most, least: item.least };
    } else {
      if (item.correct === undefined) throw Error("Installed cognitive key required");
      answers[q.id] = (i + seed) % 5 === 0 ? (q.options.find(o => o.id !== item.correct)?.id ?? Number(item.correct) + 1) : item.correct;
    }
  }
  const ranking = questions.find(q => q.type === "ranking");
  if (ranking) {
    const result = calculateScore("scales", config, [...questions], answers);
    const ordered = Object.entries(result.scales || {}).sort((a, b) => b[1].mean - a[1].mean || a[0].localeCompare(b[0]));
    if (ordered.length < 6 || ordered.some(([id]) => !ranking.options.some(o => o.id === id))) throw Error("Installed ranking scale IDs required");
    answers[ranking.id] = { top: ordered.slice(0, 3).map(([id]) => id), bottom: ordered.slice(-3).map(([id]) => id) };
  }
  return answers;
}
