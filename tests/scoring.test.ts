import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  calculateScore,
  validateAnswer,
  numericValue,
  verifyScoringConfig,
  type QuestionInput,
  type ScoringConfig,
} from "../packages/core/scoring";
const text = { ru: "Контрольный вопрос", kk: "Бақылау сұрағы" };
const sjt: QuestionInput[] = Array.from({ length: 8 }, (_, i) => ({
  id: `q${i + 1}`,
  type: "sjt",
  text,
  options: ["A", "B", "C", "D"].map((l) => ({ id: `q${i + 1}-${l}`, text })),
}));
const pairs = [
  ["A", "B"],
  ["A", "C"],
  ["C", "D"],
  ["B", "A"],
  ["D", "A"],
  ["B", "A"],
  ["D", "B"],
  ["C", "A"],
];
const key: ScoringConfig = {
  items: Object.fromEntries(
    sjt.map((q, i) => [
      q.id,
      { most: `${q.id}-${pairs[i][0]}`, least: `${q.id}-${pairs[i][1]}` },
    ]),
  ),
};
const correct = Object.fromEntries(
  sjt.map((q, i) => [
    q.id,
    { most: `${q.id}-${pairs[i][0]}`, least: `${q.id}-${pairs[i][1]}` },
  ]),
) as Record<string, any>;
describe("SJT — независимые контрольные примеры из ТЗ", () => {
  it("8 ситуаций, 16 баллов, отдельно MOST и LEAST", () => {
    const r = calculateScore("sjt", key, sjt, correct);
    expect(r).toMatchObject({
      total: 16,
      maximum: 16,
      percent: 100,
      mostMatches: 8,
      leastMatches: 8,
      interpretation: "preliminary_matching_index",
    });
  });
  it("ситуация 1: C/B = 1, C/D = 0", () => {
    expect(
      calculateScore("sjt", key, sjt, {
        ...correct,
        q1: { most: "q1-C", least: "q1-B" },
      }).total,
    ).toBe(15);
    expect(
      calculateScore("sjt", key, sjt, {
        ...correct,
        q1: { most: "q1-C", least: "q1-D" },
      }).total,
    ).toBe(14);
  });
  it("все пары в обратном порядке = 0", () => {
    const a = Object.fromEntries(
      Object.entries(correct).map(([id, v]) => [
        id,
        { most: v.least, least: v.most },
      ]),
    );
    expect(calculateScore("sjt", key, sjt, a).total).toBe(0);
  });
  it("нельзя MOST = LEAST", () =>
    expect(() =>
      validateAnswer(sjt[0], { most: "q1-A", least: "q1-A" }, key),
    ).toThrow());
  it("обязательны все 8 ситуаций", () => {
    const a = { ...correct };
    delete a.q8;
    expect(() => calculateScore("sjt", key, sjt, a)).toThrow("все вопросы");
  });
  it("порядок вариантов не влияет на расчёт", () =>
    expect(
      calculateScore(
        "sjt",
        key,
        sjt.map((q) => ({ ...q, options: [...q.options].reverse() })),
        correct,
      ).total,
    ).toBe(16));
  it("неизвестные ID не принимаются", () =>
    expect(() =>
      validateAnswer(sjt[0], { most: "q1-X", least: "q1-B" }, key),
    ).toThrow());
});
describe("Когнитивный расчёт и числовой ввод", () => {
  it.each(["", " ", "NaN", "Infinity", "3abc", "1e3", "25%"])(
    "отклоняет %j",
    (s) => expect(() => numericValue(s)).toThrow(),
  );
  it("поддерживает десятичную запятую", () =>
    expect(numericValue(" 2,5 ")).toBe(2.5));
  it("проверяет числовые ответы, не строки", () => {
    const qs: QuestionInput[] = [
      { id: "n", type: "number", text, options: [] },
    ];
    expect(
      calculateScore("cognitive", { items: { n: { correct: 25 } } }, qs, {
        n: "25,0",
      }).total,
    ).toBe(1);
    expect(
      calculateScore("cognitive", { items: { n: { correct: 25 } } }, qs, {
        n: 24,
      }).total,
    ).toBe(0);
  });
});
describe("Шкалы, обратное кодирование и пределы", () => {
  const questions: QuestionInput[] = ["a", "b", "c"].map((id) => ({
    id,
    type: "scale",
    text,
    options: [],
  }));
  const config: ScoringConfig = {
    min: 1,
    max: 5,
    items: {
      a: { scales: ["factor", "facet"] },
      b: { reverse: true, scales: ["factor", "facet"] },
      c: { scales: ["factor"] },
    },
    scales: {
      factor: { name: text, min: 1, max: 5 },
      facet: { name: text, min: 1, max: 5 },
    },
  };
  it("5 + (6−2) + 3 = 12, фактор 4; фасета 4.5", () => {
    const r = calculateScore("scales", config, questions, { a: 5, b: 2, c: 3 });
    expect(r.scales?.factor).toMatchObject({ sum: 12, mean: 4, count: 3 });
    expect(r.scales?.facet.mean).toBe(4.5);
    expect(r.total).toBeUndefined();
  });
  it.each([0, 6, 1.5])("не принимает %s вне пятибалльной шкалы", (v) =>
    expect(() => validateAnswer(questions[0], v, config)).toThrow(),
  );
  it("WMPS допускает 6, но не 7", () => {
    expect(validateAnswer(questions[0], 6, { ...config, max: 6 })).toBe(6);
    expect(() =>
      validateAnswer(questions[0], 7, { ...config, max: 6 }),
    ).toThrow();
  });
  it("проверяет дублирующиеся ID", () =>
    expect(() =>
      verifyScoringConfig(config, [questions[0], questions[0]]),
    ).toThrow());
});
describe("Поставляемые наборы данных", () => {
  const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
  it("6 направлений с двуязычными вопросами", () => {
    expect(catalog).toHaveLength(6);
    for (const method of catalog)
      for (const q of method.questions) {
        expect(q.text.ru).toBeTruthy();
        expect(q.text.kk).toBeTruthy();
      }
  });
  it("120 IPIP, 35 шкал и нейтральный ответ 3 → все средние 3", () => {
    const m = catalog.find((m: any) => m.id === "personality");
    expect(m.questions).toHaveLength(120);
    const r = calculateScore(
      m.algorithm,
      m.config,
      m.questions,
      Object.fromEntries(m.questions.map((q: any) => [q.id, 3])),
    );
    expect(Object.keys(r.scales!)).toHaveLength(35);
    for (const s of Object.values(r.scales!)) expect(s.mean).toBe(3);
  });
  it("WMPS: размеры шести шкал 4,2,5,3,4,2", () => {
    const m = catalog.find((m: any) => m.id === "motivation");
    expect(m.questions).toHaveLength(20);
    const r = calculateScore(
      m.algorithm,
      m.config,
      m.questions,
      Object.fromEntries(m.questions.map((q: any) => [q.id, 6])),
    );
    expect(Object.values(r.scales!).map((s) => s.count)).toEqual([
      4, 2, 5, 3, 4, 2,
    ]);
    for (const s of Object.values(r.scales!)) expect(s.mean).toBe(6);
  });
  it("BNT содержит четыре уникальные задачи отдельно от рядов AssessFlow", () => {
    const questions = catalog.find((m: any) => m.id === "numerical").questions;
    const bnt = questions.filter((question: any) =>
      /^bnt-[1-4]$/.test(question.id),
    );
    const numberSeries = questions.filter((question: any) =>
      /^af-series-\d{2}$/.test(question.id),
    );
    expect(bnt).toHaveLength(4);
    expect(new Set(bnt.map((question: any) => question.id)).size).toBe(4);
    expect(numberSeries).toHaveLength(48);
  });
});
