import { createHash } from "node:crypto";
import { db, json } from "./db";
import { assertReportSubjectsAvailable, withReportSubjectFence } from "./report-subject";
import { type Context } from "./access";
import { participantDataExpired } from "../../../packages/core/data-policy";
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
// Each PDF starts a Chromium process. Keep automatic report preparation off the
// critical path for participants saving answers or submitting their last test.
const reportWaiters: Array<() => void> = [];
let activeReportJobs = 0;
async function withReportSlot<T>(job: () => Promise<T>): Promise<T> {
  if (activeReportJobs < 2) activeReportJobs++;
  else await new Promise<void>((resolve) => reportWaiters.push(resolve));
  try {
    return await job();
  } finally {
    const next = reportWaiters.shift();
    if (next) next();
    else activeReportJobs--;
  }
}
export async function persistReportPdf(
  id: string,
  content: GeneratedContent,
  mode = "ai",
) {
  if (rendering.has(id)) return rendering.get(id);
  const task = (async () => {
    const report = await db.generatedReport.findUnique({ where: { id } });
    if (!report) return;
    await assertReportSubjectsAvailable(report);
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
    const hold = async (error: ReportReviewRequired) => withReportSubjectFence(report, async (tx, current) => {
      if (current.readyAt || (current.generationMode === "expert" && mode !== "expert")) return;
      await tx.generatedReport.updateMany({
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
      await tx.auditLog.create({ data: {
        organizationId: current.organizationId, actorId: null,
        action: "generated_report.review_required", entityId: id,
        detail: json({ issues: error.issues }),
      } });
    });
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
    // Rendering owns no DB lock; the final fresh fence decides publication.
    await withReportSubjectFence(report, async (tx, current) => {
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
  await assertReportSubjectsAvailable(report);
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
  return withReportSlot(() => generateCompletedAssessment(organizationId, campaignId, membershipId));
}
async function generateCompletedAssessment(
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
  if (!member || member.organization.purpose === "pilot" || member.role !== "employee" || member.status !== "active" || participantDataExpired(member, member.organization)) return;
  // This is a scoped internal job, not an elevated end-user session. In
  // particular, demo-only employee credentials must never gain an admin role.
  const epoch = new Date(0);
  const ctx: Context = {
    org: member.organization,
    user: { id: "system-report-lifecycle", name: "AssessFlow report service", email: "system-report-lifecycle@assessflow.invalid",
      emailVerified: false, image: null, platformAdmin: false, demoOnly: false, mustChangePassword: false,
      locale: "ru", createdAt: epoch, updatedAt: epoch },
    member: null,
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
      await Promise.allSettled(stuck.map((r) => withReportSlot(() => makeFallbackAvailable(r.id))));
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
