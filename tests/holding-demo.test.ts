import { describe, expect, it } from "vitest";
import catalog from "../data/catalog.json";
import { HOLDING_PROFILES } from "../packages/core/holding";
import { calculateScore, validateAnswer, type QuestionInput, type ScoringConfig } from "../packages/core/scoring";
import { assertLocalHoldingEnvironment, assertDemoOwnership, syntheticRoster, syntheticAnswers, DEMO_ORGANIZATION_ID, DEMO_NAME, syntheticProvenance, demoPublicationAction, localSystemOperatorPlan, assertLocalSystemOperatorOwnership, untimedTrainingExemption } from "../packages/core/demo-policy";

const local = { DATABASE_URL: "postgresql://fixture:secret@127.0.0.1:55453/assessflow_holding_20261121", BASE_URL: "http://localhost:3301", REDIS_URL: "redis://127.0.0.1:56389", S3_ENDPOINT: "http://127.0.0.1:3901" };
describe("local-only Holding demo policy", () => {
  it("accepts only loopback and explicitly named Holding test databases", () => {
    expect(() => assertLocalHoldingEnvironment(local)).not.toThrow();
    expect(() => assertLocalHoldingEnvironment({ ...local, DATABASE_URL: local.DATABASE_URL + "?schema=public" })).not.toThrow();
    expect(() => assertLocalHoldingEnvironment({ ...local, DATABASE_URL: local.DATABASE_URL + "?schema=production" })).toThrow(/test database/i);
    for (const DATABASE_URL of ["postgresql://fixture:secret@example.com/assessflow_holding_20261121", "postgresql://fixture:secret@127.0.0.1/production", "postgresql://fixture:secret@127.0.0.1/assessflow_holding_20261121_real?host=remote", "postgresql://fixture:secret@localhost.evil/assessflow_holding_20261121", "postgresql://fixture:secret@127.0.0.1/assessflow_holding_20261121?host=remote"]) {
      expect(() => assertLocalHoldingEnvironment({ ...local, DATABASE_URL })).toThrow(/local|loopback|test database/i);
    }
    for (const key of ["BASE_URL", "REDIS_URL", "S3_ENDPOINT"])
      expect(() => assertLocalHoldingEnvironment({ ...local, [key]: "https://example.com" })).toThrow(/loopback/i);
  });
  it("publishes only an already installed canonical draft, never invents or revives a package", () => {
    const version = { id: "verbal-v2", testId: "verbal", version: "2.0-2026-10-26", status: "draft" };
    expect(demoPublicationAction(version, "2.0-2026-10-26")).toBe("publish_demo_only");
    expect(demoPublicationAction({ ...version, status: "published" }, "2.0-2026-10-26")).toBe("keep");
    for (const patch of [{ status: "archived" }, { id: "arbitrary-v2" }, { version: "invented" }, { testId: "invented" }]) expect(() => demoPublicationAction({ ...version, ...patch }, "2.0-2026-10-26")).toThrow(/canonical|draft/i);
  });
  it("separates a run-owned local system operator from all demo-access accounts", () => {
    const runId = "holding-browser-20261121080138989-abcdef";
    const plan = localSystemOperatorPlan(local, runId);
    expect(plan.user).toMatchObject({ id: `${runId}-local-operator`, email: `${runId}-local-operator@example.invalid`, demoOnly: false, platformAdmin: true, mustChangePassword: false, emailVerified: true });
    expect(plan.user).not.toHaveProperty("memberships");
    expect(plan.user).not.toHaveProperty("password");
    expect(plan.provenance).toMatchObject({ synthetic: true, runId, purpose: "local_system_operator_test_mechanism", partOfDemoAccess: false, ephemeral: true });
    const org = { id: DEMO_ORGANIZATION_ID, slug: DEMO_ORGANIZATION_ID, name: DEMO_NAME, purpose: "assessment", dataMode: "synthetic" };
    expect(() => assertDemoOwnership(org, [plan.user])).toThrow(/demo|namespace/i);
    expect(() => assertDemoOwnership(org, [{ id: "holding-demo-key-reviewer", email: "holding-demo-key-reviewer@example.invalid", demoOnly: true }])).not.toThrow();
    expect(() => localSystemOperatorPlan({ ...local, DATABASE_URL: "postgresql://fixture@remote/assessflow_holding_20261121" }, runId)).toThrow(/local|loopback/i);
    for (const badRun of ["holding-demo-key-reviewer", "existing-user", runId + "-other", "holding-browser-../escape"])
      expect(() => localSystemOperatorPlan(local, badRun)).toThrow(/run/i);
  });
  it("permits operator cleanup only for the exact fresh run identity with no memberships", () => {
    const runId = "holding-browser-20261121080138989-abcdef";
    const { user } = localSystemOperatorPlan(local, runId);
    const candidate = { ...user, membershipCount: 0 };
    expect(() => assertLocalSystemOperatorOwnership(local, runId, candidate)).not.toThrow();
    for (const patch of [{ id: "holding-demo-key-reviewer" }, { email: "real@example.com" }, { demoOnly: true }, { platformAdmin: false }, { name: "Real administrator" }, { membershipCount: 1 }])
      expect(() => assertLocalSystemOperatorOwnership(local, runId, { ...candidate, ...patch })).toThrow(/operator|ownership/i);
    expect(() => assertLocalSystemOperatorOwnership(local, "holding-browser-20261121080138989-123456", candidate)).toThrow(/operator|ownership/i);
  });
  it.each(["personality", "motivation"])("marks %s interactive training N/A only from explicit empty source and verified before/after untimed start", testId => {
    const source = catalog.find(form => form.id === testId)!;
    const before = { timeLimitSeconds: null, timerStartedAt: null, expiresAt: null, delivery: { practice: [] } };
    const after = { ...before, timerStartedAt: "2026-11-21T08:21:00.000Z" };
    const exemption = untimedTrainingExemption(testId, source, before, after);
    expect(exemption).toMatchObject({ status: "not_applicable", source: "data/catalog.json", testId, practiceCount: 0, timeLimitSeconds: null });
    expect(exemption?.reason).toContain(`${testId}.delivery.practice=[]`);
    expect(exemption?.reason).toContain("timeLimitSeconds=null");
    expect(untimedTrainingExemption(testId, { ...source, delivery: { practice: [{ invented: true }] } }, before, after)).toBeUndefined();
    expect(untimedTrainingExemption(testId, { ...source, delivery: {} }, before, after)).toBeUndefined();
    expect(untimedTrainingExemption(testId, source, before, { ...after, expiresAt: "2026-11-21T09:00:00Z" })).toBeUndefined();
    expect(untimedTrainingExemption(testId, source, before, { ...after, timerStartedAt: null })).toBeUndefined();
    expect(untimedTrainingExemption(testId, source, { ...before, timeLimitSeconds: 1200 }, after)).toBeUndefined();
    expect(untimedTrainingExemption(testId, source, before, { ...after, delivery: {} })).toBeUndefined();
  });
  it("never exempts the four canonical timed forms from their provided training", () => {
    for (const testId of ["verbal", "numerical", "logical", "situations"]) {
      const source = catalog.find(form => form.id === testId)!;
      expect(source.delivery.practice.length).toBeGreaterThan(0);
      const before = { timeLimitSeconds: null, timerStartedAt: null, expiresAt: null, delivery: { practice: [] } };
      expect(untimedTrainingExemption(testId, source, before, { ...before, timerStartedAt: "2026-11-21T08:21:00Z" })).toBeUndefined();
    }
  });
  it("does not leak credentials in a rejected-target error", () => {
    try { assertLocalHoldingEnvironment({ DATABASE_URL: "postgresql://name:sensitive-password@remote/production" }); } catch (e) { expect(String(e)).not.toContain("sensitive-password"); }
  });
  it("requires immutable namespace, synthetic mode, assessment purpose and demo-only users", () => {
    const org = { id: DEMO_ORGANIZATION_ID, slug: DEMO_ORGANIZATION_ID, name: DEMO_NAME, purpose: "assessment", dataMode: "synthetic" };
    const user = syntheticRoster(HOLDING_PROFILES)[0];
    expect(() => assertDemoOwnership(org, [user])).not.toThrow();
    for (const patch of [{ dataMode: "real" }, { purpose: "pilot" }, { id: "demo-organization" }, { name: "Real company" }]) expect(() => assertDemoOwnership({ ...org, ...patch }, [user])).toThrow(/synthetic|namespace|conflict/i);
    for (const patch of [{ demoOnly: false }, { email: "real@example.com" }, { id: "existing-user" }]) expect(() => assertDemoOwnership(org, [{ ...user, ...patch }])).toThrow(/demo|namespace|conflict/i);
  });
  it("builds 65 fresh identities by profile number, never copies people or answers", () => {
    const polluted = HOLDING_PROFILES.map(p => ({ ...p, name: "REAL PERSON MUST NOT COPY", email: "real@example.com", answers: { secret: true }, userId: "real-id" }));
    const roster = syntheticRoster(polluted);
    expect(roster).toHaveLength(65);
    expect(new Set(roster.map(p => p.id)).size).toBe(65);
    expect(new Set(roster.map(p => p.email)).size).toBe(65);
    expect(roster.every(p => p.demoOnly && p.name === `Демо-участник ${String(p.profileRow).padStart(2, "0")}` && p.targetLevelModel === "В")).toBe(true);
    expect(JSON.stringify(roster)).not.toMatch(/REAL PERSON|real@example|real-id|secret/);
    for (const pair of [[55, 56], [58, 59]]) expect(roster[pair[0] - 1].id).not.toBe(roster[pair[1] - 1].id);
    expect(() => syntheticRoster([...HOLDING_PROFILES.slice(0, 64), HOLDING_PROFILES[0]])).toThrow(/65|profile/i);
  });
  it("labels seeded results as synthetic data, not browser/timer proof", () => {
    expect(syntheticProvenance()).toMatchObject({ synthetic: true, source: "generated_no_real_data", browserVerified: false, timerVerified: false });
  });
  it.each(catalog.map(form => [form.id, form] as const))("generates valid deterministic %s answers using installed option IDs", (_id, form) => {
    const questions = form.questions as unknown as QuestionInput[];
    const config = form.config as unknown as ScoringConfig;
    for (const n of [1, 2, 55, 56, 58, 59, 65]) {
      const answers = syntheticAnswers(form.id, questions, config, n);
      expect(answers).toEqual(syntheticAnswers(form.id, questions, config, n));
      expect(Object.keys(answers)).toHaveLength(questions.length);
      for (const q of questions) expect(() => validateAnswer(q, answers[q.id], config)).not.toThrow();
      if (form.id === "personality") { expect(answers["personality-v2-К1"]).toBe(2); expect(answers["personality-v2-К2"]).toBe(4); }
      const score = calculateScore(form.algorithm, config, questions, answers, { durations: Object.fromEntries(questions.map(q => [q.id, form.id === "situations" ? 90000 : 25000])) });
      expect(score.reviewRequired).not.toBe(true);
      if (form.id === "motivation") expect(score.qualityFlags).not.toContain("ranking_mismatch");
    }
  });
});
