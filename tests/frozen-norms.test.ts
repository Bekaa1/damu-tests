import { describe, it, expect } from "vitest";
import {
  buildFrozenPayload,
  attachFrozenNorm,
  normKey,
  frozenRank,
  type NormResult,
} from "../packages/core/frozen-norms";
import { personalityProfile } from "../packages/core/report-policy";
import { reportAiInput } from "../packages/core/reporting";
import { readFileSync } from "node:fs";
import {
  compileEffectivenessKey,
  verifyEffectivenessCalibration,
} from "../packages/core/sjt-calibration";
const rows = (): NormResult[] =>
  Array.from({ length: 65 }, (_, i) => ({
    membershipId: "p-" + i,
    resultId: "r-" + i,
    testId: "verbal",
    testVersionId: "v1",
    scoringKeyId: "k1",
    language: "ru",
    score: { algorithm: "cognitive", total: i % 31, maximum: 30 },
  }));
describe("Frozen reference group", () => {
  it("uses midranks so ties get the same percentile and the same sten", () => {
    const r = rows(),
      p = buildFrozenPayload(r),
      rank = (r: NormResult) => attachFrozenNorm(r, p, "frozen");
    expect(rank(r[0]).reportNorm).toEqual(rank(r[31]).reportNorm);
    expect(rank(r[0]).reportNorm.percentile).toBeCloseTo((100 * 1.5) / 65);
    expect(rank(r[0]).reportNorm.sten).toBe(2);
    expect(rank(r[30]).reportNorm.sten).toBe(10);
  });
  it("does not change the reference when a 66th result is compared", () => {
    const r = rows(),
      p = buildFrozenPayload(r),
      copy = JSON.stringify(p),
      before = attachFrozenNorm(r[20], p, "frozen");
    attachFrozenNorm(
      { ...r[0], membershipId: "p-66", score: { ...r[0].score, total: 30 } },
      p,
      "frozen",
    );
    expect(JSON.stringify(p)).toBe(copy);
    expect(attachFrozenNorm(r[20], p, "frozen")).toEqual(before);
  });
  it("does not assign a sten when all reference results are identical", () => {
    const r = rows().map((r) => ({ ...r, score: { ...r.score, total: 10 } })),
      p = buildFrozenPayload(r);
    const n = frozenRank(p, normKey(r[0], "total", "separate"), 10, "norm");
    expect(n.percentile).toBe(50);
    expect(n.sten).toBeNull();
    expect(n.reason).toBe("no_variation");
  });
  it("keeps languages and keys separate unless language equivalence is explicitly approved", () => {
    const r = rows().map((r, i) => ({ ...r, language: i < 25 ? "kk" : "ru" })),
      p = buildFrozenPayload(r);
    expect(p.metrics).toHaveLength(2);
    expect(attachFrozenNorm(r[0], p, "id").reportNorm.sten).toBeNull();
    const combined = buildFrozenPayload(r, "combined");
    expect(combined.metrics).toHaveLength(1);
    expect(combined.metrics[0].n).toBe(65);
    r[0].scoringKeyId = "other";
    expect(buildFrozenPayload(r, "combined").metrics).toHaveLength(2);
  });
  it("excludes the whole careless participant from reference construction but still compares valid ability results", () => {
    const r = rows();
    r.push({
      ...r[0],
      testId: "personality",
      testVersionId: "p1",
      score: {
        qualityFlags: ["straightlining"],
        scales: {
          N1: { mean: 5, min: 1, max: 5, name: { ru: "Тревожность" } },
        },
      },
    });
    const p = buildFrozenPayload(r);
    expect(
      p.metrics.find((m) => m.key === normKey(r[1], "total", "separate"))!.n,
    ).toBe(64);
    expect(attachFrozenNorm(r[0], p, "n").reportNorm.n).toBe(64);
    expect(
      attachFrozenNorm(r.at(-1)!, p, "n").scales.N1.reportNorm.sten,
    ).toBeNull();
  });
  it("calculates neutral personality directions once and uses sten extremes after freezing", () => {
    const r = rows().map((r, i) => ({
        ...r,
        testId: "personality",
        testVersionId: "p1",
        score: {
          scales: {
            N1: {
              name: { ru: "Тревожность" },
              mean: i < 3 ? 5 : 3,
              min: 1,
              max: 5,
            },
          },
        },
      })),
      p = buildFrozenPayload(r);
    const score = attachFrozenNorm(r[0], p, "n");
    expect(score.scales.N1.reportNorm.sten).toBe(2);
    const profile = personalityProfile(
      { results: [{ testId: "personality", score }] } as any,
      "ru",
    )[0];
    expect(profile.mean).toBe(1);
    expect(profile.band).toBe("low");
  });
  it("does not expose participant identities in the aggregate reference payload", () => {
    const p = JSON.stringify(buildFrozenPayload(rows()));
    expect(p).not.toContain("membershipId");
    expect(p).not.toContain("resultId");
    expect(p).not.toContain("p-64");
  });
  it("does not infer a balanced full profile from a missing or constant norm", () => {
    const score = {
      scales: {
        N1: {
          name: { ru: "Тревожность" },
          min: 1,
          max: 5,
          mean: 3,
          reportNorm: {
            normId: "n",
            n: 65,
            sten: null,
            reason: "no_variation",
          },
        },
      },
    };
    const input = reportAiInput(
      {
        organization: { name: "Контроль", matrixConfig: {} },
        campaign: { id: "c", name: "Контроль" },
        people: [
          {
            id: "p",
            name: "Контроль",
            results: [{ testId: "personality", score }],
            observations: [],
          },
        ],
      } as any,
      "individual",
      "ru",
    ).input as any;
    expect(input.profiles[0].personality.allDomainsAvailable).toBe(false);
    expect(input.profiles[0].personality.domains).toEqual([]);
  });
});
describe("Single-expert SJT key", () => {
  it("accepts a real single-author mode without pretending it is a panel", () => {
    const d = JSON.parse(readFileSync("data/review/sjt-16-draft.json", "utf8")),
      template = JSON.parse(
        readFileSync("data/review/sjt-panel-template.json", "utf8"),
      );
    const data = {
      ...template,
      mode: "single",
      experts: ["Контрольный эксперт"],
      approvedBy: "Контрольный эксперт",
    };
    for (const row of Object.values(data.cases) as any[])
      Object.keys(row.options).forEach((id, i) => (row.options[id] = [i + 1]));
    const config = compileEffectivenessKey(d.questions, data);
    verifyEffectivenessCalibration(d.questions, config);
    expect((config.calibration as any).mode).toBe("single");
    expect(() =>
      compileEffectivenessKey(d.questions, { ...data, mode: "panel" }),
    ).toThrow();
  });
});
