import { holdingKeyFingerprint } from "./holding-key";
import { HOLDING_MODEL_VERSION, HOLDING_PROFILES, type HoldingProfile } from "./holding";
import { assertLocalHoldingEnvironment, syntheticAnswers, DEMO_TEST_IDS } from "./demo-policy";
import { calculateScore, validateAnswer, type Answer, type QuestionInput, type ScoringConfig } from "./scoring";
import { assessmentCompletion } from "./result-validity";

export const FUND_DEMO_ORGANIZATION_ID = "fund-client-demo-20261121";
export const FUND_DEMO_CAMPAIGN_ID = `${FUND_DEMO_ORGANIZATION_ID}-assessment`;
export const FUND_DEMO_RESULT_REASON = "synthetic_fund_demo_fixture_not_browser";
export const FUND_DEMO_CREATION_ACTION = "fund.synthetic_demo_created";
export const FUND_DEMO_ACTOR = "fund-client-demo-provisioner-20261121";
export const FUND_DEMO_PROVENANCE = {
  synthetic: true, generated: true, source: "generated_no_real_data", namespace: FUND_DEMO_ORGANIZATION_ID,
  browserVerified: false, timerVerified: false, simulatedResponseDurations: true, realRosterClaim: false,
  note: "Вымышленные участники; сгенерированные ответы и имитация длительностей. Не реальное прохождение, не проверка браузера или таймера.",
} as const;
export type FundDemoIdentity = {
  userId: string; email: string; name: string; role: "admin" | "expert" | "employee";
  sourceOrganizationId: string; sourceMembershipId: string; sourceRole: string;
  membershipId: string; profileRow: number | null; sjtTarget: number | null;
};
const employee = (n: number, profileRow: number, sjtTarget: number): FundDemoIdentity => ({
  userId: n === 1 ? "employee" : `report-demo-${n}`, email: n === 1 ? "employee@assessflow.local" : `report-demo${n}@assessflow.local`,
  name: `Демо участник ${n}`, role: "employee", sourceOrganizationId: "damu-organization", sourceMembershipId: n === 1 ? "member-employee" : `report-demo-${n}`, sourceRole: "employee",
  membershipId: `fund-client-demo-participant-${String(n).padStart(2,"0")}`, profileRow, sjtTarget,
});
const deepFreeze = <T>(value:T):T => {
  if (value && typeof value==="object") {Object.values(value).forEach(deepFreeze);Object.freeze(value);}
  return value;
};
export const FUND_DEMO_PLAN = deepFreeze({
  version: "fund-demo-2026-11-21-v1", sourceOrganizationId: "damu-organization", sourceCampaignId: "review-demo-20261119",
  sourceCampaignDescription: "Пять вымышленных участников для технической проверки. Не включать в норму основной кампании.",
  sourceFixtureReason: "synthetic_review_fixture",
  targetOrganization: { id: FUND_DEMO_ORGANIZATION_ID, slug: FUND_DEMO_ORGANIZATION_ID, name: "Оценка руководителей 2026", purpose: "assessment", dataMode: "synthetic", status: "active", aiBudget: 0 },
  campaign: { id: FUND_DEMO_CAMPAIGN_ID, name: "Демонстрация — вымышленные участники", country: "Казахстан", startsAt: "2026-11-19T00:00:00.000Z", endsAt: "2026-11-20T23:59:59.000Z", sampleBoundariesExplicit: true },
  identities: [
    { userId: "admin", email: "admin@assessflow.local", name: "Демо-администратор", role: "admin", sourceOrganizationId: "damu-organization", sourceMembershipId: "member-admin", sourceRole: "admin", membershipId: "fund-client-demo-admin", profileRow: null, sjtTarget: null },
    { userId: "cmwoqt4al0006qr0ubtateblz", email: "pilot.expert@assessflow.local", name: "Демо-эксперт", role: "expert", sourceOrganizationId: "pilot-workspace", sourceMembershipId: "cmwoqt4ax000cqr0u8envo60j", sourceRole: "admin", membershipId: "fund-client-demo-expert", profileRow: null, sjtTarget: null },
    employee(1,1,15), employee(2,26,18), employee(3,55,21), employee(4,56,24), employee(5,59,26),
  ] as FundDemoIdentity[],
  testVersionIds: DEMO_TEST_IDS.map(id => `${id}-v2`),
  resultReason: FUND_DEMO_RESULT_REASON, provenance: FUND_DEMO_PROVENANCE,
});
/** Semantic, recursively key-sorted fingerprint; JSONB insertion order is not identity. */
export const fundDemoPlanDigest = (value: unknown) => holdingKeyFingerprint(value);
const REVIEWED_PLAN_DIGEST = fundDemoPlanDigest(FUND_DEMO_PLAN);
export type FundDemoOptions = {
  reviewedPlan: typeof FUND_DEMO_PLAN; apply?: boolean; production?: boolean;
  allowProduction?: boolean; allowIdentityPresentationConversion?: boolean; expectedReleaseSha?: string;
};
export function assertFundDemoEnvironment(env: Record<string,string|undefined>, options: FundDemoOptions) {
  const fail = (message: string): never => { throw Error(`Fund demo guard: ${message}`); };
  if (!options?.reviewedPlan || fundDemoPlanDigest(options.reviewedPlan) !== REVIEWED_PLAN_DIGEST) fail("exact reviewed plan required");
  for (const [key,value] of Object.entries(options)) if (["apply","production","allowProduction","allowIdentityPresentationConversion"].includes(key) && value!==undefined && typeof value!=="boolean") fail("allow/apply switches must be explicit booleans");
  for (const key of ["DATABASE_URL_UNPOOLED", "DIRECT_URL", "PGHOST", "PGHOSTADDR", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"]) if (env[key]) fail("connection-routing overrides forbidden");
  if (!options.production) {
    try { assertLocalHoldingEnvironment(env); } catch { fail("explicit local loopback Holding test database and local service destinations required"); }
    return;
  }
  if (!options.allowProduction || !options.allowIdentityPresentationConversion) fail("two independent production allow switches required");
  if (!/^[a-f0-9]{40}$/.test(options.expectedReleaseSha || "") || options.expectedReleaseSha !== env.FUND_DEMO_RELEASE_SHA) fail("full expected release SHA must match independent environment attestation");
  let database: URL; try { database = new URL(env.DATABASE_URL || ""); } catch { return fail("fixed reviewed production database required"); }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "postgres" || database.pathname !== "/assessflow" || (database.port && database.port !== "5432") || database.hash || [...database.searchParams].some(([key,value]) => key !== "schema" || value !== "public") || database.searchParams.getAll("schema").length > 1) fail("fixed postgres/assessflow database required; overrides forbidden");
}
export function fundDemoRoster(): (FundDemoIdentity & Partial<Omit<HoldingProfile,"profileRow">>)[] {
  return FUND_DEMO_PLAN.identities.map(identity => {
    if (identity.profileRow === null) return { ...identity };
    const profile = HOLDING_PROFILES.find(p => p.profileRow === identity.profileRow);
    if (!profile) throw Error("Fund demo readiness: authoritative numbered profile missing");
    return { ...identity, profileRow: profile.profileRow, block: profile.block, unit: profile.unit, position: profile.position, targetLevelModel: profile.targetLevelModel, targetScore: profile.targetScore, criticality: { ...profile.criticality } };
  });
}
export type FundDemoForm = { testId: string; algorithm: string; config: ScoringConfig; questions: QuestionInput[]; timeLimitSeconds: number | null };
/** Generate option-ID answers first. The stored score is always calculated, never edited. */
export function fundDemoFixture(form: FundDemoForm, seed: number, target?: number) {
  const { questions, config } = form;
  let answers: Record<string,Answer>;
  if (form.testId === "situations") {
    if (form.algorithm !== "sjt" || config.holdingModelVersion !== HOLDING_MODEL_VERSION || config.mode || questions.length !== 14) throw Error("Fund demo readiness: exact Holding +1 MOST/+1 LEAST key required");
    if (!Number.isInteger(target) || target! < 0 || target! > 28) throw Error("Fund demo readiness: valid integer SJT target required");
    // Lexically sorted distinct pairs make generation stable despite database option ordering.
    let states = new Map<number,Record<string,Answer>>([[0,{}]]);
    for (const q of questions) {
      const item = config.items[q.id];
      if (!item?.most || !item.least || item.most === item.least) throw Error("Fund demo readiness: distinct installed option-ID key required");
      const next = new Map<number,Record<string,Answer>>();
      const ids = q.options.map(o => o.id).sort();
      for (const [sum, previous] of states) for (const most of ids) for (const least of ids) {
        if (most === least) continue;
        const count = sum + Number(most === item.most) + Number(least === item.least);
        if (!next.has(count)) next.set(count, { ...previous, [q.id]: { most, least } });
      }
      states = next;
    }
    const selected = states.get(target!);
    if (!selected) throw Error("Fund demo readiness: SJT target cannot be produced by valid answers");
    answers = selected;
  } else answers = syntheticAnswers(form.testId, questions, config, seed);
  for (const q of questions) validateAnswer(q, answers[q.id], config);
  const validity = assessmentCompletion(questions, answers, config, form.algorithm === "scales");
  if (!validity.eligible) throw Error("Fund demo readiness: generated fixture is not complete/eligible");
  const perQuestion = form.timeLimitSeconds ? Math.min(form.testId === "situations" ? 60000 : 25000, Math.floor(form.timeLimitSeconds * 1000 / (questions.length + 1))) : 25000;
  const durations = Object.fromEntries(questions.map(q => [q.id,perQuestion]));
  const elapsedMs = questions.length * perQuestion;
  const calculated = calculateScore(form.algorithm, config, questions, answers, { durations, elapsedMs });
  if (calculated.reviewRequired || (form.testId === "situations" && (calculated.total !== target || calculated.holdingProfile?.length !== 8))) throw Error("Fund demo readiness: generated fixture quality/Holding profile mismatch");
  return { answers, durations, elapsedMs, score: { ...calculated, validity, demo: true, provenance: FUND_DEMO_PROVENANCE, simulatedResponseDurations: true } };
}
