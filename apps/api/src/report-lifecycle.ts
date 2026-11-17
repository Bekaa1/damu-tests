import { createHash } from "node:crypto";
import { db, audit, json } from "./db";
import { type Context } from "./access";
import {
  REPORT_POLICY_VERSION,
  reportContentIssues,
  reportTextIssues,
  paragraphIssues,
  ReportReviewRequired,
} from "../../../packages/core/report-policy";
import {
  type GeneratedContent,
  type ReportSnapshot,
} from "../../../packages/core/reporting";
// A data-based report remains available if the language-model provider is unavailable.
// No assessor score or observation is fabricated by this fallback.
export { dataReport as fallbackReport } from "../../../packages/core/report-fallback";
import { dataReport } from "../../../packages/core/report-fallback";
const rendering = new Map<string, Promise<void>>();
export async function persistReportPdf(
  id: string,
  content: GeneratedContent,
  mode = "ai",
) {
  if (rendering.has(id)) return rendering.get(id);
  const task = (async () => {
    const report = await db.generatedReport.findUniqueOrThrow({
      where: { id },
    });
    if (
      report.readyAt ||
      (report.generationMode === "expert" && mode !== "expert")
    )
      return;
    const snapshot = report.snapshot as unknown as ReportSnapshot;
    const issues = reportContentIssues(
      content,
      snapshot,
      report.kind as "individual" | "team",
    );
    const hold = async (error: ReportReviewRequired) => {
      await db.generatedReport.updateMany({
        where: {
          id,
          readyAt: null,
          ...(mode === "expert" ? {} : { generationMode: { not: "expert" } }),
        },
        data: {
          status: "manual_review",
          content: json(content),
          reviewIssues: json(error.issues),
          generationMode: mode,
          policyVersion: REPORT_POLICY_VERSION,
          error: "Нужна проверка формулировок экспертом. PDF пока недоступен.",
        },
      });
      await audit(
        report.organizationId,
        null,
        "generated_report.review_required",
        id,
        { issues: error.issues },
      );
    };
    if (issues.length) {
      await hold(new ReportReviewRequired(issues));
      return;
    }
    const { professionalReportTemplate, reportCss } =
      await import("./report-layout");
    const { renderPdf } = await import("./exports");
    const rendered = professionalReportTemplate(
      report.snapshot as unknown as ReportSnapshot,
      content,
      {
        kind: report.kind as "individual" | "team",
        language: report.language as "ru" | "kk",
        createdAt: report.createdAt,
        presentationEdits: report.presentationEdits as Record<string, string>,
      },
    );
    let bytes: Buffer;
    try {
      bytes = await renderPdf(
        rendered.html,
        rendered.label,
        report.language,
        reportCss,
        (text, paragraphs) => {
          const issues = [
            ...reportTextIssues(text),
            ...paragraphs.flatMap((p, i) =>
              paragraphIssues(p, `paragraph.${i}`),
            ),
          ];
          if (issues.length) throw new ReportReviewRequired(issues);
        },
      );
    } catch (error) {
      if (error instanceof ReportReviewRequired) {
        await hold(error);
        return;
      }
      throw error;
    }
    const readyAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM generated_reports WHERE id = ${id} FOR UPDATE`;
      const current = await tx.generatedReport.findUniqueOrThrow({
        where: { id },
      });
      if (
        current.readyAt ||
        (current.generationMode === "expert" && mode !== "expert")
      )
        return;
      await tx.reportArtifact.create({
        data: {
          reportId: id,
          bytes: new Uint8Array(bytes),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      });
      await tx.generatedReport.update({
        where: { id },
        data: {
          status: "completed",
          content: json(content),
          readyAt,
          generationMode: mode,
          policyVersion: REPORT_POLICY_VERSION,
          reviewIssues: [],
          error: null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: report.organizationId,
          actorId: null,
          action: "report.available",
          entityId: id,
          detail: json({
            completedAt: report.assessmentCompletedAt,
            readyAt,
            elapsedMs: report.assessmentCompletedAt
              ? readyAt.getTime() - report.assessmentCompletedAt.getTime()
              : null,
            mode,
            bytes: bytes.length,
          }),
        },
      });
    });
  })();
  rendering.set(id, task);
  try {
    await task;
  } finally {
    rendering.delete(id);
  }
}
export async function makeFallbackAvailable(id: string) {
  const report = await db.generatedReport.findUnique({ where: { id } });
  if (
    !report ||
    report.readyAt ||
    report.status === "manual_review" ||
    report.generationMode === "expert"
  )
    return;
  await persistReportPdf(
    id,
    dataReport(
      report.snapshot as unknown as ReportSnapshot,
      report.language as "ru" | "kk",
      report.kind as "individual" | "team",
    ),
    "data",
  );
}
export async function queueCompletedAssessment(
  organizationId: string,
  campaignId: string,
  membershipId: string,
) {
  const tasks = await db.testAssignment.findMany({
    where: { organizationId, campaignId, membershipId },
    include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } },
  });
  if (!tasks.length || tasks.some((t) => t.attempts[0]?.status !== "completed"))
    return;
  const member = await db.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: { organization: true, user: true },
  });
  if (!member) return;
  const ctx: Context = {
    org: member.organization,
    user: member.user,
    member,
    role: "admin",
  };
  const { createGeneratedReport } = await import("./generated-reports");
  await createGeneratedReport(
    ctx,
    {
      campaignId,
      membershipId,
      kind: "individual",
      language: member.user.locale === "kk" ? "kk" : "ru",
    },
    true,
  );
}
export function startReportWatchdog() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await db.generatedReport.updateMany({
        where: {
          status: "processing",
          generationMode: "expert",
          readyAt: null,
          updatedAt: { lte: new Date(Date.now() - 120000) },
        },
        data: {
          status: "manual_review",
          error:
            "Проверка была прервана. Откройте отчёт и повторите выпуск PDF.",
        },
      });
      // Recovery after a process restart or a queue/provider outage. Leave 60s for PDF rendering.
      const stuck = await db.generatedReport.findMany({
        where: {
          readyAt: null,
          status: { in: ["pending", "processing", "failed"] },
          generationMode: { not: "expert" },
          createdAt: { lte: new Date(Date.now() - 210000) },
        },
        select: { id: true },
        take: 20,
      });
      await Promise.allSettled(stuck.map((r) => makeFallbackAvailable(r.id)));
      // The completion audit is committed with the score. Recover a trigger lost
      // between that commit and enqueueing (for example during an API restart).
      const recent = await db.auditLog.findMany({
        where: {
          action: "attempt.completed",
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { entityId: true },
      });
      const attempts = await db.testAttempt.findMany({
        where: {
          id: { in: recent.flatMap((r) => (r.entityId ? [r.entityId] : [])) },
        },
        include: { assignment: true },
      });
      const seen = new Set<string>();
      for (const a of attempts) {
        const t = a.assignment,
          key = `${t.organizationId}:${t.campaignId}:${t.membershipId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const report = await db.generatedReport.findFirst({
          where: {
            organizationId: t.organizationId,
            campaignId: t.campaignId,
            membershipId: t.membershipId,
            kind: "individual",
            createdAt: { gte: a.submittedAt ?? a.startedAt },
          },
          select: { id: true },
        });
        if (!report)
          await queueCompletedAssessment(
            t.organizationId,
            t.campaignId,
            t.membershipId,
          ).catch(console.error);
      }
    } catch (e) {
      console.error("Report availability recovery", e);
    } finally {
      busy = false;
    }
  }, 10000);
  timer.unref();
  return timer;
}
