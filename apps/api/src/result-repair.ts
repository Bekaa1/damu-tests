import { db, json } from "./db";
import {
  assessmentCompletion,
  COMPLETION_POLICY,
} from "../../../packages/core/result-validity";
import {
  calculateScore,
  type QuestionInput,
  type ScoringConfig,
} from "../../../packages/core/scoring";

/** Upgrade historical results once; preserve answers, original scores in audit, and frozen norms. */
export async function repairHistoricalResults() {
  const candidates = await db.testAttempt.findMany({
    where: { status: "completed", results: { some: {} } },
    select: { id: true, results: { select: { result: true } } },
  });
  let updated = 0;
  for (const candidate of candidates) {
    if (
      candidate.results.every(
        (r) => (r.result as any)?.validity?.policy === COMPLETION_POLICY,
      )
    )
      continue;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM test_attempts WHERE id = ${candidate.id} FOR UPDATE`;
        const a = await tx.testAttempt.findUniqueOrThrow({
          where: { id: candidate.id },
          include: {
            answers: true,
            results: true,
            assignment: {
              include: {
                testVersion: {
                  include: {
                    questions: {
                      orderBy: { position: "asc" },
                      include: { options: { orderBy: { position: "asc" } } },
                    },
                  },
                },
              },
            },
          },
        });
        if (a.status !== "completed") return;
        let invalid = false;
        const questions = a.assignment.testVersion
          .questions as unknown as QuestionInput[];
        const answers = Object.fromEntries(
          a.answers.map((x) => [x.questionId, x.value]),
        );
        for (const r of a.results) {
          if ((r.result as any)?.validity?.policy === COMPLETION_POLICY)
            continue;
          const key = await tx.scoringKey.findUniqueOrThrow({
            where: { id: r.scoringKeyId },
          });
          const validity = assessmentCompletion(
            questions,
            answers,
            key.config as ScoringConfig,
            key.algorithm === "scales",
          );
          invalid ||= !validity.eligible;
          const old = r.result as any;
          const computed = validity.eligible
            ? calculateScore(
                key.algorithm,
                key.config as ScoringConfig,
                questions,
                answers,
                {
                  allowMissing: key.algorithm !== "scales",
                  durations: Object.fromEntries(
                    a.answers.map((x) => [x.questionId, x.durationMs]),
                  ),
                  elapsedMs:
                    a.timerStartedAt && a.submittedAt
                      ? Math.max(
                          0,
                          a.submittedAt.getTime() - a.timerStartedAt.getTime(),
                        )
                      : undefined,
                },
              )
            : null;
          // Keep established scores/keys unchanged; replace only missing-data placeholders and quality metadata.
          const result = computed
            ? {
                ...old,
                responseQuality: computed.responseQuality,
                qualityFlags: computed.qualityFlags,
                reviewRequired: old.qualityReview
                  ? old.reviewRequired
                  : computed.reviewRequired,
                validity,
              }
            : {
                algorithm: key.algorithm,
                details: [],
                excluded: true,
                validity,
                qualityFlags: ["insufficient_answers"],
                sessionQuality: old.sessionQuality,
              };
          await tx.testResult.update({
            where: { id: r.id },
            data: {
              result: json(result),
              reason: "completion_policy_2026_11_19",
            },
          });
          await tx.auditLog.create({
            data: {
              organizationId: a.organizationId,
              actorId: null,
              action: "result.completion_policy_applied",
              entityId: r.id,
              detail: json({ validity, previousResult: old }),
            },
          });
        }
        if (invalid) {
          await tx.testAttempt.update({
            where: { id: a.id },
            data: { status: "retry_required" },
          });
          const reports = await tx.generatedReport.findMany({
            where: {
              organizationId: a.organizationId,
              campaignId: a.assignment.campaignId,
            },
          });
          for (const report of reports) {
            const snapshot = JSON.stringify(report.snapshot);
            if (!a.results.some((r) => snapshot.includes(r.id))) continue;
            await tx.generatedReport.update({
              where: { id: report.id },
              data: {
                status: "manual_review",
                error:
                  "В исходных данных обнаружен тест с недостаточным числом ответов. После повторного прохождения сформируйте новый отчёт.",
                reviewIssues: json([
                  {
                    code: "insufficient_answers",
                    path: "sources",
                    message:
                      "Недостаточно ответов в исходном тесте. Требуется повторное прохождение и новый отчёт.",
                  },
                ]),
              },
            });
            await tx.auditLog.create({
              data: {
                organizationId: a.organizationId,
                actorId: null,
                action: "generated_report.invalid_source",
                entityId: report.id,
                detail: json({ attemptId: a.id }),
              },
            });
          }
        }
        updated++;
      },
      { timeout: 30000 },
    );
  }
  return updated;
}
