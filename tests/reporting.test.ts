import { describe, expect, it } from "vitest";
import { reportAiInput, reportMetrics, generatedContentSchema, validateReportEvidence, type ReportSnapshot } from "../packages/core/reporting";
import { professionalReportTemplate } from "../apps/api/src/report-layout";

const snapshot = (): ReportSnapshot => ({
  organization: { name: "Организация", matrixConfig: { x: { ru: "Компетенции" }, y: { ru: "Потенциал" }, levels: [{ ru: "Низкий" }, { ru: "Средний" }, { ru: "Высокий" }] } },
  campaign: { id: "campaign", name: "Оценка 2026" },
  people: [{ id: "p1", name: "Иван Пример", position: "Руководитель", unit: "Офис", category: "Руководитель", status: "completed", completed: 1, total: 1,
    results: [{ testId: "verbal", testVersionId: "verbal-v1", version: "1", scoringKeyId: "key-1", language: "ru", name: { ru: "Вербальное мышление" }, score: { algorithm: "cognitive", total: 2, maximum: 4, percent: 50 } }],
    observations: [], expert: null }],
});
const content = () => generatedContentSchema.parse({
  summary: [{ text: "Результат требует сопоставления с рабочими задачами.", evidenceIds: ["metric-1"] }],
  analytical: [], personality: [], motivation: [], management: [], competencies: [], potential: [],
  strengths: [], development: [], risks: [], recommendations: [{ text: "Проверить план на рабочей задаче.", evidenceIds: ["metric-1"] }],
  developmentPlan: [{ focus: "Планирование", action: "Составить план рабочей задачи.", format: "Практика", timeframe: "30 дней", success: "Проверить выполнение плана", evidenceIds: ["metric-1"] }],
  limitations: ["Нормативы не применяются."],
});

describe("Professional reports", () => {
  it("does not pool different form, scoring or language versions", () => {
    const s = snapshot();
    s.people.push(...["key", "language", "form"].map((change, i) => ({
      ...s.people[0], id: "p" + (i+2), unit: "Филиал",
      results: s.people[0].results.map(r => ({ ...r, scoringKeyId: change === "key" ? "key-2" : r.scoringKeyId, language: change === "language" ? "kk" : r.language, testVersionId: change === "form" ? "verbal-v2" : r.testVersionId })),
    })));
    expect(reportMetrics(s, "ru")).toHaveLength(4);
    expect(reportMetrics(s, "ru").every(m => m.n === 1)).toBe(true);
  });
  it("calculates department means using observed values, preserving real zeros", () => {
    const s = snapshot();
    s.people.push({ ...s.people[0], id: "p2", unit: "Филиал", results: [{ ...s.people[0].results[0], score: { algorithm: "cognitive", total: 0, maximum: 4 } }] });
    s.people.push({ ...s.people[0], id: "p3", results: [{ ...s.people[0].results[0], score: null }] });
    const [m] = reportMetrics(s, "ru");
    expect(m.mean).toBe(1);
    expect(m.n).toBe(2);
    expect(m.units.find(u => u.name === "Филиал")?.mean).toBe(0);
  });
  it("does not count 'not observed' as a low competency score", () => {
    const s = snapshot();
    s.people[0].observations = [{ id: "obs", criteriaSnapshot: { name: "Интервью", type: "interview", criteria: [{ id: "c", name: "Планирование", scale: [{ value: 1 }, { value: 5 }] }] }, scores: { c: null }, notes: "Не наблюдалось", createdAt: "2026-01-01" }];
    expect(reportMetrics(s, "ru").filter(m => m.testId === "expert")).toHaveLength(0);
  });
  it("keeps SJT distinct and uses its actual maximum, not a hardcoded 16", () => {
    const s = snapshot();
    s.people[0].results[0] = { ...s.people[0].results[0], testId: "situations", score: { algorithm: "sjt", total: 12, maximum: 32 } };
    const [m] = reportMetrics(s, "ru");
    expect(m.testId).toBe("sjt");
    expect(m.max).toBe(32);
  });
  it("redacts direct identifiers from personal AI input and omits individual observations in team input", () => {
    const s = snapshot();
    s.people[0].observations = [{ id: "obs", criteriaSnapshot: { name: "Интервью", criteria: [] }, scores: {}, notes: "Иван Пример: связь ivan@example.test", createdAt: "2026-01-01" }];
    const personal = JSON.stringify(reportAiInput(s, "individual", "ru").input);
    expect(personal).not.toContain("Иван Пример");
    expect(personal).not.toContain("ivan@example.test");
    expect(reportAiInput(s, "team", "ru").input.observations).toEqual([]);
  });
  it("rejects fabricated evidence references, including development actions", () => {
    const c = content();
    validateReportEvidence(c, new Set(["metric-1"]));
    c.developmentPlan[0].evidenceIds = ["invented"];
    expect(() => validateReportEvidence(c, new Set(["metric-1"]))).toThrow();
  });
  it("escapes participant and narrative HTML and has five substantive sections beyond the cover", () => {
    const s = snapshot(), c = content();
    s.people[0].name = "<script>alert(1)</script>";
    c.summary[0].text = "<img src=x onerror=alert(1)>";
    const rendered = professionalReportTemplate(s, c, { kind: "individual", language: "ru", createdAt: "2026-01-01" });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html.match(/<section class="report-page/g)).toHaveLength(6);
    expect(rendered.html).not.toContain("metric-1");
  });
  it("applies the individual PDF copy cleanup to team reports", () => {
    const s = snapshot(), c = content();
    c.summary[0].text = "Версия 1.0-draft · RU. AI-отчёт. Баллы обозначают число правильных ответов выбранной формы. Процент правильных ответов не является процентилем. Первичные баллы не являются процентилями или оценкой пригодности к должности. Матрица потенциала 9-box.";
    const rendered = professionalReportTemplate(s, c, { kind: "team", language: "ru", createdAt: "2026-01-01" });
    const visibleText = rendered.html.replace(/<[^>]+>/g, " ");
    expect(visibleText).not.toMatch(/AI|1\.0-draft|процентил|матриц|не дают устойчивых оснований/iu);
    expect(visibleText).not.toContain(". отчёт");
  });
});
