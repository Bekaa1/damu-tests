import { usableScore } from "./result-validity";

export const MIN_ANALYTICAL_GROUP = 5;
const GROUPINGS = ["unit", "position", "category"] as const;
type Grouping = typeof GROUPINGS[number];
type Row = { id: string; role?: string; unit?: string; position?: string; category?: string; status?: string; results?: any[] };
type Group = { label: string; count: number; completed: number; percent: number };
type Method = { id: string; name: unknown; n: number; score: { total?: number; maximum?: number; scales?: Record<string, any> } };
type Cohort = Set<string>;

/** Every distinguishable intersection/difference of visible cohorts must be >=5.
 * The all-zero cell is not disclosed: do not invent a denominator for people
 * outside every retained cohort. A visible overall cohort includes that cell.
 */
function safeCohorts(people: readonly Row[], cohorts: readonly Cohort[]) {
  const cells = new Map<string, number>();
  for (const person of people) {
    const signature = cohorts.map((members) => members.has(person.id) ? "1" : "0").join("");
    if (!signature.includes("1")) continue;
    cells.set(signature, (cells.get(signature) || 0) + 1);
  }
  return [...cells.values()].every((n) => n >= MIN_ANALYTICAL_GROUP);
}
const sameCohort = (a: Cohort, b: Cohort) => a.size === b.size && [...a].every((id) => b.has(id));

/** Aggregate-only disclosure, planned across ALL modes before selecting one.
 * Unsafe overlapping families are withheld, never zero-filled or re-denominated.
 * Method cohorts take precedence; grouping cannot reintroduce their complement.
 */
export function privateAnalytics(rows: readonly Row[], grouping: Grouping) {
  const people = [...new Map(rows.filter((p) => p.role === "employee").map((p) => [p.id, p])).values()];
  let suppressed = false, complementarySuppressed = false;
  let groupCandidates: { grouping: Grouping; members: Cohort; value: Group }[] = [];
  for (const mode of GROUPINGS) {
    const buckets = new Map<string, Row[]>();
    for (const person of people) {
      const label = String(person[mode] || "").trim() || "Не указано";
      buckets.set(label, [...(buckets.get(label) || []), person]);
    }
    for (const [label, members] of buckets) {
      if (members.length < MIN_ANALYTICAL_GROUP) { suppressed = true; continue; }
      const completed = members.filter((p) => p.status === "completed").length;
      groupCandidates.push({ grouping: mode, members: new Set(members.map((p) => p.id)), value: {
        label, count: members.length, completed, percent: Math.round(100 * completed / members.length),
      } });
    }
  }
  const comparable = new Map<string, Map<string, any>>();
  for (const person of people) {
    for (const result of person.results || []) {
      if (!usableScore(result.score) || result.score?.reviewRequired) continue;
      const id = [result.testVersionId, result.scoringKeyId, result.language].join(":");
      const members = comparable.get(id) || new Map<string, any>();
      // A repeated result is still one participant, not an extra sample.
      if (!members.has(person.id)) members.set(person.id, result);
      comparable.set(id, members);
    }
  }
  let methodCandidates: { members: Cohort; scales: Map<string, Cohort>; value: Method }[] = [];
  for (const [id, members] of comparable) {
    if (members.size < MIN_ANALYTICAL_GROUP) { suppressed = true; continue; }
    const results = [...members.values()], first = results[0];
    const score: Method["score"] = {}, scaleCohorts = new Map<string, Cohort>();
    if (results.every((r) => Number.isFinite(r.score.total) && r.score.maximum === first.score.maximum)) {
      score.total = results.reduce((sum, r) => sum + r.score.total, 0) / members.size;
      score.maximum = first.score.maximum;
    } else if (first.score.scales) {
      const scales: Record<string, any> = {};
      for (const key of Object.keys(first.score.scales)) {
        const eligible = [...members].filter(([, r]) => Number.isFinite(r.score.scales?.[key]?.mean));
        if (eligible.length < MIN_ANALYTICAL_GROUP) { suppressed = true; continue; }
        const values = eligible.map(([, r]) => r.score.scales[key]);
        scales[key] = { name: values[0].name, mean: values.reduce((sum, s) => sum + s.mean, 0) / values.length, min: values[0].min, max: values[0].max, count: values.length };
        scaleCohorts.set(key, new Set(eligible.map(([personId]) => personId)));
      }
      score.scales = scales;
    }
    methodCandidates.push({ members: new Set(members.keys()), scales: scaleCohorts, value: { id, name: first.name, n: members.size, score } });
  }
  const methodCohorts = () => methodCandidates.flatMap((m) => [m.members, ...m.scales.values()]);
  if (!safeCohorts(people, methodCohorts())) {
    complementarySuppressed = true;
    // Conservative coherent fallback: only whole-cohort methods/scales remain.
    methodCandidates = methodCandidates.filter((m) => m.members.size === people.length);
    for (const method of methodCandidates) {
      for (const [key, members] of method.scales) {
        if (members.size === people.length) continue;
        method.scales.delete(key);
        delete method.value.score.scales![key];
      }
    }
  }
  const anchors = methodCohorts();
  if (!safeCohorts(people, [...anchors, ...groupCandidates.map((g) => g.members)])) {
    complementarySuppressed = true;
    // Across toggles, retain only already disclosed cohorts and a safe overall.
    // In particular, N=9 cannot accompany a retained N=5 with a hidden residual 4.
    const safeOverall = safeCohorts(people, [...anchors, new Set(people.map((p) => p.id))]);
    groupCandidates = groupCandidates.filter((g) =>
      anchors.some((members) => sameCohort(members, g.members)) || (safeOverall && g.members.size === people.length));
  }
  const groups = groupCandidates.filter((g) => g.grouping === grouping).map((g) => g.value).sort((a, b) => a.label.localeCompare(b.label));
  return { groups, methods: methodCandidates.map((m) => m.value), suppressed: suppressed || complementarySuppressed, complementarySuppressed };
}
