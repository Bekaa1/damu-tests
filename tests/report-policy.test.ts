import { reviewFixture } from "./fixtures/report-review";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { reportAiInput, type ReportSnapshot } from "../packages/core/reporting";
import {
  reportScale,
  reportContentIssues,
  reportTextIssues,
  personalityProfile,
  riskEvidence,
} from "../packages/core/report-policy";
import { teamReportData } from "../packages/core/team-reporting";
import {
  compileEffectivenessKey,
  verifyEffectivenessCalibration,
} from "../packages/core/sjt-calibration";
import { calculateScore } from "../packages/core/scoring";
import { DEFAULT_COMPETENCIES } from "../packages/core/competencies";
import { dataReport } from "../packages/core/report-fallback";
import { customerReportTemplate } from "../apps/api/src/customer-report";
describe("Customer report policy 17.11", () => {
  it("changes display aliases and direction without mutating source scores or reversing N3 again", () => {
    const raw = { name: { ru: "Тревожность" }, mean: 4.75, min: 1, max: 5 };
    expect(reportScale("N1", raw, "personality").mean).toBe(1.25);
    expect(reportScale("N3", raw, "personality").mean).toBe(4.75);
    expect(raw.mean).toBe(4.75);
  });
  it("rounds before sending to model and omits middle facets and cohort percentiles below 30", () => {
    const s = reviewFixture(1),
      r = s.people[0].results[0];
    r.score.cohortPercentile = { n: 29, value: 81.234 };
    const input = reportAiInput(s, "individual", "ru").input;
    const text = JSON.stringify(input);
    expect(text).not.toContain("Тревожность");
    expect(text).not.toContain("Доверие");
    expect(text).not.toContain("81.234");
    expect(
      personalityProfile(s.people[0], "ru").find((p) => p.id === "N1")!.band,
    ).toBe("low");
  });
  it("excludes an invalid participant entirely and suppresses every small cell without identities", () => {
    const s = reviewFixture(10);
    s.people[0].results[1].score.qualityFlags = ["straightlining"];
    const d = teamReportData(s, "ru");
    expect(d.passport.included).toBe(9);
    expect(d.passport.excluded).toBe(1);
    expect(
      d.methods.every((m) =>
        m.groups.every((g) => g.suppressed && !("n" in g)),
      ),
    ).toBe(true);
    const input = JSON.stringify(reportAiInput(s, "team", "ru").input);
    expect(input).not.toContain("person-");
    expect(input).not.toContain("Контрольный участник");
    expect(input).not.toContain("Тревожность");
  });
  it("reports median and distribution totals for 65 and never pools scoring keys", () => {
    const s = reviewFixture(65),
      d = teamReportData(s, "ru");
    expect(
      d.methods
        .find((m) => m.testId === "verbal")!
        .distribution.reduce((n, x) => n + x.count, 0),
    ).toBe(65);
    s.people[0].results[0].scoringKeyId = "other";
    const split = teamReportData(s, "ru").methods.filter(
      (m) => m.testId === "verbal",
    );
    expect(split).toHaveLength(2);
    expect(split.some((m) => m.overall.suppressed)).toBe(true);
  });
  it("does not round an insignificant group difference into a reportable comparison", () => {
    const s = reviewFixture(20);
    for (const p of s.people) {
      p.results[1].score.scales.N.mean = p.unit === "Головной офис" ? 3 : 3.499;
    }
    expect(
      teamReportData(s, "ru").methods.find((m) => m.scale === "N")!.comparison,
    ).toBeNull();
    for (const p of s.people)
      if (p.unit !== "Головной офис") p.results[1].score.scales.N.mean = 3.5;
    expect(
      teamReportData(s, "ru").methods.find((m) => m.scale === "N")!.comparison
        ?.difference,
    ).toBe(-0.5);
  });
  it("requires linked exercise evidence and a consensus score for a confirmed risk", () => {
    const s = reviewFixture(1),
      p = s.people[0],
      profile = p.competencyProfile;
    expect(riskEvidence(p, "ru").confirmed).toHaveLength(0);
    profile.model.content.competencies[0].sources.push({
      kind: "test",
      id: "personality",
      scales: ["N1"],
    });
    profile.consensus.scores.ratings[0] = {
      competencyId: "analysis",
      value: 2,
      reason: "Наблюдалось отсутствие проверки данных.",
      evidenceIds: ["exercise-1", "personality-result"],
    };
    profile.cards = [
      {
        id: "analysis",
        sources: [
          {
            id: "personality-result",
            kind: "test",
            score: { scales: { N1: { mean: 4.75 } } },
          },
          {
            id: "exercise-1",
            kind: "exercise",
            scores: [{ score: 2 }],
            notes: "Решение принято до сравнения вариантов.",
          },
        ],
      },
    ];
    expect(riskEvidence(p, "ru").confirmed).toHaveLength(1);
    profile.consensus.scores.ratings[0].value = 3;
    expect(riskEvidence(p, "ru").confirmed).toHaveLength(0);
  });
  it("blocks stop words, excess precision, unsupported risks and named team conclusions", () => {
    expect(
      reportTextIssues("Участник конфликтный и не способен руководить."),
    ).toHaveLength(2);
    expect(reportTextIssues("Дата: 17.11.2026. Оценка 3,1.")).toHaveLength(0);
    expect(reportTextIssues("С тревожностью и импульсивностью.")).toHaveLength(
      2,
    );
    expect(reportTextIssues("Баллы: 3,125.")[0].code).toBe("precision");
    const s = reviewFixture(1),
      c = dataReport(s, "ru");
    c.risks = [{ text: "Риск требует плана.", evidenceIds: ["profile-1"] }];
    expect(
      reportContentIssues(c, s, "individual").some(
        (i) => i.code === "unconfirmed_risk",
      ),
    ).toBe(true);
    c.summary[0].text = "Контрольный участник 0 получил результат.";
    expect(
      reportContentIssues(c, s, "team").some((i) => i.code === "personal_data"),
    ).toBe(true);
  });
  it("keeps raw scores in appendix and interview prompts out of public PDF", () => {
    const s = reviewFixture(1),
      c = dataReport(s, "ru"),
      html = customerReportTemplate(s, c, {
        kind: "individual",
        language: "ru",
        createdAt: new Date("2026-11-17"),
      }).html;
    const main = html.split("Приложение:")[0];
    expect(main).not.toContain("3,1");
    expect(main).not.toContain("Вопросы для интервью");
    expect(main).not.toContain("Тревожность");
    expect(html).toContain("3,1");
    expect(html.match(/<section class="report-page/g)).toHaveLength(8);
    expect(reportContentIssues(c, s, "individual")).toEqual([]);
  });
});
describe("Weighted SJT calibration", () => {
  const draft = JSON.parse(
    readFileSync("data/review/sjt-16-draft.json", "utf8"),
  );
  const panel = () => ({
    ...JSON.parse(readFileSync("data/review/sjt-panel-template.json", "utf8")),
    approvedBy: "Synthetic test fixture",
    experts: ["E1", "E2", "E3", "E4", "E5"],
    cases: Object.fromEntries(
      draft.questions.map((q: any) => [
        q.id,
        {
          competencyId:
            draft.review.coverage &&
            Object.entries(draft.config.items).find(([id]) => id === q.id) &&
            DEFAULT_COMPETENCIES.competencies.find(
              (c) => c.name.ru === draft.config.items[q.id].competency.ru,
            )!.id,
          options: Object.fromEntries(
            q.options.map((o: any, i: number) => [
              o.id,
              [
                [5, 5, 5, 4, 4],
                [4, 4, 4, 4, 3],
                [2, 2, 2, 2, 2],
                [1, 1, 1, 2, 2],
              ][i],
            ]),
          ),
        },
      ]),
    ),
  });
  it("uses option effectiveness gaps and the sum of ideal gaps, preserving negative results", () => {
    expect(draft.instructions.ru).toContain("16 управленческих");
    const config = compileEffectivenessKey(draft.questions, panel());
    verifyEffectivenessCalibration(draft.questions, config);
    const answers = Object.fromEntries(
      draft.questions.map((q: any) => [
        q.id,
        { most: q.options[1].id, least: q.options[2].id },
      ]),
    );
    const score = calculateScore("sjt", config, draft.questions, answers);
    expect(score.total).toBeCloseTo(28.8);
    expect(score.maximum).toBeCloseTo(51.2);
    expect(score.percent).toBeCloseTo(56.25);
    expect(score.level).toBe(3);
    const negative = calculateScore(
      "sjt",
      config,
      draft.questions,
      Object.fromEntries(
        draft.questions.map((q: any) => [
          q.id,
          { most: q.options[3].id, least: q.options[0].id },
        ]),
      ),
    );
    expect(negative.percent).toBeCloseTo(-100);
  });
  it("rejects absent or inconsistent panel ratings and tampered keys", () => {
    expect(() => compileEffectivenessKey(draft.questions, {})).toThrow();
    const p = panel();
    p.cases[draft.questions[0].id].options[draft.questions[0].options[0].id] = [
      1, 1, 1, 5, 5,
    ];
    expect(() => compileEffectivenessKey(draft.questions, p)).toThrow(
      /отклонение/,
    );
    const c = compileEffectivenessKey(draft.questions, panel());
    c.items[draft.questions[0].id].effectiveness![
      draft.questions[0].options[0].id
    ] = 5;
    expect(() => verifyEffectivenessCalibration(draft.questions, c)).toThrow();
  });
});
