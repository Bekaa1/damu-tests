import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import catalog from "../data/catalog.json";
import { HOLDING_PROFILES } from "../packages/core/holding";
import { buildHoldingScoringKey } from "../packages/core/holding-key";
import { DEFAULT_COMPETENCIES } from "../packages/core/competencies";
import { validateAnswer, type QuestionInput, type ScoringConfig } from "../packages/core/scoring";
import { FUND_DEMO_PLAN, fundDemoPlanDigest, assertFundDemoEnvironment, fundDemoRoster, fundDemoFixture, FUND_DEMO_PROVENANCE } from "../packages/core/fund-demo-policy";
import { prepareFundClientDemo, fundDemoScoreMatches, fundDemoCli } from "../scripts/prepare-fund-client-demo";

vi.mock("@prisma/client", () => { throw Error("Unexpected runtime provider import in offline unit test"); });
const env = { DATABASE_URL: "postgresql://fixture:never-print-this@127.0.0.1:55453/assessflow_holding_20261121_fund_demo" };
const options = () => ({ reviewedPlan: structuredClone(FUND_DEMO_PLAN) });
const sjt = catalog.find(f => f.id === "situations")!;
const sjtConfig = buildHoldingScoringKey(sjt.config as unknown as ScoringConfig, sjt.questions as QuestionInput[]);
describe("strictly scoped Fund client synthetic provisioner", () => {
  it("freezes the approved seven existing identities and five numbered source profiles", () => {
    const plan = FUND_DEMO_PLAN;
    expect(plan.sourceOrganizationId).toBe("damu-organization");
    expect(plan.sourceCampaignId).toBe("review-demo-20261119");
    expect(plan.targetOrganization).toMatchObject({ id: "fund-client-demo-20261121", slug: "fund-client-demo-20261121", name: "Оценка руководителей 2026", purpose: "assessment", dataMode: "synthetic", aiBudget: 0 });
    expect(plan.campaign).toMatchObject({ id: "fund-client-demo-20261121-assessment", name: "Демонстрация — вымышленные участники", country: "Казахстан", startsAt: "2026-11-19T00:00:00.000Z", endsAt: "2026-11-20T23:59:59.000Z" });
    expect(plan.identities.map(p => p.userId).sort()).toEqual(["admin", "employee", "cmwoqt4al0006qr0ubtateblz", "report-demo-2", "report-demo-3", "report-demo-4", "report-demo-5"].sort());
    expect(plan.identities.filter(p => p.role === "employee").map(p => p.profileRow)).toEqual([1,26,55,56,59]);
    expect(plan.identities.find(p => p.role === "expert")).toMatchObject({ sourceOrganizationId: "pilot-workspace", sourceMembershipId: "cmwoqt4ax000cqr0u8envo60j", sourceRole: "admin", role: "expert" });
    const roster = fundDemoRoster();
    expect(roster).toHaveLength(7);
    for (const person of roster.filter(p => p.role === "employee")) {
      const profile = HOLDING_PROFILES.find(p => p.profileRow === person.profileRow)!;
      expect(person).toMatchObject({ block: profile.block, unit: profile.unit, position: profile.position, targetLevelModel: "В", targetScore: null, criticality: profile.criticality });
      const modelRole = DEFAULT_COMPETENCIES.roles.find(p => p.profileRow === person.profileRow)!;
      expect(Object.values(modelRole.targets).every(value => value === null)).toBe(true);
      expect(modelRole.criticality).toEqual(profile.criticality);
    }
    expect(new Set(roster.map(p => p.membershipId)).size).toBe(7);
    expect(JSON.stringify(roster)).not.toContain("report-demo-1");
  });
  it("keeps the reviewed scope deeply immutable against caller mutation", () => {
    expect(Object.isFrozen(FUND_DEMO_PLAN)).toBe(true);
    expect(Object.isFrozen(FUND_DEMO_PLAN.identities)).toBe(true);
    expect(Object.isFrozen(FUND_DEMO_PLAN.identities[0])).toBe(true);
    expect(Object.isFrozen(FUND_DEMO_PLAN.targetOrganization)).toBe(true);
  });
  it("hashes semantic plan values, not JSON object insertion order", () => {
    const reverse = (v: any): any => Array.isArray(v) ? v.map(reverse) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v;
    expect(fundDemoPlanDigest(reverse(FUND_DEMO_PLAN))).toBe(fundDemoPlanDigest(FUND_DEMO_PLAN));
    expect(fundDemoPlanDigest({ ...FUND_DEMO_PLAN, identities: [...FUND_DEMO_PLAN.identities].reverse() })).not.toBe(fundDemoPlanDigest(FUND_DEMO_PLAN));
  });
  it("allows only explicit disposable loopback Holding databases locally", () => {
    expect(() => assertFundDemoEnvironment(env, options())).not.toThrow();
    for (const DATABASE_URL of ["postgresql://u:never-print-this@remote/assessflow", env.DATABASE_URL + "?host=remote", env.DATABASE_URL + "?schema=secret", "postgresql://u:never-print-this@localhost/assessflow", env.DATABASE_URL + "#fragment"]) {
      let error = ""; try { assertFundDemoEnvironment({ DATABASE_URL }, options()); } catch (e) { error = String(e); }
      expect(error).toMatch(/Fund demo guard/); expect(error).not.toContain("never-print-this");
    }
    for (const key of ["S3_ENDPOINT", "BASE_URL", "APP_URL", "API_URL", "REDIS_URL"]) expect(() => assertFundDemoEnvironment({ ...env, [key]: "https://remote.invalid" }, options())).toThrow(/guard/);
    expect(() => assertFundDemoEnvironment(env, { reviewedPlan: { ...FUND_DEMO_PLAN, sourceOrganizationId: "wrong" } } as any)).toThrow(/reviewed plan/);
  });
  it("rejects truthy nonboolean mutation switches and connection-routing overrides", () => {
    for (const key of ["apply", "production", "allowProduction", "allowIdentityPresentationConversion"]) expect(() => assertFundDemoEnvironment(env, { ...options(), [key]: "yes" } as any)).toThrow(/guard/);
    for (const key of ["DATABASE_URL_UNPOOLED", "DIRECT_URL", "PGHOST", "PGHOSTADDR", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"]) expect(() => assertFundDemoEnvironment({ ...env, [key]: "conflicting" }, options())).toThrow(/overrides/);
  });
  it("requires two production authorizations, exact reviewed plan, full SHA and independent matching attestation", () => {
    const production = { DATABASE_URL: "postgresql://fixture:never-print-this@postgres:5432/assessflow", FUND_DEMO_RELEASE_SHA: "a".repeat(40) };
    const allowed = { ...options(), production: true, apply: true, allowProduction: true, allowIdentityPresentationConversion: true, expectedReleaseSha: "a".repeat(40) };
    expect(() => assertFundDemoEnvironment(production, allowed)).not.toThrow();
    for (const patch of [{ allowProduction: false }, { allowIdentityPresentationConversion: false }, { expectedReleaseSha: "a".repeat(7) }, { expectedReleaseSha: "b".repeat(40) }]) expect(() => assertFundDemoEnvironment(production, { ...allowed, ...patch })).toThrow(/guard/);
    expect(() => assertFundDemoEnvironment({ ...production, FUND_DEMO_RELEASE_SHA: undefined }, allowed)).toThrow(/guard/);
    for (const DATABASE_URL of [production.DATABASE_URL + "?host=elsewhere", production.DATABASE_URL.replace("@postgres:", "@postgres.evil:"), production.DATABASE_URL.replace("/assessflow", "/other")]) expect(() => assertFundDemoEnvironment({ ...production, DATABASE_URL }, allowed)).toThrow(/guard/);
  });
  it.each([15,18,21,24,26])("derives SJT %s by valid distinct option IDs through the real scorer", total => {
    const fixture = fundDemoFixture({ testId: "situations", questions: sjt.questions as QuestionInput[], algorithm: "sjt", config: sjtConfig, timeLimitSeconds: sjt.timeLimitSeconds }, 1, total);
    expect(fixture.score.total).toBe(total); expect(fixture.score.maximum).toBe(28);
    expect(fixture.score.holdingProfile).toHaveLength(8);
    expect(fixture.score.validity.eligible).toBe(true);
    for (const q of sjt.questions) { const answer: any = fixture.answers[q.id]; expect(answer.most).not.toBe(answer.least); expect(() => validateAnswer(q as QuestionInput, answer, sjtConfig)).not.toThrow(); }
    expect(fixture.score.provenance).toEqual(FUND_DEMO_PROVENANCE);
    expect(fixture.score.simulatedResponseDurations).toBe(true);
    expect(fixture.score.reviewRequired).not.toBe(true);
  });
  it.each(catalog.filter(f => f.id !== "situations"))("generates complete eligible $id fixtures without copied answers", form => {
    for (const seed of [1,26,55,56,59]) {
      const fixture = fundDemoFixture({ ...form, testId: form.id, config: form.config as unknown as ScoringConfig, questions: form.questions as QuestionInput[] }, seed);
      expect(fixture.score.validity.eligible).toBe(true); expect(fixture.score.reviewRequired).not.toBe(true);
      expect(fixture.elapsedMs).toBeGreaterThan(0);
      if (form.timeLimitSeconds) expect(fixture.elapsedMs).toBeLessThan(form.timeLimitSeconds * 1000);
      for (const q of form.questions) expect(() => validateAnswer(q as QuestionInput, fixture.answers[q.id], form.config as unknown as ScoringConfig)).not.toThrow();
    }
  });
  it("rejects invalid targets and a non-Holding SJT key instead of fabricating profiles", () => {
    for (const total of [-1,29,1.5]) expect(() => fundDemoFixture({ testId: "situations", questions: sjt.questions as QuestionInput[], algorithm: "sjt", config: sjtConfig, timeLimitSeconds: 1200 }, 1, total)).toThrow();
    expect(() => fundDemoFixture({ testId: "situations", questions: sjt.questions as QuestionInput[], algorithm: "sjt", config: sjt.config as unknown as ScoringConfig, timeLimitSeconds: 1200 }, 1, 15)).toThrow(/Holding/);
  });
  it("accepts only machine-precision JSONB float transport differences, never different fixture values", () => {
    expect(fundDemoScoreMatches({ scales: { O: { mean: 3.041666666666667 } }, total: 15 }, { total: 15, scales: { O: { mean: 3.0416666666666665 } } })).toBe(true);
    expect(fundDemoScoreMatches({ mean: 3.041667 }, { mean: 3.0416666666666665 })).toBe(false);
    expect(fundDemoScoreMatches({ total: 16 }, { total: 15 })).toBe(false);
    expect(fundDemoScoreMatches({ total: 15.000000000000002 }, { total: 15 })).toBe(false);
    expect(fundDemoScoreMatches({ total: 15 }, { total: 15.000000000000002 })).toBe(false);
    expect(fundDemoScoreMatches({ flags: ["b","a"] }, { flags: ["a","b"] })).toBe(false);
    expect(fundDemoScoreMatches({ mean: 3 }, { mean: 3, extra: null })).toBe(false);
  });
  it("validates guards before touching an injected client", async () => {
    const transaction = vi.fn(() => { throw Error("database touched"); });
    await expect(prepareFundClientDemo({ $transaction: transaction } as any, options(), { DATABASE_URL: "postgresql://u:never-print-this@remote/assessflow" })).rejects.toThrow(/guard/);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("CLI validates complete scope and environment before a runtime database import", async () => {
    const args = [`--source-organization=${FUND_DEMO_PLAN.sourceOrganizationId}`, `--source-campaign=${FUND_DEMO_PLAN.sourceCampaignId}`, `--plan-digest=${fundDemoPlanDigest(FUND_DEMO_PLAN)}`];
    await expect(fundDemoCli(args, { DATABASE_URL: "postgresql://u:never-print-this@remote/assessflow" })).rejects.toThrow(/Fund demo guard/);
    for (const extra of ["--force", "--apply=1", "--apply", "--source-campaign=wrong"]) {
      const invalid=extra==="--apply" ? [...args,extra,extra] : [...args,extra];
      await expect(fundDemoCli(invalid,env)).rejects.toThrow(/Fund demo guard/);
    }
  });
  it("integration startup requires opt-in and exact disposable DB/bucket before runtime providers", () => {
    for (const patch of [{}, { RUN_FUND_DEMO_LOCAL_INTEGRATION: "1", DATABASE_URL: env.DATABASE_URL, S3_BUCKET: "wrong", S3_ENDPOINT: "http://127.0.0.1:3901" }, { RUN_FUND_DEMO_LOCAL_INTEGRATION: "1", DATABASE_URL: env.DATABASE_URL.replace("_fund_demo", ""), S3_BUCKET: "fund-demo-local-integration-only", S3_ENDPOINT: "http://127.0.0.1:3901" }]) {
      const child=spawnSync(process.execPath,["--import","tsx","tests/fund-demo-local-integration.ts"],{cwd:process.cwd(),env:{NODE_ENV:"test",PATH:process.env.PATH,HOME:process.env.HOME,...patch},encoding:"utf8"});
      expect(child.status).toBe(1);expect(child.stdout).toBe("");expect(child.stderr).not.toContain("PrismaClientInitializationError");expect(child.stderr).not.toContain("never-print-this");
    }
  });
  it("CLI fails closed without loading dotenv/providers or exposing connection secrets", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/prepare-fund-client-demo.ts"], { cwd: process.cwd(), env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: "postgresql://u:never-print-this@remote/assessflow" }, encoding: "utf8" });
    expect(child.status).toBe(1); expect(child.stderr).toContain("Fund demo guard"); expect(child.stderr).not.toContain("never-print-this"); expect(child.stdout).toBe("");
  });
});
