/** Customer-approved percentage bands; classify the exact ratio before display rounding. */
export function percentageLevel(percent: number): number | null {
  if (!Number.isFinite(percent)) return null;
  return percent < 40
    ? 1
    : percent < 55
      ? 2
      : percent < 70
        ? 3
        : percent < 85
          ? 4
          : 5;
}

export function testScoreSummary(score: any) {
  if (
    !score ||
    score.excluded ||
    score.validity?.eligible === false ||
    score.reviewRequired
  )
    return null;
  if (
    !Number.isFinite(score.total) ||
    !Number.isFinite(score.maximum) ||
    score.maximum <= 0
  )
    return null;
  const percent = (100 * score.total) / score.maximum;
  return {
    total: score.total as number,
    maximum: score.maximum as number,
    percent,
    level: percentageLevel(percent)!,
  };
}
