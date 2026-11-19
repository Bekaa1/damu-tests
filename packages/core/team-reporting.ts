import type { ReportLanguage, ReportPerson, ReportSnapshot } from "./reporting";
import {
  invalidProfile,
  reportScale,
  reportText,
  roundReport,
  testLevel,
  personalityProfile,
  personalityBand,
  levelText,
} from "./report-policy";
import { testScoreSummary } from "./test-levels";

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export const JOB_GROUPS = [
  { id: "director_hq", ru: "Директор ГО", kk: "Бас кеңсе директоры" },
  {
    id: "deputy_hq",
    ru: "Заместитель ГО",
    kk: "Бас кеңсе директорының орынбасары",
  },
  { id: "director_branch", ru: "Директор филиала", kk: "Филиал директоры" },
  {
    id: "deputy_branch",
    ru: "Заместитель филиала",
    kk: "Филиал директорының орынбасары",
  },
] as const;
export function jobGroup(p: ReportPerson): string | null {
  const role = p.competencyProfile?.consensus?.scores?.roleId;
  if (JOB_GROUPS.some((g) => g.id === role)) return role;
  const title = `${p.position} ${p.category}`.toLowerCase();
  if (!/директор|director|орынбасар|заместител/.test(title)) return null;
  const deputy = /замест|deputy|орынбасар/.test(title);
  const hq = /головн|бас кеңсе|head office|(?<![\p{L}])го(?![\p{L}])/u.test(
    `${p.unit} ${title}`.toLowerCase(),
  );
  const branch = /филиал|branch/.test(`${p.unit} ${title}`.toLowerCase());
  return hq
    ? deputy
      ? "deputy_hq"
      : "director_hq"
    : branch
      ? deputy
        ? "deputy_branch"
        : "director_branch"
      : null;
}
export function distribution(values: number[]) {
  return [1, 2, 3, 4, 5].map((level) => ({
    level,
    count: values.filter((v) => v === level).length,
  }));
}
export function summaryStats(values: number[], suppress = true) {
  if (suppress && values.length < 5) return { suppressed: true as const };
  if (!values.length) return { suppressed: true as const };
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return {
    suppressed: false as const,
    n: sorted.length,
    median: roundReport(
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    ),
    min: roundReport(sorted[0]),
    max: roundReport(sorted[sorted.length - 1]),
  };
}
export function teamReportData(
  snapshot: ReportSnapshot,
  language: ReportLanguage,
) {
  const valid = snapshot.people.filter(
    (p) => p.status === "completed" && !invalidProfile(p),
  );
  const passport = {
    id: "coverage",
    invited: snapshot.people.length,
    completed: snapshot.people.filter((p) => p.status === "completed").length,
    excluded: snapshot.people.filter(
      (p) => p.status === "completed" && invalidProfile(p),
    ).length,
    included: valid.length,
    approved: snapshot.people.filter((p) => p.expert?.status === "approved")
      .length,
  };
  const groups = JOB_GROUPS.map((g) => ({
    id: g.id,
    name: g[language],
    participants: summaryStats(
      valid.filter((p) => jobGroup(p) === g.id).map(() => 1),
    ),
  }));
  const metrics = new Map<
    string,
    {
      id: string;
      name: string;
      testId: string;
      scale: string;
      percentage: boolean;
      comparableKey: string;
      maximum: number | null;
      normBased: boolean;
      values: {
        p: ReportPerson;
        value: number;
        level: number | null;
        total?: number;
        priority: number;
        band: number | null;
      }[];
    }
  >();
  for (const p of valid)
    for (const r of p.results) {
      if (!r.score || r.score.reviewRequired) continue;
      const score = r.score,
        base = `${r.testVersionId}:${r.scoringKeyId || ""}:${r.language || "ru"}`;
      const entries: [string, any][] = score.scales
        ? Object.entries(score.scales)
        : [["total", null]];
      for (const [id, raw] of entries) {
        if (r.testId === "personality" && id.length > 1) continue;
        const s = raw ? reportScale(id, raw, r.testId) : null;
        if (
          s &&
          (!Number.isFinite(s.mean) ||
            (r.testId === "personality" && !s.interpretable))
        )
          continue;
        const value = s
          ? s.mean
          : typeof score.total === "number" && score.maximum > 0
            ? (score.total / score.maximum) * 100
            : null;
        if (value === null || !Number.isFinite(value)) continue;
        const key = `${base}:${id}:${s?.min ?? 0}:${s?.max ?? score.maximum}`;
        const m = metrics.get(key) || {
          id: `team-metric-${metrics.size + 1}`,
          name: s ? reportText(s.name, language) : reportText(r.name, language),
          testId: r.testId,
          scale: id,
          percentage: !s,
          comparableKey: base,
          maximum: !s ? score.maximum : null,
          normBased: !!s?.reportNorm,
          values: [] as {
            p: ReportPerson;
            value: number;
            level: number | null;
            total?: number;
            priority: number;
            band: number | null;
          }[],
        };
        if (!m.values.some((v) => v.p.id === p.id)) {
          const domain =
            r.testId === "personality"
              ? personalityProfile(p, language).find((d) => d.id === id)
              : null;
          m.values.push({
            p,
            value,
            level: s ? null : testLevel(score),
            total: s ? undefined : score.total,
            priority: score.motivation?.profile?.[id]?.adjusted ?? value,
            band: domain
              ? domain.reportNorm
                ? domain.reportNorm.sten
                : domain.mean
              : null,
          });
        }
        metrics.set(key, m);
      }
    }
  const methods = [...metrics.values()].map((m) => {
    const comparison = ["hq", "branch"].map((unit) =>
      m.values.filter((v) => jobGroup(v.p)?.endsWith(unit)).map((v) => v.value),
    );
    const med = comparison.map((v) => summaryStats(v));
    const comparable = med.every((s) => s && !s.suppressed);
    // Test the unrounded difference, not the displayed median.
    const rawMedian = (v: number[]) => {
      const s = [...v].sort((a, b) => a - b),
        n = s.length;
      return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    };
    const delta = comparable
      ? rawMedian(comparison[0]) - rawMedian(comparison[1])
      : null;
    return {
      id: m.id,
      name: m.name,
      testId: m.testId,
      scale: m.scale,
      percentage: m.percentage,
      comparableKey: m.comparableKey,
      maximum: m.maximum,
      medianTotal:
        m.percentage && m.values.length >= 5
          ? median(m.values.map((v) => v.total!))
          : null,
      groupTotals: JOB_GROUPS.map((g) => {
        const rows = m.values.filter((v) => jobGroup(v.p) === g.id);
        return rows.length >= 5 && m.percentage
          ? median(rows.map((v) => v.total!))
          : null;
      }),
      medianPriority:
        m.testId === "motivation" && m.values.length >= 5
          ? median(m.values.map((v) => v.priority))
          : null,
      personalityBand:
        m.testId === "personality" &&
        m.values.filter((v) => v.band !== null).length >= 5
          ? (() => {
              const value = median(
                m.values.flatMap((v) => (v.band === null ? [] : [v.band])),
              );
              return personalityBand(
                m.normBased ? (value <= 2 ? 1 : value >= 9 ? 5 : 3) : value,
                language,
              );
            })()
          : null,
      overall: summaryStats(m.values.map((v) => v.value)),
      groups: JOB_GROUPS.map((g) => ({
        id: g.id,
        ...summaryStats(
          m.values.filter((v) => jobGroup(v.p) === g.id).map((v) => v.value),
        ),
      })),
      distribution:
        m.percentage && m.values.length >= 5
          ? distribution(m.values.flatMap((v) => (v.level ? [v.level] : [])))
          : [],
      comparison:
        delta !== null && Math.abs(delta) >= (m.percentage ? 10 : 0.5)
          ? { hq: med[0], branches: med[1], difference: roundReport(delta) }
          : null,
    };
  });
  const competencies = new Map<
    string,
    {
      id: string;
      name: string;
      values: { p: ReportPerson; value: number; target?: number }[];
    }
  >();
  for (const p of valid) {
    const profile = p.competencyProfile,
      model = profile?.model;
    if (!profile?.consensus || !model) continue;
    const role = model.content.roles.find(
      (r: any) => r.id === profile.consensus.scores.roleId,
    );
    for (const rating of profile.consensus.scores.ratings) {
      if (typeof rating.value !== "number") continue;
      const c = model.content.competencies.find(
        (c: any) => c.id === rating.competencyId,
      );
      if (!c) continue;
      const key = `${model.id}:${c.id}`;
      const item = competencies.get(key) || {
        id: c.id,
        name: reportText(c.name, language),
        values: [] as { p: ReportPerson; value: number; target?: number }[],
      };
      item.values.push({
        p,
        value: rating.value,
        target: model.status === "approved" ? role?.targets[c.id] : undefined,
      });
      competencies.set(key, item);
    }
  }
  const competencyStats = [...competencies.values()].map((c, index) => ({
    id: `team-competency-${index + 1}`,
    competencyId: c.id,
    name: c.name,
    overall: summaryStats(c.values.map((v) => v.value)),
    distribution:
      c.values.length >= 5 ? distribution(c.values.map((v) => v.value)) : [],
    groups: JOB_GROUPS.map((g) => {
      const values = c.values.filter((v) => jobGroup(v.p) === g.id),
        approved = values.filter((v) => typeof v.target === "number");
      const below = approved.filter((v) => v.value < v.target!).length;
      return {
        id: g.id,
        ...summaryStats(values.map((v) => v.value)),
        below:
          approved.length >= 5
            ? roundReport((100 * below) / approved.length)
            : null,
        color:
          approved.length < 5
            ? null
            : (100 * below) / approved.length < 20
              ? "green"
              : (100 * below) / approved.length <= 40
                ? "yellow"
                : "red",
      };
    }),
    training:
      c.values.length >= 5 && c.values.filter((v) => v.value <= 2).length >= 5
        ? { count: c.values.filter((v) => v.value <= 2).length }
        : null,
  }));
  return {
    passport,
    groups,
    unclassified: summaryStats(valid.filter((p) => !jobGroup(p)).map(() => 1)),
    methods,
    competencies: competencyStats,
  };
}

