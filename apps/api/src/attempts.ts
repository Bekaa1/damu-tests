import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { db, audit, json } from "./db";
import { orgId, requireRole, participant, type Context } from "./access";
import {
  calculateScore,
  validateAnswer,
  type QuestionInput,
  type ScoringConfig,
} from "../../../packages/core/scoring";
export const questionDTO = (q: any): QuestionInput => ({
  id: q.id,
  type: q.type,
  text: q.text,
  imageUrl: q.imageUrl ?? undefined,
  options: q.options.map((o: any) => ({
    id: o.id,
    text: o.text,
    imageUrl: o.imageUrl ?? undefined,
  })),
});
export async function myAssignments(ctx: Context, campaignId?: string) {
  if (!ctx.member) throw new ForbiddenException();
  const assignments = await db.testAssignment.findMany({
    where: {
      organizationId: orgId(ctx),
      membershipId: ctx.member.id,
      ...(campaignId ? { campaignId } : {}),
    },
    include: {
      campaign: true,
      testVersion: {
        include: { test: true, _count: { select: { questions: true } } },
      },
      attempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
        include: { _count: { select: { answers: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const assignment of assignments) {
    const latest = assignment.attempts[0];
    if (!latest || latest.status !== "in_progress") continue;
    const limitSeconds = assignment.testVersion._count.questions * 60;
    const deadline =
      latest.expiresAt ??
      new Date(latest.startedAt.getTime() + limitSeconds * 1000);
    if (!latest.expiresAt) {
      await db.testAttempt.update({
        where: { id: latest.id },
        data: { expiresAt: deadline },
      });
      latest.expiresAt = deadline;
    }
    if (deadline <= new Date()) {
      const outcome = await submitAttempt(ctx, latest.id);
      latest.status = outcome.status;
    }
  }
  return assignments;
}
async function ownedAttempt(ctx: Context, id: string) {
  const attempt = await db.testAttempt.findFirst({
    where: { id, organizationId: orgId(ctx) },
    include: {
      assignment: {
        include: {
          campaign: true,
          testVersion: {
            include: {
              test: true,
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
  if (!attempt || attempt.assignment.membershipId !== ctx.member?.id)
    throw new NotFoundException("Прохождение не найдено");
  if (attempt.status === "in_progress" && !attempt.expiresAt) {
    const expiresAt = new Date(
      attempt.startedAt.getTime() +
        attempt.assignment.testVersion.questions.length * 60_000,
    );
    await db.testAttempt.update({ where: { id }, data: { expiresAt } });
    attempt.expiresAt = expiresAt;
  }
  return attempt;
}
export async function startAttempt(ctx: Context, id: string, input: unknown) {
  requireRole(ctx, "employee");
  if (!ctx.member?.consentAt)
    throw new ForbiddenException("Подтвердите согласие на обработку данных");
  const { language } = z
    .object({ language: z.enum(["ru", "kk"]) })
    .parse(input);
  const assignment = await db.testAssignment.findFirst({
    where: { id, organizationId: orgId(ctx), membershipId: ctx.member.id },
    include: {
      campaign: true,
      testVersion: {
        include: {
          keys: { orderBy: { createdAt: "desc" } },
          _count: { select: { questions: true } },
        },
      },
    },
  });
  if (!assignment) throw new NotFoundException("Назначение не найдено");
  const existing = await db.testAttempt.findFirst({
    where: { assignmentId: id },
    orderBy: { attemptNumber: "desc" },
  });
  if (existing?.status === "completed") return { id: existing.id };
  if (existing?.status === "in_progress") {
    const current = await ownedAttempt(ctx, existing.id);
    if (current.expiresAt && current.expiresAt <= new Date()) {
      await submitAttempt(ctx, existing.id);
    } else {
      return { id: existing.id };
    }
  }
  if (
    assignment.campaign.status !== "active" ||
    assignment.campaign.endsAt < new Date()
  )
    throw new BadRequestException("Срок кампании завершён");
  if (assignment.testVersion.status !== "published")
    throw new BadRequestException("Методика недоступна");
  const key = assignment.testVersion.keys[0];
  if (!key) throw new BadRequestException("Ключ оценивания не настроен");
  const attempt = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM test_assignments WHERE id = ${id} FOR UPDATE`;
    const latest = await tx.testAttempt.findFirst({
      where: { assignmentId: id },
      orderBy: { attemptNumber: "desc" },
    });
    if (latest && latest.status !== "expired") return latest;
    return tx.testAttempt.create({
      data: {
        organizationId: orgId(ctx),
        assignmentId: id,
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
        language,
        scoringKeyId: key.id,
        expiresAt: new Date(
          Date.now() + assignment.testVersion._count.questions * 60_000,
        ),
      },
    });
  });
  await audit(orgId(ctx), ctx.user.id, "attempt.started", attempt.id);
  return { id: attempt.id };
}
export async function getAttempt(ctx: Context, id: string) {
  let attempt = await ownedAttempt(ctx, id);
  if (
    attempt.status === "in_progress" &&
    attempt.expiresAt &&
    attempt.expiresAt <= new Date()
  ) {
    await submitAttempt(ctx, id);
    attempt = await ownedAttempt(ctx, id);
  }
  const answers = await db.userAnswer.findMany({
    where: { attemptId: id, organizationId: orgId(ctx) },
  });
  const version = attempt.assignment.testVersion;
  const key = await db.scoringKey.findUniqueOrThrow({
    where: { id: attempt.scoringKeyId },
  });
  const config = key.config as ScoringConfig;
  return {
    id: attempt.id,
    language: attempt.language,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    campaignId: attempt.assignment.campaignId,
    name: version.test.name,
    instructions: version.instructions,
    questions: version.questions.map(questionDTO),
    answers: answers.map((a) => ({
      questionId: a.questionId,
      value: a.value,
      revision: a.revision,
    })),
    durationMinutes: version.questions.length,
    responseScale: { min: config.min ?? 1, max: config.max ?? 5 },
  };
}
export async function saveAnswer(ctx: Context, id: string, input: unknown) {
  const data = z
    .object({
      questionId: z.string(),
      value: z.unknown(),
      revision: z.number().int().min(0),
    })
    .parse(input);
  const attempt = await ownedAttempt(ctx, id);
  if (attempt.status === "expired")
    throw new ConflictException("Время истекло. Начните тест заново.");
  if (attempt.expiresAt && attempt.expiresAt <= new Date()) {
    await submitAttempt(ctx, id);
    throw new ConflictException("Время истекло. Начните тест заново.");
  }
  const question = attempt.assignment.testVersion.questions.find(
    (q) => q.id === data.questionId,
  );
  if (!question)
    throw new BadRequestException("Вопрос не относится к прохождению");
  const key = await db.scoringKey.findUniqueOrThrow({
    where: { id: attempt.scoringKeyId },
  });
  let value;
  try {
    value = validateAnswer(
      questionDTO(question),
      data.value,
      key.config as ScoringConfig,
    );
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM test_attempts WHERE id = ${id} FOR UPDATE`;
    const current = await tx.testAttempt.findUniqueOrThrow({ where: { id } });
    if (current.status !== "in_progress")
      throw new ConflictException("Тест уже завершён");
    if (current.expiresAt && current.expiresAt <= new Date())
      throw new ConflictException("Время прохождения истекло");
    const previous = await tx.userAnswer.findUnique({
      where: {
        attemptId_questionId: { attemptId: id, questionId: data.questionId },
      },
    });
    if ((previous?.revision ?? 0) !== data.revision)
      throw new ConflictException(
        "Ответ изменён в другой вкладке. Обновите страницу.",
      );
    const result = await tx.userAnswer.upsert({
      where: {
        attemptId_questionId: { attemptId: id, questionId: data.questionId },
      },
      create: {
        organizationId: orgId(ctx),
        attemptId: id,
        questionId: data.questionId,
        value: json(value),
        revision: 1,
      },
      update: { value: json(value), revision: { increment: 1 } },
    });
    return { revision: result.revision, savedAt: result.updatedAt };
  });
}
export async function submitAttempt(ctx: Context, id: string) {
  const attempt = await ownedAttempt(ctx, id);
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM test_attempts WHERE id = ${id} FOR UPDATE`;
    const current = await tx.testAttempt.findUniqueOrThrow({
      where: { id },
      include: { answers: true, results: { orderBy: { createdAt: "asc" } } },
    });
    if (current.status === "expired") return { status: "expired" as const };
    if (current.status === "completed")
      return {
        status: "completed" as const,
        resultId: current.results[0].id,
        campaignId: attempt.assignment.campaignId,
        membershipId: attempt.assignment.membershipId,
      };
    const questions = attempt.assignment.testVersion.questions;
    const answered = new Set(current.answers.map((answer) => answer.questionId));
    const allAnswered = questions.every((question) => answered.has(question.id));
    const timeExpired = Boolean(
      current.expiresAt && current.expiresAt <= new Date(),
    );
    if (timeExpired && !allAnswered) {
      await tx.testAttempt.update({
        where: { id },
        data: { status: "expired" },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId(ctx),
          actorId: ctx.user.id,
          action: "attempt.expired",
          entityId: id,
        },
      });
      return { status: "expired" as const };
    }
    if (!allAnswered)
      throw new BadRequestException("Ответьте на все вопросы перед завершением");
    const key = await tx.scoringKey.findUniqueOrThrow({
      where: { id: current.scoringKeyId },
    });
    let score;
    try {
      score = calculateScore(
        key.algorithm,
        key.config as ScoringConfig,
        attempt.assignment.testVersion.questions.map(questionDTO),
        Object.fromEntries(current.answers.map((a) => [a.questionId, a.value])),
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const result = await tx.testResult.create({
      data: {
        organizationId: orgId(ctx),
        attemptId: id,
        scoringKeyId: key.id,
        result: json(score),
      },
    });
    await tx.testAttempt.update({
      where: { id },
      data: { status: "completed", submittedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId(ctx),
        actorId: ctx.user.id,
        action: "attempt.completed",
        entityId: id,
      },
    });
    return {
      status: "completed" as const,
      resultId: result.id,
      campaignId: attempt.assignment.campaignId,
      membershipId: attempt.assignment.membershipId,
    };
  });
  return result;
}
export async function recalculate(ctx: Context, id: string, keyId: string) {
  requireRole(ctx, "superadmin");
  const attempt = await db.testAttempt.findFirst({
    where: { id, organizationId: orgId(ctx), status: "completed" },
    include: {
      answers: true,
      assignment: {
        include: {
          testVersion: {
            include: { questions: { include: { options: true } } },
          },
        },
      },
    },
  });
  if (!attempt) throw new NotFoundException();
  const key = await db.scoringKey.findFirst({
    where: { id: keyId, testVersionId: attempt.assignment.testVersionId },
  });
  if (!key) throw new BadRequestException("Ключ не относится к методике");
  const result = calculateScore(
    key.algorithm,
    key.config as ScoringConfig,
    attempt.assignment.testVersion.questions.map(questionDTO),
    Object.fromEntries(attempt.answers.map((a) => [a.questionId, a.value])),
  );
  const created = await db.testResult.upsert({
    where: { attemptId_scoringKeyId: { attemptId: id, scoringKeyId: keyId } },
    update: {},
    create: {
      organizationId: orgId(ctx),
      attemptId: id,
      scoringKeyId: keyId,
      result: json(result),
      reason: "manual_recalculation",
      calculatedBy: ctx.user.id,
    },
  });
  await audit(orgId(ctx), ctx.user.id, "result.recalculated", created.id);
  return created;
}
