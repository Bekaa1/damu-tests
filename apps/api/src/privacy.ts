import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { z } from "zod";
import { db, audit } from "./db";
import { orgId, participant, requireRole, type Context } from "./access";
import { removeStoredFiles } from "./storage";
export async function exportPersonalData(ctx: Context, id: string) {
  requireRole(ctx, "admin");
  const organizationId = orgId(ctx);
  const member = await participant(ctx, id);
  const user = await db.user.findUniqueOrThrow({
    where: { id: member.userId },
    select: { name: true, email: true, locale: true, createdAt: true },
  });
  const assignments = await db.testAssignment.findMany({
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
  const reports = await db.finalReport.findMany({
      where: { organizationId, membershipId: id },
    }),
    observations = await db.expertObservation.findMany({
      where: { organizationId, membershipId: id },
    }),
    ai = await db.aiReport.findMany({
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
  const files = await db.fileAsset.findMany({
    where: { organizationId, membershipId: id },
    select: {
      id: true,
      name: true,
      contentType: true,
      size: true,
      createdAt: true,
    },
  });
  await audit(organizationId, ctx.user.id, "personal_data.exported", id);
  return {
    exportedAt: new Date(),
    member,
    user,
    assignments,
    reports,
    observations,
    ai,
    files,
  };
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
  // Block access first. A storage failure leaves a blocked, recoverable database record.
  await db.membership.update({ where: { id }, data: { status: "blocked" } });
  await db.session.deleteMany({ where: { userId: user.id } });
  await removeStoredFiles(organizationId, id);
  await db.$transaction(async (tx) => {
    const tasks = await tx.testAssignment.findMany({
      where: { organizationId, membershipId: id },
      select: { id: true },
    });
    const attempts = await tx.testAttempt.findMany({
        where: { organizationId, assignmentId: { in: tasks.map((t) => t.id) } },
        select: { id: true },
      }),
      ids = attempts.map((a) => a.id);
    await tx.userAnswer.deleteMany({
      where: { organizationId, attemptId: { in: ids } },
    });
    await tx.testResult.deleteMany({
      where: { organizationId, attemptId: { in: ids } },
    });
    await tx.testAttempt.deleteMany({
      where: { organizationId, id: { in: ids } },
    });
    await tx.testAssignment.deleteMany({
      where: { organizationId, membershipId: id },
    });
    await tx.aiReport.deleteMany({
      where: { organizationId, membershipId: id },
    });
    await tx.finalReport.deleteMany({
      where: { organizationId, membershipId: id },
    });
    await tx.expertObservation.deleteMany({
      where: { organizationId, membershipId: id },
    });
    await tx.fileAsset.deleteMany({
      where: { organizationId, membershipId: id },
    });
    await tx.membership.delete({ where: { id } });
    if ((await tx.membership.count({ where: { userId: user.id } })) === 0)
      await tx.user.delete({ where: { id: user.id } });
  });
  await audit(organizationId, ctx.user.id, "personal_data.erased", id);
  return { ok: true };
}
