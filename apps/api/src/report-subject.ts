import { ForbiddenException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import type { GeneratedReport, Prisma } from "@prisma/client";
import { participantDataExpired } from "../../../packages/core/data-policy";
import { db } from "./db";
import { withParticipantWriteFence } from "./participant-write";

type SubjectReport = Pick<GeneratedReport,
  "organizationId" | "campaignId" | "kind" | "membershipId" | "participantIds" | "snapshot">;
type SubjectClient = Pick<Prisma.TransactionClient, "organization" | "campaign" | "membership">;
const unavailable = () => new ForbiddenException("Участники отчёта недоступны или состав отчёта нарушает правила конфиденциальности");
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;

/** Never trust the denormalized declared array alone, including historical jobs.
 * A team threshold counts actual distinct frozen people, not declarations.
 * Missing/malformed frozen scope cannot be repaired by querying today's roster.
 */
export function reportSubjectScope(report: SubjectReport) {
  const snapshot = report.snapshot as any;
  if (!identifier(report.organizationId) || !identifier(report.campaignId) ||
      !["individual", "team"].includes(report.kind) ||
      !Array.isArray(report.participantIds) || !report.participantIds.every(identifier) ||
      !snapshot || snapshot.campaign?.id !== report.campaignId ||
      !Array.isArray(snapshot.people) || !snapshot.people.length ||
      snapshot.people.some((p: any) => !p || !identifier(p.id)) ||
      (report.membershipId != null && !identifier(report.membershipId))) throw unavailable();
  const peopleIds = [...new Set<string>(snapshot.people.map((p: any) => p.id))].sort();
  const ids = [...new Set<string>([
    ...peopleIds, ...(report.participantIds as string[]),
    ...(report.membershipId == null ? [] : [report.membershipId]),
  ])].sort();
  if (report.kind === "team" ? peopleIds.length < 5 :
      (!identifier(report.membershipId) || peopleIds.length !== 1 || ids.length !== 1 || peopleIds[0] !== report.membershipId)) throw unavailable();
  return { ids, peopleIds };
}

/** Fresh checks are shared by list/detail/download/review and old workers.
 * The participant write fence additionally serializes writes against erasure.
 */
export async function assertReportSubjectsAvailable(report: SubjectReport, client: SubjectClient = db) {
  const scope = reportSubjectScope(report);
  const organization = await client.organization.findUnique({ where: { id: report.organizationId } });
  if (!organization || organization.id !== report.organizationId ||
      organization.status !== "active" || organization.purpose === "pilot") throw unavailable();
  const campaign = await client.campaign.findFirst({
    where: { id: report.campaignId, organizationId: report.organizationId }, select: { id: true },
  });
  if (!campaign || campaign.id !== report.campaignId) throw unavailable();
  const members = await client.membership.findMany({
    where: { organizationId: report.organizationId, id: { in: scope.ids } },
    include: { user: { select: { id: true, platformAdmin: true } } },
  });
  const byId = new Map(members.map(member => [member.id, member]));
  if (members.length !== scope.ids.length || byId.size !== scope.ids.length) throw unavailable();
  const now = new Date();
  for (const id of scope.ids) {
    const member = byId.get(id);
    if (!member || member.organizationId !== report.organizationId || member.role !== "employee" ||
        member.status !== "active" || !identifier(member.userId) || member.user?.id !== member.userId ||
        !Number.isFinite(new Date(member.createdAt).getTime()) ||
        (!member.user.platformAdmin && participantDataExpired(member, organization, now))) throw unavailable();
  }
  return scope;
}

/** Discover without a report lock, then lock all users/members BEFORE report.
 * Re-read and compare the full frozen row so stale renders/edits cannot commit
 * against changed scope, presentation edits or a replaced snapshot. All writes,
 * including audits containing report/source text, must use the supplied tx.
 */
export async function withReportSubjectFence<T>(
  report: GeneratedReport,
  operation: (tx: Prisma.TransactionClient, current: GeneratedReport) => Promise<T>,
): Promise<T> {
  const scope = reportSubjectScope(report);
  return withParticipantWriteFence(report.organizationId, scope.ids, async tx => {
    // Match creation: users -> memberships -> organization -> report. Taking
    // UPDATE directly avoids a SHARE-to-UPDATE upgrade deadlock in AI budget
    // reservation, and freezes current purpose/status until this commit.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${report.organizationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM generated_reports WHERE id = ${report.id} FOR UPDATE`;
    const current = await tx.generatedReport.findUnique({ where: { id: report.id } });
    if (!current || current.organizationId !== report.organizationId ||
        current.campaignId !== report.campaignId || current.kind !== report.kind ||
        current.membershipId !== report.membershipId || current.language !== report.language ||
        !isDeepStrictEqual(current.snapshot, report.snapshot) ||
        !isDeepStrictEqual(current.presentationEdits, report.presentationEdits) ||
        !isDeepStrictEqual(reportSubjectScope(current), scope)) throw unavailable();
    await assertReportSubjectsAvailable(current, tx);
    return operation(tx, current);
  });
}

/** An erased/expired scope is a terminal no-op for retries, never a reason to
 * recreate content or audit references. Database/provider failures still throw.
 */
export async function ignoreUnavailableReport<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try { return await operation(); }
  catch (error) { if (error instanceof ForbiddenException) return; throw error; }
}
