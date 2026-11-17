// Evidence cards must contain only the explicitly mapped scales/cases.
export function projectSourceScore(score: any, ids: string[]) {
  if (!ids.length) return score;
  if (score.scales)
    return {
      algorithm: score.algorithm,
      scales: Object.fromEntries(
        Object.entries(score.scales).filter(([id]) => ids.includes(id)),
      ),
    };
  if (score.algorithm === "sjt") {
    const details = (score.details || []).filter((d: any) =>
      ids.includes(d.questionId),
    );
    if (details.length) {
      const total = details.reduce(
        (sum: number, d: any) => sum + (d.score || 0),
        0,
      );
      const maximum = details.reduce(
        (sum: number, d: any) => sum + (d.maximum ?? 2),
        0,
      );
      return {
        algorithm: "sjt",
        interpretation: score.interpretation,
        total,
        maximum,
        percent: (100 * total) / maximum,
        details,
      };
    }
    return {
      algorithm: "sjt",
      interpretation: score.interpretation,
      competencies: Object.fromEntries(
        Object.entries(score.competencies || {}).filter(([id]) =>
          ids.includes(id),
        ),
      ),
    };
  }
  return score;
}
