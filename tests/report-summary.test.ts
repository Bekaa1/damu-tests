import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { calculateScore } from "../packages/core/scoring";
import { percentageLevel } from "../packages/core/test-levels";
import { testLevel, motivationProfile } from "../packages/core/report-policy";
import { teamTestReportData } from "../packages/core/team-reporting";
import { reportAiInput } from "../packages/core/report-input";
import { dataReport } from "../packages/core/report-fallback";
import { customerReportTemplate } from "../apps/api/src/customer-report";
import { reportSummaryFixture, factorNames } from "./fixtures/report-summary";

describe("Customer report revisions 19.11", () => {
  it.each([
    [0, 1],
    [39.99, 1],
    [40, 2],
    [54.99, 2],
    [55, 3],
    [69.99, 3],
    [70, 4],
    [84.99, 4],
    [85, 5],
    [100, 5],
  ])(
    "classifies the exact percentage %s as level %s before display rounding",
    (percent, level) => {
      expect(percentageLevel(percent)).toBe(level);
    },
  );
  it("replaces stale saved levels and derives the ratio from original scores", () => {
    expect(
      testLevel({
        total: 20,
        maximum: 24,
        percent: 100,
        level: 5,
        bandThresholds: [7, 11, 15, 19, 24],
      }),
    ).toBe(4);
    expect(testLevel({ total: 0, maximum: 24, excluded: true })).toBeNull();
    expect(testLevel({ total: 0, maximum: 0 })).toBeNull();
  });
  it("scores the current SJT as 14 MOST + 8 LEAST matches = 22/28, level 4", () => {
    const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
    const m = catalog.find((x: any) => x.id === "situations");
    const answers = Object.fromEntries(
      m.questions.map((q: any, i: number) => {
        const key = m.config.items[q.id];
        return [
          q.id,
          {
            most: key.most,
            least:
              i < 8
                ? key.least
                : q.options.find(
                    (o: any) => o.id !== key.most && o.id !== key.least,
                  ).id,
          },
        ];
      }),
    );
    const score = calculateScore(m.algorithm, m.config, m.questions, answers);
    expect(score).toMatchObject({
      mostMatches: 14,
      leastMatches: 8,
      total: 22,
      maximum: 28,
      level: 4,
    });
    expect(score.percent).toBeCloseTo(78.571428);
  });
  it("uses percentage bands when scoring 20 correct answers in the current logical form", () => {
    const m = JSON.parse(readFileSync("data/catalog.json", "utf8")).find(
      (x: any) => x.id === "logical",
    );
    const answers = Object.fromEntries(
      m.questions.map((q: any, i: number) => [
        q.id,
        i < 20
          ? m.config.items[q.id].correct
          : q.options.find((o: any) => o.id !== m.config.items[q.id].correct)
              .id,
      ]),
    );
    expect(
      calculateScore(m.algorithm, m.config, m.questions, answers),
    ).toMatchObject({ total: 20, maximum: 24, level: 4 });
  });
  it.each(["ru", "kk"] as const)(
    "keeps only domain words and 3+3 factors in both %s reports without changing source scores",
    (language) => {
      for (const kind of ["individual", "team"] as const) {
        const s = reportSummaryFixture(kind === "team" ? 5 : 1),
          before = JSON.stringify(s);
        const content = dataReport(s, language, kind);
        const html = customerReportTemplate(s, content, {
          kind,
          language,
          createdAt: "2026-11-19",
        }).html;
        expect(html).not.toMatch(
          /Приложение:|Қосымша:|Профиль компетенций|Құзыреттер бейіні|3,1|4,75|Спокойствие в неопределённости/,
        );
        for (const id of [1, 2, 3, 10, 11, 12])
          expect(html).toContain(`${factorNames[id - 1][language]}<`);
        for (const id of [4, 5, 6, 7, 8, 9])
          expect(html).not.toContain(`${factorNames[id - 1][language]}<`);
        expect(html).toContain(
          language === "ru"
            ? "20 из 24 (83%) → уровень 4, выше среднего"
            : "24 ішінен 20 (83%) → 4-деңгей, орташадан жоғары",
        );
        expect(html).toContain(
          language === "ru"
            ? "22 из 28 (79%) → уровень 4"
            : "28 ішінен 22 (79%) → 4-деңгей",
        );
        expect(html).toContain("&lt; 40%");
        expect(html).toContain("≥ 85%");
        const input = reportAiInput(s, kind, language).input;
        expect(JSON.stringify(input)).not.toMatch(
          /extremeFacets|competencyConsensus|Спокойствие в неопределённости|4\.75/,
        );
        expect(JSON.stringify(s)).toBe(before);
      }
    },
  );
  it("selects three distinct lowest priorities after the selected-card adjustment", () => {
    const s = reportSummaryFixture();
    s.people[0].results.at(-1)!.score.motivation = {
      profile: { M1: { adjusted: 5, priority: 1 } },
    };
    const m = motivationProfile(s.people[0], "ru");
    expect(m.top.map((x) => x.id)).toEqual(["M1", "M12", "M11"]);
    expect(m.bottom.map((x) => x.id)).toEqual(["M2", "M3", "M4"]);
  });
  it("uses one concise personality paragraph only when all five domains are available and average", () => {
    for (const kind of ["individual", "team"] as const)
      for (const language of ["ru", "kk"] as const) {
        const s = reportSummaryFixture(kind === "team" ? 5 : 1);
        for (const p of s.people)
          for (const [id, scale] of Object.entries(
            p.results[1].score.scales,
          ) as [string, any][])
            if (id.length === 1) scale.mean = 3;
        const c = dataReport(s, language, kind);
        expect(c.personality).toHaveLength(1);
        const expected = c.personality[0].text;
        if (kind === "individual" && language === "ru")
          expect(expected).toBe(
            "По всем пяти шкалам результаты в среднем диапазоне, выраженных особенностей нет.",
          );
        expect(
          JSON.stringify(reportAiInput(s, kind, language).input),
        ).toContain(expected);
        c.personality = [
          {
            text: "Описывает себя средним образом.",
            evidenceIds: ["coverage"],
          },
          { text: "Повтор описания каждой шкалы.", evidenceIds: ["coverage"] },
        ];
        const render = () =>
          customerReportTemplate(s, c, {
            kind,
            language,
            createdAt: "2026-11-19",
          }).html;
        expect(render().split(expected)).toHaveLength(2);
        expect(render()).not.toContain("Описывает себя средним образом");
        expect(render()).not.toContain("Повтор описания каждой шкалы");
        for (const p of s.people) p.results[1].score.scales.E.mean = 4.5;
        expect(render()).not.toContain(expected);
        for (const p of s.people) {
          p.results[1].score.scales.E.mean = 3;
          p.results[1].score.scales.N.reportNorm = { sten: null };
        }
        expect(render()).not.toContain(expected);
        expect(
          JSON.stringify(reportAiInput(s, kind, language).input),
        ).not.toContain(expected);
      }
  });
  it("derives the group level from median raw scores and suppresses small cells or incompatible keys", () => {
    const s = reportSummaryFixture(6);
    const d = teamTestReportData(s, "ru");
    expect(
      d.methods.find((m) => m.testId === "logical")!.overall,
    ).toMatchObject({ total: 20, maximum: 24, level: 4, n: 6 });
    expect(
      d.methods.every((m) => m.groups.every((g) => g.summary === null)),
    ).toBe(true);
    expect(d.personality).toHaveLength(5);
    expect(d.motivation[0].top).toHaveLength(3);
    expect(d.motivation[0].bottom).toHaveLength(3);
    s.people
      .slice(0, 3)
      .forEach(
        (p) =>
          (p.results.find((r) => r.testId === "logical")!.scoringKeyId =
            "different"),
      );
    expect(
      teamTestReportData(s, "ru")
        .methods.filter((m) => m.testId === "logical")
        .every((m) => m.overall === null),
    ).toBe(true);
    const small = teamTestReportData(reportSummaryFixture(4), "ru");
    expect(small.suppressed).toBe(true);
    expect(small.personality).toEqual([]);
    expect(small.methods).toEqual([]);
    expect(small.motivation).toEqual([]);
  });
});
