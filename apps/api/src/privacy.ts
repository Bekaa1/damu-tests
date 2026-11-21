import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { z } from "zod";
import { db } from "./db";
import { withParticipantWriteFence } from "./participant-write";
import { orgId, participant, requireRole, type Context } from "./access";
import { eraseParticipantData } from "./pilot-retention";
export async function exportPersonalData(ctx: Context, id: string) {
  requireRole(ctx, "admin");
  const organizationId = orgId(ctx);
  await participant(ctx, id);
  return withParticipantWriteFence(organizationId, [id], async tx => {
    const member = await tx.membership.findUniqueOrThrow({ where: { id, organizationId } });
    const user = await tx.user.findUniqueOrThrow({
      where: { id: member.userId },
      select: { name: true, email: true, locale: true, createdAt: true },
    });
    const assignments = await tx.testAssignment.findMany({
      where: { organizationId, membershipId: id },
      include: {
        testVersion: {
          select: {
            id: true,
            version: true,
            test: { select: { name: true, source: true } },
          },
        },
        attempts: { include: { answers: true, results: true } },
      },
    });
    const reports = await tx.finalReport.findMany({
        where: { organizationId, membershipId: id },
      }),
      observations = await tx.expertObservation.findMany({
        where: { organizationId, membershipId: id },
      }),
      ai = await tx.aiReport.findMany({
        where: { organizationId, membershipId: id },
        select: {
          id: true,
          campaignId: true,
          status: true,
          content: true,
          model: true,
          promptVersion: true,
          resultIds: true,
          createdAt: true,
        },
      });
    const files = await tx.fileAsset.findMany({
      where: { organizationId, membershipId: id },
      select: {
        id: true,
        name: true,
        contentType: true,
        size: true,
        createdAt: true,
      },
    });
    const generatedReports = await tx.generatedReport.findMany({
      where: { organizationId, membershipId: id },
      select: {
        id: true,
        campaignId: true,
        status: true,
        content: true,
        snapshot: true,
        createdAt: true,
      },
    });
    const exported = {
      exportedAt: new Date(),
      member,
      user,
      assignments,
      reports,
      observations,
      ai,
      files,
      generatedReports,
      groupAssignments: await tx.participantGroup.findMany({
        where: { organizationId, membershipId: id },
        include: { scheme: true },
      }),
      competencyConsensus: await tx.competencyConsensus.findMany({
        where: { organizationId, membershipId: id },
      }),
    };
    await tx.auditLog.create({ data: {
      organizationId, actorId: ctx.user.id, action: "personal_data.exported", entityId: id,
    } });
    return exported;
  });
}
export async function erasePersonalData(
  ctx: Context,
  id: string,
  input: unknown,
) {
  requireRole(ctx, "admin");
  const { confirmEmail } = z.object({ confirmEmail: z.email() }).parse(input);
  const organizationId = orgId(ctx),
    member = await participant(ctx, id);
  const user = await db.user.findUniqueOrThrow({
    where: { id: member.userId },
  });
  if (
    member.role !== "employee" ||
    user.platformAdmin ||
    user.id === ctx.user.id
  )
    throw new ForbiddenException(
      "Удаление доступно только для учётной записи сотрудника",
    );
  if (confirmEmail.toLowerCase() !== user.email.toLowerCase())
    throw new BadRequestException("Email подтверждения не совпадает");
  // Shared tenant-scoped path handles report snapshots, file references, audit
  // PII and SQL cascades. Never revoke a shared user's global sessions here.
  const erased = await eraseParticipantData(organizationId, id);
  if (!erased) throw new ForbiddenException("Участник недоступен для удаления");
  return { ok: true };
}
