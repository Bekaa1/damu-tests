import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  calculateScore,
  verifyScoringConfig,
  validateAnswer,
} from "../packages/core/scoring";
const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
const form = (id: string) => catalog.find((x: any) => x.id === id);
const neutral = (m: any) =>
  Object.fromEntries(
    m.questions.map((q: any) => [
      q.id,
      q.type === "ranking"
        ? {
            top: q.options.slice(0, 3).map((x: any) => x.id),
            bottom: q.options.slice(3, 6).map((x: any) => x.id),
          }
        : m.config.items[q.id].control === "К1"
          ? 2
          : m.config.items[q.id].control === "К2"
            ? 4
            : 3,
    ]),
  );
describe("Новые формы заказчика 26.10.2026", () => {
  it("содержат правильные объёмы, лимиты и тренировки", () => {
    expect(catalog).toHaveLength(6);
    for (const [id, count, seconds, practice] of [
      ["verbal", 30, 1320, 2],
      ["numerical", 18, 1500, 2],
      ["logical", 24, 1200, 2],
      ["personality", 126, null, 0],
      ["motivation", 49, null, 0],
      ["situations", 14, 1800, 1],
    ] as const) {
      const m = form(id);
      expect(m.questions).toHaveLength(count);
      expect(m.timeLimitSeconds).toBe(seconds);
      expect(m.delivery.practice).toHaveLength(practice);
      verifyScoringConfig(m.config, m.questions);
    }
  });
  it("вербальный ключ 10 A, 10 B, 10 C, пропуск равен нулю", () => {
    const m = form("verbal");
    for (const letter of ["A", "B", "C"])
      expect(
        Object.values(m.config.items).filter((x: any) =>
          x.correct.endsWith("-" + letter),
        ),
      ).toHaveLength(10);
    const r = calculateScore(
      m.algorithm,
      m.config,
      m.questions,
      { "verbal-v2-1": "verbal-v2-1-A" },
      { allowMissing: true },
    );
    expect(r.total).toBe(1);
    expect(r.maximum).toBe(30);
    expect(r.answered).toBe(1);
    expect(r.accuracy).toBe(100);
  });
  it("числовые ответы сверены независимо по таблице документа", () => {
    const m = form("numerical");
    const key = [
      "C",
      "A",
      "E",
      "B",
      "D",
      "A",
      "C",
      "E",
      "B",
      "D",
      "A",
      "C",
      "B",
      "E",
      "D",
      "A",
      "C",
      "B",
    ];
    const a = Object.fromEntries(
      key.map((k, i) => [
        `numerical-v2-${i + 1}`,
        `numerical-v2-${i + 1}-${k}`,
      ]),
    );
    expect(calculateScore(m.algorithm, m.config, m.questions, a)).toMatchObject(
      { total: 18, maximum: 18, level: 5 },
    );
    expect(
      calculateScore(
        m.algorithm,
        m.config,
        m.questions,
        {},
        { allowMissing: true },
      ),
    ).toMatchObject({ total: 0, maximum: 18, accuracy: 0 });
  });
  it("SJT 14 кейсов, 28 баллов, частичный выбор засчитывается", () => {
    const m = form("situations");
    const letters = [
      "BD",
      "DA",
      "AC",
      "CB",
      "DA",
      "BD",
      "AC",
      "CA",
      "BD",
      "DB",
      "AC",
      "CB",
      "BD",
      "DB",
    ];
    const a = Object.fromEntries(
      letters.map((p, i) => [
        `situations-v2-${i + 1}`,
        {
          most: `situations-v2-${i + 1}-${p[0]}`,
          least: `situations-v2-${i + 1}-${p[1]}`,
        },
      ]),
    );
    expect(calculateScore(m.algorithm, m.config, m.questions, a)).toMatchObject(
      { total: 28, mostMatches: 14, leastMatches: 14 },
    );
    expect(
      calculateScore(
        m.algorithm,
        m.config,
        m.questions,
        { "situations-v2-1": { most: "situations-v2-1-B" } },
        { allowMissing: true },
      ).total,
    ).toBe(1);
  });
  it("личностные контролы исключены, N развёрнут, другие шкалы не меняются", () => {
    const m = form("personality"),
      a = neutral(m);
    let r = calculateScore(m.algorithm, m.config, m.questions, a);
    expect(Object.keys(r.scales!)).toHaveLength(35);
    expect(r.scales!.N).toMatchObject({ count: 24, sum: 72, mean: 3 });
    expect(r.scales!.N3.count).toBe(4);
    a["personality-v2-1"] = 5;
    r = calculateScore(m.algorithm, m.config, m.questions, a);
    expect(r.scales!.N.sum).toBe(70);
    expect(r.scales!.N1.sum).toBe(14);
    a["personality-v2-К3"] = 5;
    expect(
      calculateScore(m.algorithm, m.config, m.questions, a).scales!.N.sum,
    ).toBe(70);
  });
  it("два флага отправляют личностный профиль на проверку", () => {
    const m = form("personality"),
      a = neutral(m);
    a["personality-v2-К1"] = 1;
    const r = calculateScore(m.algorithm, m.config, m.questions, a);
    expect(r.qualityFlags).toContain("attention");
    expect(r.qualityFlags).toContain("straightlining");
    expect(r.reviewRequired).toBe(true);
  });
  it("мотивация: 12 шкал, обратное кодирование, поправка приоритетов", () => {
    const m = form("motivation"),
      a = neutral(m);
    a["motivation-v2-31"] = 1;
    const r = calculateScore(m.algorithm, m.config, m.questions, a);
    expect(Object.keys(r.scales!)).toHaveLength(12);
    expect(Object.values(r.scales!).every((s) => s.count === 4)).toBe(true);
    expect(r.scales!["ДОС"].mean).toBe(3.5);
    expect(r.motivation!.demotivators).toContain("motivation-v2-31");
    expect(r.motivation!.profile["ДОС"].adjusted).toBeCloseTo(
      3.5 - r.motivation!.baseline + 0.5,
    );
  });
  it("приоритеты сохраняются черновиком, финальный расчёт требует 3+3 без пересечений", () => {
    const m = form("motivation"),
      q = m.questions.at(-1),
      a = neutral(m);
    expect(validateAnswer(q, { top: [], bottom: [] }, m.config)).toBeTruthy();
    a[q.id] = { top: [], bottom: [] };
    expect(() =>
      calculateScore(m.algorithm, m.config, m.questions, a),
    ).toThrow();
    expect(() =>
      validateAnswer(q, { top: ["ДОС"], bottom: ["ДОС"] }, m.config),
    ).toThrow();
  });
  it("OMIB: 24 уникальных матрицы, сложность возрастает, варианты не повторяются", () => {
    const m = form("logical");
    expect(
      new Set(m.questions.map((q: any) => q.content.sourceItem)).size,
    ).toBe(24);
    m.questions.forEach((q: any, i: number) => {
      expect(q.options).toHaveLength(6);
      expect(q.options.every((o:any)=>/-option-[a-f0-9]{16}\.svg$/.test(o.imageUrl))).toBe(true);
      expect(new Set(q.options.map((o:any)=>o.text.ru)).size).toBe(1);
      expect(q.content.a).toBeGreaterThanOrEqual(0.8);
      if (i)
        expect(q.content.b).toBeGreaterThanOrEqual(
          m.questions[i - 1].content.b,
        );
      expect(q.content.sourceItem).not.toBe(7);
    });
    const a = Object.fromEntries(
      m.questions.map((q: any) => [q.id, m.config.items[q.id].correct]),
    );
    expect(calculateScore(m.algorithm, m.config, m.questions, a).total).toBe(
      24,
    );
  });
  it("RU/KK тексты заполнены, числовые условия сохранены", () => {
    function check(v: any) {
      if (!v || typeof v !== "object") return;
      if (typeof v.ru === "string" && typeof v.kk === "string") {
        expect(v.kk.trim()).toBeTruthy();
        const digits = (s: string) => s.match(/\d+(?:[.,]\d+)?/g) || [];
        expect(
          v.ru.includes(" | ") ? digits(v.kk) : digits(v.kk).sort(),
          v.ru,
        ).toEqual(v.ru.includes(" | ") ? digits(v.ru) : digits(v.ru).sort());
        return;
      }
      Object.values(v).forEach(check);
    }
    catalog.forEach(check);
  });
});
