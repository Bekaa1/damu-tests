import { reportScale, invalidProfile } from "./report-policy";
export const NORM_METHOD = "empirical-midrank-normal-sten-v1";
// Normal-distribution boundaries at z=-2,-1.5,-1,-.5,0,.5,1,1.5,2.
export const STEN_BOUNDARIES = [
  2.2750131948, 6.6807201269, 15.8655253931, 30.8537538726, 50, 69.1462461274,
  84.1344746069, 93.3192798731, 97.7249868052,
];
export type NormResult = {
  resultId: string;
  membershipId: string;
  testId: string;
  testVersionId: string;
  scoringKeyId: string;
  language: string;
  score: any;
};
export type FrozenMetric = {
  key: string;
  n: number;
  values: { value: number; count: number }[];
};
export type FrozenPayload = {
  method: string;
  languageMode: "separate" | "combined";
  boundaries: number[];
  minimumN: number;
  metrics: FrozenMetric[];
};
export function normKey(
  r: NormResult,
  scale: string,
  mode: FrozenPayload["languageMode"],
) {
  return JSON.stringify([
    r.testVersionId,
    r.scoringKeyId,
    mode === "combined" ? "both" : r.language,
    scale,
    scale === "total" ? r.score.maximum : r.score.scales?.[scale]?.max,
  ]);
}
export function normValues(r: NormResult) {
  if (!r.score || r.score.reviewRequired) return [];
  if (r.score.scales)
    return Object.entries(r.score.scales).flatMap(([id, s]: [string, any]) => {
      if (s.min < 1 || !Number.isFinite(s.mean) || s.mean < 1 || s.mean > s.max)
        return [];
      return [
        {
          id,
          value:
            r.testId === "personality"
              ? reportScale(id, s, "personality").mean
              : s.mean,
        },
      ];
    });
  return typeof r.score.total === "number" &&
    Number.isFinite(r.score.total) &&
    r.score.maximum > 0
    ? [{ id: "total", value: r.score.total }]
    : [];
}
export function buildFrozenPayload(
  rows: NormResult[],
  mode: FrozenPayload["languageMode"] = "separate",
): FrozenPayload {
  const excluded = new Set(
    rows
      .filter((r) => invalidProfile({ results: [r] } as any))
      .map((r) => r.membershipId),
  );
  const metrics = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (excluded.has(r.membershipId)) continue;
    for (const v of normValues(r)) {
      const key = normKey(r, v.id, mode),
        group = metrics.get(key) || new Map<string, number>();
      group.set(r.membershipId, v.value);
      metrics.set(key, group);
    }
  }
  return {
    method: NORM_METHOD,
    languageMode: mode,
    boundaries: [...STEN_BOUNDARIES],
    minimumN: 30,
    metrics: [...metrics.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => {
        const frequencies = new Map<number, number>();
        for (const value of rows.values())
          frequencies.set(value, (frequencies.get(value) || 0) + 1);
        return {
          key,
          n: rows.size,
          values: [...frequencies]
            .sort(([a], [b]) => a - b)
            .map(([value, count]) => ({ value, count })),
        };
      }),
  };
}
export function frozenRank(
  payload: FrozenPayload,
  key: string,
  value: number,
  normId: string,
) {
  if (payload.method !== "empirical-midrank-normal-sten-v1")
    throw Error("Не поддерживается версия метода зафиксированной нормы");
  const m = payload.metrics.find((m) => m.key === key);
  if (!m || m.n < payload.minimumN)
    return {
      normId,
      n: m?.n || 0,
      percentile: null,
      sten: null,
      reason: "insufficient_sample",
    };
  const less = m.values
      .filter((p) => p.value < value)
      .reduce((n, p) => n + p.count, 0),
    equal = m.values.find((p) => p.value === value)?.count || 0;
  const percentile = (100 * (less + equal / 2)) / m.n;
  if (m.values.length < 2)
    return { normId, n: m.n, percentile, sten: null, reason: "no_variation" };
  const index = payload.boundaries.findIndex((cut) => percentile < cut);
  return {
    normId,
    n: m.n,
    percentile,
    sten: index < 0 ? 10 : index + 1,
    reason: null,
  };
}
export function attachFrozenNorm(
  r: NormResult,
  payload: FrozenPayload,
  normId: string,
) {
  if (!r.score || typeof r.score !== "object") return r.score;
  const score = JSON.parse(JSON.stringify(r.score));
  delete score.cohortPercentile;
  const unusable = invalidProfile({ results: [r] } as any);
  if (score.scales)
    for (const s of Object.values(score.scales) as any[]) {
      delete s.cohortPercentile;
      delete s.reportNorm;
    }
  if (unusable) {
    const unavailable = {
      normId,
      n: 0,
      percentile: null,
      sten: null,
      reason: "quality_review",
    };
    score.reportNorm = unavailable;
    if (score.scales)
      for (const s of Object.values(score.scales) as any[])
        s.reportNorm = unavailable;
    return score;
  }
  for (const v of normValues(r)) {
    const rank = frozenRank(
      payload,
      normKey(r, v.id, payload.languageMode),
      v.value,
      normId,
    );
    if (v.id === "total") {
      score.reportNorm = rank;
      if (rank.percentile !== null)
        score.cohortPercentile = {
          n: rank.n,
          value: rank.percentile,
          scope: "frozen",
          normId,
        };
    } else score.scales[v.id].reportNorm = rank;
  }
  return score;
}
