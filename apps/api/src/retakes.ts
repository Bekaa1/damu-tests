import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { db, json } from "./db";
import { orgId, requireRole, type Context } from "./access";

export async function assignRetakes(
  ctx: Context,
  membershipId: string,
  input: unknown,
) {
  requireRole(ctx, "admin");
  const data = z
    .object({
      campaignId: z.string().min(1),
      attempts: z
        .array(
          z
            .object({
              assignmentId: z.string().min(1),
              previousAttemptId: z.string().min(1),
            })
            .strict(),
        )
        .min(1)
        .max(30),
      reason: z.string().trim().min(10).max(2000),
    })
    .strict()
    .parse(input);
  if (
    new Set(data.attempts.map((a) => a.assignmentId)).size !==
    data.attempts.length
  )
    throw new BadRequestException("Один тест выбран несколько раз");
  const organizationId = orgId(ctx);
  return db.$transaction(async (tx) => {
    const member = await tx.membership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        role: "employee",
        status: "active",
      },
      include: { user: { select: { locale: true } } },
    });
    const campaign = await tx.campaign.findFirst({
      where: { id: data.campaignId, organizationId },
    });
    if (!member || !campaign)
      throw new NotFoundException("Участник или кампания недоступны");
    if (campaign.status !== "active" || campaign.endsAt <= new Date())
      throw new BadRequestException(
        "Для повторного прохождения нужна активная кампания",
      );
    const created = [];
    // A consistent lock order also serializes simultaneous admin requests.
    for (const selected of [...data.attempts].sort((a, b) =>
      a.assignmentId.localeCompare(b.assignmentId),
    )) {
      await tx.$queryRaw`SELECT id FROM test_assignments WHERE id=${selected.assignmentId} AND "organizationId"=${organizationId} FOR UPDATE`;
      const assignment = await tx.testAssignment.findFirst({
        where: {
          id: selected.assignmentId,
          organizationId,
          membershipId,
          campaignId: data.campaignId,
        },
        include: {
          testVersion: {
            include: { keys: { orderBy: { createdAt: "desc" }, take: 1 } },
          },
        },
      });
      if (!assignment) throw new NotFoundException("Назначение недоступно");
      await tx.$queryRaw`SELECT id FROM test_attempts WHERE id=${selected.previousAttemptId} AND "assignmentId"=${assignment.id} FOR UPDATE`;
      const previous = await tx.testAttempt.findFirst({
        where: { assignmentId: assignment.id },
        orderBy: { attemptNumber: "desc" },
      });
      if (
        !previous ||
        previous.id !== selected.previousAttemptId ||
        !["completed", "retry_required", "expired"].includes(previous.status)
      )
        throw new ConflictException(
          "Состояние тестов изменилось. Обновите карточку: повтор доступен только для завершённых тестов.",
        );
      const key = assignment.testVersion.keys[0];
      if (assignment.testVersion.status !== "published" || !key)
        throw new BadRequestException(
          "Методика не опубликована или не имеет ключа оценивания",
        );
      const attempt = await tx.testAttempt.create({
        data: {
          organizationId,
          assignmentId: assignment.id,
          attemptNumber: previous.attemptNumber + 1,
          language: member.user.locale === "kk" ? "kk" : "ru",
          scoringKeyId: key.id,
          // Answers, timer and deadline are empty until the employee starts.
          status: "in_progress",
          expiresAt: null,
        },
      });
      created.push({
        assignmentId: assignment.id,
        previousAttemptId: previous.id,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: ctx.user.id,
        action: "incident.retake_assigned",
        entityId: membershipId,
        detail: json({
          campaignId: data.campaignId,
          reason: data.reason,
          attempts: created,
        }),
      },
    });
    return { attempts: created };
  });
}
