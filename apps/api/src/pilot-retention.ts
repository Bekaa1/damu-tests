import { db } from "./db";
import { removeStoredFiles } from "./storage";
import { pilotDataExpired } from "../../../packages/core/pilot";

// Only pilot participants expire. Staff accounts and assessment organizations
// are never candidates. Registration, not consent or last activity, sets the deadline.
export async function eraseExpiredPilotParticipant(id: string, now = new Date()) {
  const member = await db.membership.findUnique({
    where: { id }, include: { organization: true, user: true },
  });
  if (!member || member.user.platformAdmin || !pilotDataExpired(member, member.organization, now)) return false;
  const organizationId = member.organizationId, userId = member.userId;
  await db.membership.update({ where: { id }, data: { status: "blocked" } });
  // Failure leaves the participant blocked and retries on the next sweep.
  await removeStoredFiles(organizationId, id);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM memberships WHERE id=${id} FOR UPDATE`;
    const current = await tx.membership.findUnique({where:{id},include:{organization:true,user:true}});
    if (!current || current.user.platformAdmin || !pilotDataExpired(current, current.organization, now)) return false;
    const scope = { organizationId, membershipId: id };
    const tasks = await tx.testAssignment.findMany({where:scope,select:{id:true,campaignId:true}});
    const taskIds = tasks.map(t=>t.id), campaigns = [...new Set(tasks.map(t=>t.campaignId))];
    const attempts = await tx.testAttempt.findMany({where:{organizationId,assignmentId:{in:taskIds}},select:{id:true}});
    const attemptIds = attempts.map(a=>a.id);
    const generated = await tx.generatedReport.findMany({where:{organizationId,OR:[{membershipId:id},{participantIds:{array_contains:[id]}}]},select:{id:true}});
    const files = await tx.fileAsset.findMany({where:scope,select:{id:true}});
    const results = await tx.testResult.findMany({where:{organizationId,attemptId:{in:attemptIds}},select:{id:true}});
    const ai = await tx.aiReport.findMany({where:scope,select:{id:true}});
    const reports = await tx.finalReport.findMany({where:scope,select:{id:true}});
    const observations = await tx.expertObservation.findMany({where:scope,select:{id:true}});
    const identifiers = [id,userId,current.user.email,...taskIds,...attemptIds,...generated.map(x=>x.id),...files.map(x=>x.id),...results.map(x=>x.id),...ai.map(x=>x.id),...reports.map(x=>x.id),...observations.map(x=>x.id)];
    // Consent/presence/incident logs can contain identifiers inside JSON, including
    // batch assignment records. Remove such pilot records along with the results.
    const logs = await tx.auditLog.findMany({where:{organizationId}});
    const logIds = logs.filter(log=>identifiers.some(value=>JSON.stringify(log).includes(value))).map(log=>log.id);
    await tx.auditLog.deleteMany({where:{organizationId,id:{in:logIds}}});
    await tx.generatedReport.deleteMany({where:{organizationId,id:{in:generated.map(r=>r.id)}}});
    await tx.finalReport.deleteMany({where:scope});
    await tx.aiReport.deleteMany({where:scope});
    await tx.expertObservation.deleteMany({where:scope});
    await tx.competencyConsensus.deleteMany({where:scope});
    await tx.participantGroup.deleteMany({where:scope});
    await tx.fileAsset.deleteMany({where:scope});
    await tx.userAnswer.deleteMany({where:{organizationId,attemptId:{in:attemptIds}}});
    await tx.testResult.deleteMany({where:{organizationId,attemptId:{in:attemptIds}}});
    await tx.testAttempt.deleteMany({where:{organizationId,id:{in:attemptIds}}});
    await tx.testAssignment.deleteMany({where:scope});
    await tx.frozenNorm.deleteMany({where:{organizationId,campaignId:{in:campaigns}}});
    await tx.membership.delete({where:{id}});
    // A user shared with another organization keeps that account and its data.
    if (await tx.membership.count({where:{userId}}) === 0) {
      await tx.verification.deleteMany({where:{identifier:current.user.email}});
      await tx.user.delete({where:{id:userId}}); // includes auth accounts/sessions
    }
    await tx.auditLog.create({data:{organizationId,action:"pilot.retention_erased",detail:{deletedParticipants:1,policy:"three_calendar_months_from_registration"}}});
    return true;
  }, {timeout:30000});
}

export async function sweepPilotRetention(now = new Date()) {
  // Three calendar months are at least 89 days; check the exact deadline above.
  const candidates = await db.membership.findMany({
    where:{role:"employee",organization:{purpose:"pilot"},user:{platformAdmin:false},createdAt:{lte:new Date(now.getTime()-89*86400000)}},
    select:{id:true},orderBy:{createdAt:"asc"},take:500,
  });
  let deleted = 0, failed = 0;
  for (const candidate of candidates) {
    try { if (await eraseExpiredPilotParticipant(candidate.id,now)) deleted++; }
    catch { failed++; console.error("Pilot retention: deletion failed; retry scheduled"); }
  }
  return {deleted,failed};
}

export function startPilotRetention() {
  let busy = false;
  const sweep = async () => {
    if (busy) return;
    busy = true;
    try { await sweepPilotRetention(); }
    catch { console.error("Pilot retention sweep failed; retry scheduled"); }
    finally { busy = false; }
  };
  void sweep();
  return setInterval(sweep, 60000);
}
