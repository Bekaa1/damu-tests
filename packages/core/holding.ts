import source from "../../data/holding-model-2026-11-21.json";

export const HOLDING_MODEL_VERSION = "holding-2026-11-21" as const;
export const HOLDING_SINGLE_CASE_NOTE = "один кейс — дополнительный источник; основная оценка — по упражнениям и интервью";
export type HoldingLabel = { ru: string; kk: string };
export type HoldingProfile = {
  profileRow: number; block: "ГО" | "РФ"; unit: string; position: string;
  targetLevelModel: "В"; criticality: Record<string, number>; targetScore: null;
};
export const HOLDING_COMPETENCIES = source.competencies;
export const HOLDING_PROFILES = source.profiles as HoldingProfile[];
export const HOLDING_SJT_CASES = source.sjtCases;
export const HOLDING_PROVENANCE = source.provenance;
export function holdingProfile(profileRow: number) {
  return HOLDING_PROFILES.find(p => p.profileRow === profileRow);
}
/** Additional-source SJT matching, never a 1–5 behavioral assessment. */
export function holdingSjtProfile(details: readonly { questionId: string; score?: number }[]) {
  const scores = new Map<string, number>();
  for (const d of details) if (!scores.has(d.questionId))
    scores.set(d.questionId, Number.isFinite(d.score) ? Math.max(0, Math.min(2, d.score!)) : 0);
  return HOLDING_COMPETENCIES.map(c => {
    const cases = HOLDING_SJT_CASES.filter(row => row.competencyCode === c.id);
    const showSeparate = ["C2", "C3", "C4", "C7"].includes(c.id);
    return {
      code: c.id, name: c.name,
      total: cases.reduce((sum, row) => sum + (scores.get(row.questionId) ?? 0), 0),
      maximum: cases.length * 2, caseCount: cases.length, showSeparate,
      ...(!showSeparate ? { note: HOLDING_SINGLE_CASE_NOTE } : {}),
    };
  });
}