/** Compact test-only view shared by the customer PDF and its narrative generator.
 * Detailed measurements and expert consensus remain available through teamReportData/admin/Excel.
 */
export function teamTestReportData(
  snapshot: ReportSnapshot,
  language: ReportLanguage,
) {
  const data = teamReportData(snapshot, language);
  const summary = (
    total: number | null,
    maximum: number | null,
    stats: ReturnType<typeof summaryStats>,
  ) => {
    if (total === null || maximum === null || stats.suppressed) return null;
    const score = testScoreSummary({ total, maximum });
    return score
      ? { ...score, n: stats.n, label: levelText(score.level, language) }
      : null;
  };
  const methods = data.methods
    .filter((m) => m.percentage)
    .map((m) => ({
      id: m.id,
      name: m.name,
      testId: m.testId,
      overall: summary(m.medianTotal, m.maximum, m.overall),
      groups: m.groups.map((g, i) => ({
        id: g.id,
        name: JOB_GROUPS[i][language],
        summary: summary(m.groupTotals[i], m.maximum, g),
      })),
      distribution: m.distribution,
      comparison: m.comparison,
    }));
  const personality = data.methods
    .filter((m) => m.testId === "personality")
    .map((m) => ({
      id: m.id,
      name: m.name,
      band: m.personalityBand,
    }));
  const forms = new Map<string, typeof data.methods>();
  for (const m of data.methods.filter((m) => m.testId === "motivation")) {
    const rows = forms.get(m.comparableKey) || [];
    rows.push(m);
    forms.set(m.comparableKey, rows);
  }
  const motivation = [...forms.values()].map((rows) => {
    // Do not rank an incomplete or suppressed profile: that could reveal small cells.
    const available =
      rows.length >= 6 && rows.every((m) => m.medianPriority !== null);
    const sorted = available
      ? [...rows].sort(
          (a, b) =>
            b.medianPriority! - a.medianPriority! ||
            a.scale.localeCompare(b.scale),
        )
      : [];
    const compact = (m: (typeof rows)[number]) => ({ id: m.id, name: m.name });
    return {
      available,
      top: sorted.slice(0, 3).map(compact),
      bottom: sorted.slice(-3).reverse().map(compact),
    };
  });
  return { passport: data.passport, methods, personality, motivation };
}
