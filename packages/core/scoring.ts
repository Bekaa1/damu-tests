import { z } from "zod";

export const localized = z.object({
  ru: z.string().min(1),
  kk: z.string().min(1),
});
export const questionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["single", "number", "scale", "sjt", "image"]),
  text: localized,
  imageUrl: z.string().optional(),
  options: z
    .array(
      z.object({
        id: z.string(),
        text: localized,
        imageUrl: z.string().optional(),
      }),
    )
    .default([]),
});
export type QuestionInput = z.infer<typeof questionSchema>;
export type Answer = string | number | { most: string; least: string };
export type ScoringConfig = {
  items: Record<
    string,
    {
      correct?: string | number;
      tolerance?: number;
      most?: string;
      least?: string;
      reverse?: boolean;
      scales?: string[];
    }
  >;
  scales?: Record<
    string,
    { name: { ru: string; kk: string }; min: number; max: number }
  >;
  min?: number;
  max?: number;
};
export type Score = {
  algorithm: string;
  total?: number;
  maximum?: number;
  percent?: number;
  mostMatches?: number;
  leastMatches?: number;
  scales?: Record<
    string,
    {
      name: { ru: string; kk: string };
      sum: number;
      mean: number;
      count: number;
      min: number;
      max: number;
    }
  >;
  details: {
    questionId: string;
    value: Answer;
    score?: number;
    mostMatch?: boolean;
    leastMatch?: boolean;
  }[];
  interpretation: "raw_only" | "preliminary_matching_index";
};
export function numericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") throw new Error("Введите число");
  const s = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s))
    throw new Error("Введите число, используя точку или запятую");
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("Некорректное число");
  return n;
}
export function validateAnswer(
  question: Pick<QuestionInput, "id" | "type" | "options">,
  value: unknown,
  config: ScoringConfig,
): Answer {
  if (question.type === "sjt") {
    const pair = z
      .object({ most: z.string(), least: z.string() })
      .strict()
      .parse(value);
    if (pair.most === pair.least)
      throw new Error("MOST и LEAST должны отличаться");
    if (
      ![pair.most, pair.least].every((id) =>
        question.options.some((o) => o.id === id),
      )
    )
      throw new Error("Неизвестный вариант ответа");
    return pair;
  }
  if (question.type === "number") return numericValue(value);
  if (question.type === "scale") {
    const n = numericValue(value);
    if (!Number.isInteger(n) || n < (config.min ?? 1) || n > (config.max ?? 5))
      throw new Error("Ответ вне шкалы");
    return n;
  }
  if (
    typeof value !== "string" ||
    !question.options.some((o) => o.id === value)
  )
    throw new Error("Выберите вариант ответа");
  return value;
}
export function calculateScore(
  algorithm: string,
  config: ScoringConfig,
  questions: QuestionInput[],
  answers: Record<string, unknown>,
): Score {
  if (!questions.length) throw new Error("В методике отсутствуют вопросы");
  if (Object.keys(config.items).length !== questions.length)
    throw new Error("Ключ не соответствует составу вопросов");
  const details = questions.map((q) => {
    if (!(q.id in answers))
      throw new Error("Необходимо ответить на все вопросы");
    if (!config.items[q.id]) throw new Error("Для вопроса отсутствует ключ");
    return {
      questionId: q.id,
      value: validateAnswer(q, answers[q.id], config),
    };
  });
  if (algorithm === "sjt") {
    const scored = details.map((d) => {
      const key = config.items[d.questionId];
      const a = d.value as { most: string; least: string };
      if (!key.most || !key.least || key.most === key.least)
        throw new Error("Некорректный ключ SJT");
      return {
        ...d,
        mostMatch: a.most === key.most,
        leastMatch: a.least === key.least,
        score: Number(a.most === key.most) + Number(a.least === key.least),
      };
    });
    const total = scored.reduce((a, b) => a + b.score, 0),
      maximum = questions.length * 2;
    return {
      algorithm,
      total,
      maximum,
      percent: (100 * total) / maximum,
      mostMatches: scored.filter((d) => d.mostMatch).length,
      leastMatches: scored.filter((d) => d.leastMatch).length,
      details: scored,
      interpretation: "preliminary_matching_index",
    };
  }
  if (algorithm === "cognitive") {
    const scored = details.map((d) => {
      const key = config.items[d.questionId];
      if (key.correct === undefined)
        throw new Error("Отсутствует правильный ответ");
      const correct =
        typeof key.correct === "number"
          ? Math.abs(numericValue(d.value) - key.correct) <=
            (key.tolerance ?? 0)
          : d.value === key.correct;
      return { ...d, score: Number(correct) };
    });
    const total = scored.reduce((a, b) => a + b.score, 0);
    return {
      algorithm,
      total,
      maximum: questions.length,
      percent: (100 * total) / questions.length,
      details: scored,
      interpretation: "raw_only",
    };
  }
  if (algorithm === "scales") {
    const scales: NonNullable<Score["scales"]> = {};
    for (const [id, s] of Object.entries(config.scales ?? {}))
      scales[id] = { ...s, sum: 0, mean: 0, count: 0 };
    for (const d of details) {
      const key = config.items[d.questionId];
      let n = numericValue(d.value);
      if (key.reverse) n = (config.min ?? 1) + (config.max ?? 5) - n;
      if (!key.scales?.length) throw new Error("Не задана шкала вопроса");
      for (const id of key.scales) {
        if (!scales[id]) throw new Error("Неизвестная шкала");
        scales[id].sum += n;
        scales[id].count++;
      }
    }
    for (const s of Object.values(scales)) {
      if (!s.count) throw new Error("Пустая шкала");
      s.mean = s.sum / s.count;
    }
    return { algorithm, scales, details, interpretation: "raw_only" };
  }
  throw new Error("Неизвестный алгоритм");
}
export function verifyScoringConfig(
  config: ScoringConfig,
  questions: QuestionInput[],
) {
  if (new Set(questions.map((q) => q.id)).size !== questions.length)
    throw new Error("Повторяющиеся ID вопросов");
  for (const q of questions) {
    const k = config.items[q.id];
    if (!k) throw new Error(`Отсутствует ключ: ${q.id}`);
    if (new Set(q.options.map((o) => o.id)).size !== q.options.length)
      throw new Error("Повторяющиеся ID вариантов");
    for (const optionId of [
      k.most,
      k.least,
      typeof k.correct === "string" ? k.correct : undefined,
    ].filter(Boolean))
      if (!q.options.some((o) => o.id === optionId))
        throw new Error("Ключ ссылается на неизвестный вариант");
  }
}
