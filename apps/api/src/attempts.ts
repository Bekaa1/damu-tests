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
  return db.testAssignment.findMany({
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
      testVersion: { include: { keys: { orderBy: { createdAt: "desc" } } } },
    },
  });
  if (!assignment) throw new NotFoundException("Назначение не найдено");
  const existing = await db.testAttempt.findFirst({
    where: { assignmentId: id },
    orderBy: { attemptNumber: "desc" },
  });
  if (existing) return { id: existing.id };
  if (
    assignment.campaign.status !== "active" ||
    assignment.campaign.endsAt < new Date()
  )
    throw new BadRequestException("Срок кампании завершён");
  if (assignment.testVersion.status !== "published")
    throw new BadRequestException("Методика недоступна");
  const key = assignment.testVersion.keys[0];
  if (!key) throw new BadRequestException("Ключ оценивания не настроен");
  const attempt = await db.testAttempt.upsert({
    where: {
      assignmentId_attemptNumber: { assignmentId: id, attemptNumber: 1 },
    },
    update: {},
    create: {
      organizationId: orgId(ctx),
      assignmentId: id,
      language,
      scoringKeyId: key.id,
      expiresAt: assignment.testVersion.timeLimitSeconds
        ? new Date(Date.now() + assignment.testVersion.timeLimitSeconds * 1000)
        : null,
    },
  });
  await audit(orgId(ctx), ctx.user.id, "attempt.started", attempt.id);
  return { id: attempt.id };
}
export async function getAttempt(ctx: Context, id: string) {
  const attempt = await ownedAttempt(ctx, id);
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
    durationMinutes: version.durationMinutes,
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
    if (current.expiresAt && current.expiresAt < new Date())
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
    if (current.status === "completed")
      return {
        resultId: current.results[0].id,
        campaignId: attempt.assignment.campaignId,
        membershipId: attempt.assignment.membershipId,
      };
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
