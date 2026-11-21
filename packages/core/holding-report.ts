import type { ReportPerson } from "./reporting";
import { invalidProfile } from "./report-policy";

export const HOLDING_PENDING_PANEL_RU = "Ключ не утверждён экспертной панелью";
/** Status is frozen from the exact referenced scoring-key row, not inferred
 * from a score's interpretation, the current test delivery or model approval. */
export function holdingPendingPanel(result: { scoringKeyStatus?: string } | undefined) {
  return result?.scoringKeyStatus === "preliminary";
}

const codes = Array.from({ length: 8 }, (_, i) => `C${i + 1}`);
/** Read only saved evidence. Never resolve an old profile number against the
 * current catalog, or turn missing observations into a score/status. */
export function frozenHoldingPositionReference(evidence: any) {
  const model = evidence?.model?.content;
  const roleId = evidence?.roleId || evidence?.consensus?.scores?.roleId;
  const profile = evidence?.profile || model?.roles?.find((r: any) => r.id === roleId);
  if (!profile || !Number.isInteger(profile.profileRow) || profile.profileRow < 1 || profile.profileRow > 65 ||
    profile.targetLevelModel !== "В" || profile.targetScore !== null ||
    typeof profile.unit !== "string" || typeof profile.position !== "string" ||
    codes.some(code => ![1, 2, 3].includes(profile.criticality?.[code]))) return null;
  const competencies = codes.map(code => model?.competencies?.find((c: any) => c.id === code));
  if (competencies.some(c => !c || typeof c.name?.ru !== "string" || !c.name.ru)) return null;
  return {
    profileRow: profile.profileRow as number,
    unit: profile.unit as string,
    position: profile.position as string,
    rows: competencies.map((c, i) => ({
      code: codes[i], name: { ...c.name }, criticality: profile.criticality[codes[i]] as number,
      targetLevelModel: "В" as const, targetScore: null,
      notObserved: evidence?.consensus?.scores?.ratings?.some((r: any) => r.competencyId === codes[i] && r.notObserved === true && r.value === null) === true,
    })),
  };
}
export type HoldingPositionReference = NonNullable<ReturnType<typeof frozenHoldingPositionReference>>;

/** A reference partition can itself disclose a singleton's position. Withhold
 * the whole partition if any distinct eligible person is unknown or in n<5.
 * No observations or per-person status are emitted in team references. */
export function teamHoldingPositionReferences(people: ReportPerson[]): HoldingPositionReference[] {
  const valid = people.filter((p, i) => p.status === "completed" && !invalidProfile(p) && people.findIndex(x => x.id === p.id) === i);
  if (valid.length < 5) return [];
  const groups = new Map<string, { reference: HoldingPositionReference; count: number }>();
  for (const person of valid) {
    const reference = frozenHoldingPositionReference(person.competencyProfile);
    if (!reference) return [];
    const publicReference = { ...reference, rows: reference.rows.map(r => ({ ...r, notObserved: false })) };
    const key = JSON.stringify(publicReference);
    const group = groups.get(key) || { reference: publicReference, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()].some(g => g.count < 5) ? [] : [...groups.values()].map(g => g.reference);
}
