import { db } from "./db";
import { removeStoredFiles } from "./storage";
import { participantDataExpired } from "../../../packages/core/data-policy";

type ErasureOptions = {
  now: Date;
  organizationId?: string;
  requireExpired: boolean;
  pilotOnly?: boolean;
};

function containsIdentifier(value: unknown, identifiers: string[]) {
  const serialized = JSON.stringify(value) || "";
  return identifiers.some(identifier => serialized.includes(identifier));
}

/** One tenant-scoped erasure path for retention and explicit withdrawal.
 * Persist the block before storage access. Recheck under user/member locks;
 * any S3 failure rolls back DB deletions but intentionally keeps that block.
 */
async function eraseParticipant(id: string, options: ErasureOptions) {
  const member = await db.membership.findUnique({ where: { id }, include: { organization: true, user: true } });
  const eligible = (candidate: typeof member) => Boolean(
    candidate && candidate.role === "employee" && !candidate.user.platformAdmin &&
    (!options.organizationId || candidate.organizationId === options.organizationId) &&
    (!options.pilotOnly || candidate.organization.purpose === "pilot") &&
    (!options.requireExpired || participantDataExpired(candidate, candidate.organization, options.now)),
  );
  if (!eligible(member) || !member) return false;
  const { organizationId, userId } = member;
  const blocked = await db.membership.updateMany({
    where: { id, organizationId, userId, role: "employee", user: { platformAdmin: false } },
    data: { status: "blocked" },
  });
  if (!blocked.count) return false;
  return db.$transaction(async tx => {
    // The user lock serializes deletion of shared accounts across organizations.
    await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM memberships WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`;
    const current = await tx.membership.findUnique({ where: { id }, include: { organization: true, user: true } });
    if (!eligible(current) || !current || current.organizationId !== organizationId || current.userId !== userId) return false;

    // Preserve every storage reference until all S3 deletes have succeeded.
    // S3 delete is idempotent, so partial deletion or DB rollback is retryable.
    await removeStoredFiles(organizationId, id);
    const scope = { organizationId, membershipId: id };
    const tasks = await tx.testAssignment.findMany({ where: scope, select: { id: true, campaignId: true } });
    const taskIds = tasks.map(task => task.id);
    const attempts = await tx.testAttempt.findMany({ where: { organizationId, assignmentId: { in: taskIds } }, select: { id: true } });
    const attemptIds = attempts.map(attempt => attempt.id);
    const files = await tx.fileAsset.findMany({ where: scope });
    const results = await tx.testResult.findMany({ where: { organizationId, attemptId: { in: attemptIds } }, select: { id: true } });
    const allAi = await tx.aiReport.findMany({ where: { organizationId } });
    const allFinal = await tx.finalReport.findMany({ where: { organizationId } });
    const observations = await tx.expertObservation.findMany({ where: scope, select: { id: true, campaignId: true } });
    const consensus = await tx.competencyConsensus.findMany({ where: scope, select: { id: true } });
    const identifiers = [id, userId, current.user.email, current.user.name, ...taskIds, ...attemptIds,
      ...files.flatMap(file => [file.id, file.storageKey]), ...results.map(result => result.id),
      ...observations.map(observation => observation.id), ...consensus.map(row => row.id)]
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const ai = allAi.filter(report => report.membershipId === id || containsIdentifier(report, identifiers));
    identifiers.push(...ai.map(report => report.id));
    const reports = allFinal.filter(report => report.membershipId === id || containsIdentifier(report, identifiers));
    identifiers.push(...reports.map(report => report.id));
    // Include legacy team reports whose participantIds are incomplete but whose
    // immutable snapshot/content still carries this subject or a file reference.
    const generated = (await tx.generatedReport.findMany({ where: { organizationId } }))
      .filter(report => containsIdentifier(report, identifiers));
    identifiers.push(...generated.map(report => report.id));
    const campaigns = [...new Set([...tasks, ...ai, ...reports, ...observations, ...generated].map(row => row.campaignId))];
    const logs = await tx.auditLog.findMany({ where: { organizationId } });
    const logIds = logs.filter(log => containsIdentifier(log, identifiers)).map(log => log.id);
    await tx.auditLog.deleteMany({ where: { organizationId, id: { in: logIds } } });
    // report_artifacts bytes cascade from generated_reports in the migration.
    await tx.generatedReport.deleteMany({ where: { organizationId, id: { in: generated.map(report => report.id) } } });
    await tx.finalReport.deleteMany({ where: { organizationId, id: { in: reports.map(report => report.id) } } });
    await tx.aiReport.deleteMany({ where: { organizationId, id: { in: ai.map(report => report.id) } } });
    await tx.expertObservation.deleteMany({ where: scope });
    // Explicit cleanup is intentional even where SQL migration FKs cascade.
    await tx.participantGroup.deleteMany({ where: scope });
    await tx.competencyConsensus.deleteMany({ where: scope });
    await tx.fileAsset.deleteMany({ where: scope });
    await tx.userAnswer.deleteMany({ where: { organizationId, attemptId: { in: attemptIds } } });
    await tx.testResult.deleteMany({ where: { organizationId, attemptId: { in: attemptIds } } });
    await tx.testAttempt.deleteMany({ where: { organizationId, id: { in: attemptIds } } });
    await tx.testAssignment.deleteMany({ where: scope });
    await tx.frozenNorm.deleteMany({ where: { organizationId, campaignId: { in: campaigns } } });
    await tx.membership.delete({ where: { id, organizationId } });
    if (await tx.membership.count({ where: { userId } }) === 0) {
      // Global auth records belong to the user, not one organization. Keep them
      // while any membership remains, including a blocked/staff membership.
      await tx.auditLog.deleteMany({ where: { organizationId: null, actorId: userId } });
      await tx.verification.deleteMany({ where: { identifier: current.user.email } });
      await tx.user.delete({ where: { id: userId } }); // auth sessions/accounts cascade
    }
    await tx.auditLog.create({ data: {
      organizationId,
      action: options.requireExpired
        ? (options.pilotOnly ? "pilot.retention_erased" : "participant.retention_erased")
        : "personal_data.erased",
      detail: { deletedParticipants: 1, policy: options.requireExpired ? "three_calendar_months_from_registration" : "explicit_withdrawal" },
    } });
    return true;
  }, { timeout: 120000 });
}

export function eraseExpiredParticipant(id: string, now = new Date()) {
  return eraseParticipant(id, { now, requireExpired: true });
}

/** Administrative withdrawal; organizationId is mandatory and rechecked. */
export function eraseParticipantData(organizationId: string, id: string, now = new Date()) {
  return eraseParticipant(id, { now, organizationId, requireExpired: false });
}

/** Compatibility API, deliberately still pilot-only. */
export function eraseExpiredPilotParticipant(id: string, now = new Date()) {
  return eraseParticipant(id, { now, requireExpired: true, pilotOnly: true });
}

async function sweepRetention(now: Date, pilotOnly: boolean) {
  let deleted = 0, failed = 0;
  let cursor: { id: string; createdAt: Date } | undefined;
  do {
    const candidates = await db.membership.findMany({
      where: {
        role: "employee", user: { platformAdmin: false },
        ...(pilotOnly ? { organization: { purpose: "pilot" } } : {}),
        // Exact calendar deadline is always checked by the policy above.
        createdAt: { lte: new Date(now.getTime() - 89 * 86400000) },
        ...(cursor ? { OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ] } : {}),
      },
      select: { id: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500,
    });
    if (!candidates.length) break;
    // A value-based cursor survives deletion of the last record in the batch.
    cursor = candidates[candidates.length - 1];
    for (const candidate of candidates) {
      try {
        if (await eraseParticipant(candidate.id, { now, requireExpired: true, pilotOnly })) deleted++;
      } catch { failed++; console.error("Participant retention: deletion failed; retry scheduled"); }
    }
    if (candidates.length < 500) break;
  } while (cursor);
  return { deleted, failed };
}

export function sweepParticipantRetention(now = new Date()) { return sweepRetention(now, false); }
export function sweepPilotRetention(now = new Date()) { return sweepRetention(now, true); }

function startRetention(sweep: () => Promise<unknown>) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await sweep(); }
    catch { console.error("Participant retention sweep failed; retry scheduled"); }
    finally { busy = false; }
  };
  void run();
  return setInterval(run, 60000);
}
export function startParticipantRetention() { return startRetention(sweepParticipantRetention); }
export function startPilotRetention() { return startRetention(sweepPilotRetention); }
