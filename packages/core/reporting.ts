import { z } from "zod";
export { REPORT_PROMPT, reportAiInput } from "./report-input";

export type ReportLanguage = "ru" | "kk";
export type ReportPerson = {
  competencyProfile?: any;
  id: string;
  name: string;
  position: string;
  unit: string;
  category: string;
  status: string;
  completed: number;
  total: number;
  results: {
    resultId?: string;
    testId: string;
    testVersionId: string;
    version: string;
    scoringKeyId?: string;
    language?: string;
    name: any;
    score: any;
  }[];
  observations: {
    expertId?: string;
    exerciseId?: string;
    indicatorExamples?: any;
    id: string;
    criteriaSnapshot: any;
    scores: any;
    notes: string;
    createdAt: string;
  }[];
  expert: {
    status: string;
    matrixX: number | null;
    matrixY: number | null;
    matrixReason: string | null;
    content: any;
  } | null;
};
export type ReportSnapshot = {
  organization: { name: string; matrixConfig: any };
  campaign: { id: string; name: string };
  people: ReportPerson[];
};
export type ReportMetric = {
  id: string;
  key: string;
  name: string;
  method: string;
  testId: string;
  version: string;
  language: string;
  scale: string;
  min: number;
  max: number;
  mean: number;
  n: number;
  low: number;
  high: number;
  units: { name: string; mean: number; n: number }[];
};
export const reportLoc = (v: any, language: ReportLanguage) =>
  typeof v === "string" ? v : v?.[language] || v?.ru || "";

// Keep different forms, scoring versions, languages and scale ranges separate.
// "Not observed" is missing evidence, never a zero score.
export function reportMetrics(
  snapshot: ReportSnapshot,
  language: ReportLanguage,
): ReportMetric[] {
  const groups = new Map<
    string,
    {
      metric: Omit<
        ReportMetric,
        "id" | "mean" | "n" | "low" | "high" | "units"
      >;
      values: { person: string; unit: string; value: number }[];
    }
  >();
  const add = (
    person: ReportPerson,
    key: string,
    meta: Omit<
      ReportMetric,
      "id" | "key" | "mean" | "n" | "low" | "high" | "units"
    >,
    value: unknown,
  ) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < meta.min ||
      value > meta.max ||
      meta.max <= meta.min
    )
      return;
    const group = groups.get(key) || { metric: { ...meta, key }, values: [] };
    if (!group.values.some((v) => v.person === person.id))
      group.values.push({ person: person.id, unit: person.unit, value });
    groups.set(key, group);
  };
  for (const person of snapshot.people) {
    for (const result of person.results) {
      const score = result.score;
      if (!score || score.reviewRequired) continue;
      const base = [result.testVersionId, result.scoringKeyId, result.language];
      const method = reportLoc(result.name, language);
      const meta = {
        method,
        testId: score.algorithm === "sjt" ? "sjt" : result.testId,
        version: result.version,
        language: result.language || "ru",
      };
      if (score.scales) {
        for (const [id, scale] of Object.entries(score.scales) as [
          string,
          any,
        ][]) {
          add(
            person,
            JSON.stringify([...base, id, scale.min, scale.max]),
            {
              ...meta,
              name: reportLoc(scale.name, language),
              scale: id,
              min: scale.min,
              max: scale.max,
            },
            scale.mean,
          );
        }
      } else {
        add(
          person,
          JSON.stringify([...base, "total", score.maximum]),
          {
            ...meta,
            name: method,
            scale: "total",
            min:
              score.interpretation === "effectiveness_gap" ? -score.maximum : 0,
            max: score.maximum,
          },
          score.total,
        );
      }
    }
    const profile = person.competencyProfile;
    if (profile?.consensus) {
      for (const rating of profile.consensus.scores.ratings) {
        const c = profile.model.content.competencies.find(
          (c: any) => c.id === rating.competencyId,
        );
        if (c)
          add(
            person,
            JSON.stringify(["consensus", profile.model.id, c.id]),
            {
              name: reportLoc(c.name, language),
              method:
                language === "ru"
                  ? "Итоговые компетенции"
                  : "Қорытынды құзыреттер",
              testId: "expert",
              version: String(profile.model.version),
              language,
              scale: c.id,
              min: 1,
              max: 5,
            },
            rating.value,
          );
      }
    }
    for (const observation of profile ? [] : person.observations) {
      const exercise = observation.criteriaSnapshot;
      for (const criterion of exercise.criteria || []) {
        const values = (criterion.scale || []).map((s: any) => s.value);
        if (!values.length) continue;
        const min = Math.min(...values),
          max = Math.max(...values);
        const key = JSON.stringify([
          "expert",
          exercise.type,
          exercise.name,
          criterion.id,
          criterion.name,
          criterion.scale,
        ]);
        add(
          person,
          key,
          {
            name: reportLoc(criterion.name, language),
            method: reportLoc(exercise.name, language),
            testId: "expert",
            version: "",
            language,
            scale: criterion.id,
            min,
            max,
          },
          observation.scores[criterion.id],
        );
      }
    }
  }
  const mean = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / values.length;
  return [...groups.values()].map(({ metric, values }, index) => ({
    ...metric,
    id: "metric-" + (index + 1),
    mean: mean(values.map((v) => v.value)),
    n: values.length,
    low: Math.min(...values.map((v) => v.value)),
    high: Math.max(...values.map((v) => v.value)),
    units: [...new Set(values.map((v) => v.unit))].map((name) => {
      const group = values.filter((v) => v.unit === name);
      return { name, n: group.length, mean: mean(group.map((v) => v.value)) };
    }),
  }));
}

const statement = z
  .object({
    text: z.string().min(1).max(3500),
    evidenceIds: z.array(z.string()).min(1).max(20),
  })
  .strict();
const statements = z.array(statement).max(8);
export const generatedContentSchema = z
  .object({
    summary: statements.min(1),
    analytical: statements,
    personality: statements,
    motivation: statements,
    management: statements,
    competencies: statements,
    potential: statements,
    strengths: statements,
    development: statements,
    risks: statements,
    recommendations: statements.min(1),
    developmentPlan: z
      .array(
        z
          .object({
            focus: z.string().min(1).max(500),
            action: z.string().min(1).max(1500),
            format: z.string().min(1).max(500),
            timeframe: z.string().min(1).max(500),
            success: z.string().min(1).max(700),
            evidenceIds: z.array(z.string()).min(1).max(20),
          })
          .strict(),
      )
      .min(0)
      .max(6),
    limitations: z.array(z.string().min(1).max(1500)).max(8),
  })
  .strict();
export type GeneratedContent = z.infer<typeof generatedContentSchema>;
export const REPORT_PROMPT_VERSION = "reports-2.0-20261117";
export function validateReportEvidence(
  content: GeneratedContent,
  evidence: Set<string>,
) {
  for (const [key, entries] of Object.entries(content)) {
    if (key === "limitations") continue;
    for (const entry of entries as { evidenceIds: string[] }[]) {
      if (!entry.evidenceIds.every((id) => evidence.has(id)))
        throw new Error("Report references unknown evidence");
    }
  }
}
