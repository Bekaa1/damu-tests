import { db } from "./db";
// Ranks use only the latest completed attempt and key of this campaign.
// Strictly lower scores count; ties receive the same percentile.
export async function campaignRanks(
  organizationId: string,
  campaignId: string,
) {
  const assignments = await db.testAssignment.findMany({
    where: { organizationId, campaignId },
    include: {
      attempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
        include: { results: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });
  const rows = assignments.flatMap((a) =>
    a.attempts[0]?.status === "completed"
      ? a.attempts[0].results.map((r) => ({
          id: r.id,
          key: a.testVersionId + ":" + r.scoringKeyId,
          score: r.result as any,
        }))
      : [],
  );
  const out = new Map<string, any>();
  for (const r of rows) {
    const score = JSON.parse(JSON.stringify(r.score));
    const comparable = rows.filter(
      (x) => x.key === r.key && !x.score.reviewRequired,
    );
    const rank = (value: number, values: number[]) =>
      values.length >= 2
        ? {
            n: values.length,
            value:
              (100 * values.filter((x) => x < value).length) / values.length,
            scope: "campaign",
          }
        : undefined;
    if (!score.reviewRequired) {
      if (typeof score.total === "number")
        score.cohortPercentile = rank(
          score.total,
          comparable
            .map((x) => x.score.total)
            .filter((x) => typeof x === "number"),
        );
      if (score.scales)
        for (const [id, s] of Object.entries(score.scales) as [string, any][])
          s.cohortPercentile = rank(
            s.mean,
            comparable
              .map((x) => x.score.scales?.[id]?.mean)
              .filter((x) => typeof x === "number"),
          );
    }
    out.set(r.id, score);
  }
  return out;
}
