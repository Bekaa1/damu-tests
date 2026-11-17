import { z } from "zod";
import type { QuestionInput, ScoringConfig } from "./scoring";
import { DEFAULT_COMPETENCIES } from "./competencies";
export const panelSchema = z
  .object({
    approvedBy: z.string().trim().min(3),
    experts: z.array(z.string().trim().min(2)).min(5).max(7),
    cases: z.record(
      z.string(),
      z
        .object({
          competencyId: z.string().min(1),
          options: z.record(
            z.string(),
            z.array(z.number().int().min(1).max(5)),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export function compileEffectivenessKey(
  questions: QuestionInput[],
  input: unknown,
): ScoringConfig {
  const panel = panelSchema.parse(input);
  if (new Set(panel.experts).size !== panel.experts.length)
    throw Error("Эксперты панели должны быть разными");
  if (questions.length !== 16 || Object.keys(panel.cases).length !== 16)
    throw Error("Для новой формы нужны 16 ситуаций");
  const counts = new Map<string, number>();
  const items: ScoringConfig["items"] = {};
  for (const q of questions) {
    const row = panel.cases[q.id];
    if (!row || Object.keys(row.options).length !== q.options.length)
      throw Error("Оцените каждый вариант каждой ситуации");
    const competency = DEFAULT_COMPETENCIES.competencies.find(
      (c) => c.id === row.competencyId,
    );
    if (!competency) throw Error("Указана неизвестная компетенция");
    counts.set(row.competencyId, (counts.get(row.competencyId) || 0) + 1);
    const effectiveness: Record<string, number> = {};
    for (const option of q.options) {
      const ratings = row.options[option.id];
      if (!ratings || ratings.length !== panel.experts.length)
        throw Error("Каждый вариант оценивает вся панель из 5–7 экспертов");
      const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      const sd = Math.sqrt(
        ratings.reduce((sum, n) => sum + (n - mean) ** 2, 0) / ratings.length,
      );
      if (sd > 1.5)
        throw Error(
          `Переработайте вариант ${option.id}: стандартное отклонение больше 1,5`,
        );
      effectiveness[option.id] = Math.round(mean * 10) / 10;
    }
    if (
      Math.max(...Object.values(effectiveness)) ===
      Math.min(...Object.values(effectiveness))
    )
      throw Error("Варианты должны различаться по эффективности");
    items[q.id] = { effectiveness, competency: competency.name };
  }
  if (counts.size !== 8 || [...counts.values()].some((n) => n < 2))
    throw Error("Каждая из 8 компетенций должна иметь минимум две ситуации");
  return { mode: "effectiveness", items, calibration: panel };
}
export function verifyEffectivenessCalibration(
  questions: QuestionInput[],
  config: ScoringConfig,
) {
  if (config.mode !== "effectiveness") return;
  const expected = compileEffectivenessKey(questions, config.calibration);
  for (const q of questions)
    for (const o of q.options)
      if (
        config.items[q.id]?.effectiveness?.[o.id] !==
        expected.items[q.id].effectiveness?.[o.id]
      )
        throw Error("Ключ не соответствует оценкам экспертной панели");
  for (const q of questions)
    if (
      config.items[q.id]?.competency?.ru !==
        expected.items[q.id].competency?.ru ||
      config.items[q.id]?.competency?.kk !== expected.items[q.id].competency?.kk
    )
      throw Error("Связи компетенций не соответствуют экспертной панели");
}
