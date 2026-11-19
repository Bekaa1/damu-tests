import { z } from "zod";
import { responseQuality } from "./response-quality";

export const localized = z.object({
  ru: z.string().min(1),
  kk: z.string().min(1),
});
export const questionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["single", "number", "scale", "sjt", "image", "ranking"]),
  content: z.record(z.string(), z.any()).optional(),
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
export type Answer =
  | string
  | number
  | { most: string; least: string }
  | { top: string[]; bottom: string[] };
export type ScoringConfig = {
  mode?: "effectiveness";
  calibration?: unknown;
  items: Record<
    string,
    {
      correct?: string | number;
      tolerance?: number;
      most?: string;
      least?: string;
      reverse?: boolean;
      scales?: string[];
      control?: string;
      ranking?: boolean;
      competency?: { ru: string; kk: string };
      effectiveness?: Record<string, number>;
    }
  >;
  scales?: Record<
    string,
    { name: { ru: string; kk: string }; min: number; max: number }
  >;
  min?: number;
  max?: number;
  bands?: number[];
  invertScales?: string[];
  quality?: string;
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
    maximum?: number;
    mostMatch?: boolean;
    leastMatch?: boolean;
  }[];
  interpretation:
    "raw_only" | "preliminary_matching_index" | "effectiveness_gap";
  answered?: number;
  accuracy?: number;
  level?: number;
  elapsedSeconds?: number;
  qualityFlags?: string[];
  responseQuality?: ReturnType<typeof responseQuality>;
  reviewRequired?: boolean;
  motivation?: {
    baseline: number;
    profile: Record<
      string,
      { relative: number; priority: number; adjusted: number }
    >;
    top: string[];
    demotivators: string[];
    demotivatorTexts?: { ru: string; kk: string }[];
  };
  competencies?: Record<
    string,
    { name: { ru: string; kk: string }; total: number; maximum: number }
  >;
};

/** Compare JSON-shaped scoring values without depending on object key order. */
export function sameJsonValue(left: unknown, right: unknown): boolean {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, canonicalize(entry)]),
      );
    }
    return value;
  };
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}
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
  if (question.type === "ranking") {
    const a = z
      .object({
        top: z.array(z.string()).max(3),
        bottom: z.array(z.string()).max(3),
      })
      .strict()
      .parse(value);
    const ids = [...a.top, ...a.bottom];
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !question.options.some((o) => o.id === id))
    )
      throw Error("Выберите разные факторы в каждой группе");
    return a;
  }
  if (question.type === "sjt") {
    const pair = z
      .object({ most: z.string().default(""), least: z.string().default("") })
      .strict()
      .parse(value);
    if (pair.most && pair.most === pair.least)
      throw new Error("MOST и LEAST должны отличаться");
    if (
      ![pair.most, pair.least].every(
        (id) => !id || question.options.some((o) => o.id === id),
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
function baseScore(
  algorithm: string,
  config: ScoringConfig,
  questions: QuestionInput[],
  answers: Record<string, unknown>,
  allowMissing = false,
): Score {
  if (!questions.length) throw new Error("В методике отсутствуют вопросы");
  if (Object.keys(config.items).length !== questions.length)
    throw new Error("Ключ не соответствует составу вопросов");
  const details = questions.map((q) => {
    if (!(q.id in answers) && !allowMissing)
      throw new Error("Необходимо ответить на все вопросы");
    if (!config.items[q.id]) throw new Error("Для вопроса отсутствует ключ");
    return {
      questionId: q.id,
      value:
        q.id in answers
          ? validateAnswer(q, answers[q.id], config)
          : (null as any),
    };
  });
  if (algorithm === "sjt") {
    if (config.mode === "effectiveness") {
      let maximum = 0;
      const scored = details.map((d) => {
        const ratings = config.items[d.questionId].effectiveness;
        const q = questions.find((q) => q.id === d.questionId)!;
        if (
          !ratings ||
          Object.keys(ratings).length !== q.options.length ||
          q.options.some(
            (o) =>
              !Number.isFinite(ratings[o.id]) ||
              ratings[o.id] < 1 ||
              ratings[o.id] > 5,
          )
        )
          throw Error("Не утверждены оценки эффективности всех вариантов");
        const values = Object.values(ratings),
          ideal = Math.max(...values) - Math.min(...values);
        if (ideal <= 0) throw Error("Оценки эффективности не различаются");
        maximum += ideal;
        const a = d.value as { most?: string; least?: string } | null;
        return {
          ...d,
          maximum: ideal,
          score: a?.most && a?.least ? ratings[a.most] - ratings[a.least] : 0,
        };
      });
      const total = scored.reduce((sum, d) => sum + d.score, 0);
      return {
        algorithm,
        total,
        maximum,
        percent: (100 * total) / maximum,
        details: scored,
        interpretation: "effectiveness_gap",
      };
    }
    const scored = details.map((d) => {
      const key = config.items[d.questionId];
      const a = (d.value || { most: "", least: "" }) as {
        most: string;
        least: string;
      };
      if (!allowMissing && (!a.most || !a.least))
        throw Error("Ответьте на все вопросы");
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
        d.value !== null && typeof key.correct === "number"
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
      if (d.value === null) continue;
      const key = config.items[d.questionId];
      let n = d.value === null ? 0 : numericValue(d.value);
      if (key.reverse && d.value !== null)
        n = (config.min ?? 1) + (config.max ?? 5) - n;
      if (!key.scales?.length) throw new Error("Не задана шкала вопроса");
      for (const id of key.scales) {
        if (!scales[id]) throw new Error("Неизвестная шкала");
        scales[id].sum += n;
        scales[id].count++;
      }
    }
    for (const [id, s] of Object.entries(scales)) {
      if (!s.count) {
        delete scales[id];
        continue;
      }
      s.mean = s.sum / s.count;
    }
    return { algorithm, scales, details, interpretation: "raw_only" };
  }
  throw new Error("Неизвестный алгоритм");
}
export function calculateScore(
  algorithm: string,
  config: ScoringConfig,
  questions: QuestionInput[],
  answers: Record<string, unknown>,
  options: {
    allowMissing?: boolean;
    durations?: Record<string, number>;
    elapsedMs?: number;
  } = {},
): Score {
  // Controls and the priority task are required, but never enter scale sums.
  for (const q of questions)
    if (config.items[q.id]?.control || config.items[q.id]?.ranking) {
      if (!(q.id in answers)) {
        if (options.allowMissing) continue;
        throw Error("Необходимо ответить на все вопросы");
      }
      const a = validateAnswer(q, answers[q.id], config) as any;
      if (
        !options.allowMissing &&
        q.type === "ranking" &&
        (a.top.length !== 3 || a.bottom.length !== 3)
      )
        throw Error("Выберите три наиболее и три наименее важных фактора");
    }
  const scored = questions.filter(
    (q) => !config.items[q.id]?.control && !config.items[q.id]?.ranking,
  );
  const result = baseScore(
    algorithm,
    {
      ...config,
      items: Object.fromEntries(scored.map((q) => [q.id, config.items[q.id]])),
    },
    scored,
    answers,
    options.allowMissing,
  );
  if (options.elapsedMs !== undefined)
    result.elapsedSeconds = Math.max(0, options.elapsedMs / 1000);
  if (algorithm !== "scales" && options.durations) {
    const times = Object.values(options.durations);
    const flags: string[] = [];
    const id = questions[0].id;
    if (id.startsWith("numerical-v2") && times.some((n) => n < 10000))
      flags.push("fast_answers");
    if (id.startsWith("verbal-v2")) {
      const answered = result.details.filter((d) => d.value !== null).length;
      if (
        answered < 20 &&
        answered > 0 &&
        (100 * result.total!) / answered > 80
      )
        flags.push("slow_precise");
      if (
        times.length &&
        times.reduce((a, b) => a + b, 0) / times.length < 10000
      )
        flags.push("fast_answers");
      if (
        result.details.filter(
          (d) =>
            config.items[d.questionId].correct?.toString().endsWith("-C") &&
            d.value?.toString().endsWith("-A"),
        ).length > 5
      )
        flags.push("unsupported_inferences");
    }
    if (id.startsWith("logical-v2")) {
      if (times.filter((n) => n < 5000).length > 5) flags.push("fast_answers");
      const positions = questions
        .filter((q) => answers[q.id] !== undefined)
        .map((q) => q.options.findIndex((o) => o.id === answers[q.id]));
      if (
        positions.length === questions.length &&
        new Set(positions).size === 1
      )
        flags.push("same_position");
    }
    if (
      algorithm === "sjt" &&
      ((options.elapsedMs !== undefined && options.elapsedMs < 360000) ||
        times.filter((n) => n < 20000).length > 4)
    )
      flags.push("fast_answers");
    result.qualityFlags = flags;
  }
  result.answered = scored.filter(
    (q) =>
      answers[q.id] !== undefined &&
      (q.type !== "sjt" ||
        ((answers[q.id] as any).most && (answers[q.id] as any).least)),
  ).length;
  if (result.total !== undefined) {
    result.accuracy = result.answered
      ? (100 * result.total) / result.answered
      : 0;
    if (config.mode === "effectiveness") {
      const p = result.percent!;
      result.level = p < 40 ? 1 : p < 55 ? 2 : p < 70 ? 3 : p < 85 ? 4 : 5;
    } else if (config.bands)
      result.level = config.bands.findIndex((x) => result.total! <= x) + 1;
  }
  if (algorithm === "sjt") {
    result.competencies = {};
    for (const d of result.details) {
      const name = config.items[d.questionId].competency;
      if (name) {
        const c = (result.competencies[name.ru] ??= {
          name,
          total: 0,
          maximum: 0,
        });
        c.total += d.score!;
        const values = Object.values(
          config.items[d.questionId].effectiveness || {},
        );
        c.maximum +=
          config.mode === "effectiveness"
            ? Math.max(...values) - Math.min(...values)
            : 2;
      }
    }
  }
  if (result.scales) {
    for (const id of config.invertScales ?? []) {
      const s = result.scales[id];
      if (s) {
        s.sum = s.count * ((config.min ?? 1) + (config.max ?? 5)) - s.sum;
        s.mean = s.sum / s.count;
      }
    }
    const flags: string[] = [];
    const vals = questions
      .filter((q) => q.type === "scale" && answers[q.id] !== undefined)
      .map((q) => Number(answers[q.id]));
    let maxRun = 0,
      run = 0,
      prev: number | undefined;
    for (const n of vals) {
      run = n === prev ? run + 1 : 1;
      maxRun = Math.max(maxRun, run);
      prev = n;
    }
    if (maxRun >= 10) flags.push("straightlining");
    if (
      options.durations &&
      Object.values(options.durations).reduce((a, b) => a + b, 0) /
        vals.length <
        2000
    )
      flags.push("too_fast");
    if (config.quality === "personality") {
      const a = (n: string | number) => Number(answers["personality-v2-" + n]);
      if (
        (answers["personality-v2-К1"] !== undefined && a("К1") !== 2) ||
        (answers["personality-v2-К2"] !== undefined && a("К2") !== 4)
      )
        flags.push("attention");
      if (["К3", "К4", "К5", "К6"].filter((n) => a(n) >= 4).length >= 3)
        flags.push("social_desirability");
      if (
        [
          [15, 105],
          [4, 94],
          [6, 96],
          [2, 62],
          [12, 102],
        ].filter(([x, y]) => a(x) >= 4 && a(y) >= 4).length >= 3
      )
        flags.push("contradictions");
      result.reviewRequired = flags.length >= 2;
    }
    if (
      config.quality === "motivation" &&
      Object.keys(result.scales).length === 12
    ) {
      const scales = result.scales;
      const baseline =
        Object.values(scales).reduce((s, x) => s + x.mean, 0) / 12;
      const rank = (answers[
        questions.find((q) => q.type === "ranking")!.id
      ] || { top: [], bottom: [] }) as {
        top: string[];
        bottom: string[];
      };
      const profile = Object.fromEntries(
        Object.entries(scales).map(([id, s]) => {
          const priority = rank.top.includes(id)
            ? 1
            : rank.bottom.includes(id)
              ? -1
              : 0;
          return [
            id,
            {
              relative: s.mean - baseline,
              priority,
              adjusted: s.mean - baseline + 0.5 * priority,
            },
          ];
        }),
      );
      const sorted = Object.keys(scales).sort(
        (a, b) =>
          profile[b].adjusted - profile[a].adjusted ||
          profile[b].priority - profile[a].priority ||
          a.localeCompare(b),
      );
      const cutoff = profile[sorted[2]].adjusted;
      result.motivation = {
        baseline,
        profile,
        top: sorted.filter((id) => profile[id].adjusted >= cutoff),
        demotivators: scored
          .filter((q) => config.items[q.id].reverse && answers[q.id] === 1)
          .map((q) => q.id),
        demotivatorTexts: scored
          .filter((q) => config.items[q.id].reverse && answers[q.id] === 1)
          .map((q) => q.text),
      };
      const means = Object.values(scales).map((s) => s.mean);
      if (Math.max(...means) - Math.min(...means) < 1 || baseline > 4.5)
        flags.push("flat_profile");
      if (rank.top.some((id) => scales[id].mean < 3))
        flags.push("ranking_mismatch");
      if (
        Object.keys(scales).filter((id) =>
          scored
            .filter((q) => config.items[q.id].scales?.includes(id))
            .every((q) => Number(answers[q.id]) >= 4),
        ).length >= 3
      )
        flags.push("contradictions");
    }
    result.qualityFlags = flags;
  }
  const quality = responseQuality(questions, answers, options.durations);
  result.responseQuality = quality;
  const qualityFlags = new Set(
    (result.qualityFlags || []).filter(
      (f) => !["too_fast", "straightlining"].includes(f),
    ),
  );
  if (quality.fastAnswers) qualityFlags.add("too_fast");
  if (quality.longestRun >= quality.runThreshold)
    qualityFlags.add("straightlining");
  result.qualityFlags = [...qualityFlags];
  if (config.quality === "personality")
    result.reviewRequired = qualityFlags.size >= 2;
  return result;
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
    if (
      config.mode === "effectiveness" &&
      (!k.effectiveness ||
        Object.keys(k.effectiveness).length !== q.options.length ||
        q.options.some(
          (o) =>
            !Number.isFinite(k.effectiveness![o.id]) ||
            k.effectiveness![o.id] < 1 ||
            k.effectiveness![o.id] > 5,
        ))
    )
      throw Error("Не заданы экспертные оценки эффективности вариантов");
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
