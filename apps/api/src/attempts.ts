import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { createHash } from "node:crypto";
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
  content: q.content ?? {},
  imageUrl: q.imageUrl ?? undefined,
  options: q.options.map((o: any) => ({
    id: o.id,
    text: o.text,
    imageUrl: o.imageUrl ?? undefined,
  })),
});
const optionOrder = (attempt: string, option: string) =>
  createHash("sha256")
    .update(attempt + option)
    .digest()
    .readUInt32BE();
const deliveredQuestions = (v: any, id: string) =>
  v.questions
    .map(questionDTO)
    .map((q: QuestionInput) => ({
      ...q,
      options:
        v.delivery?.shuffleOptions || q.type === "ranking"
          ? [...q.options].sort(
              (a, b) => optionOrder(id, a.id) - optionOrder(id, b.id),
            )
          : q.options,
    }));
// Heartbeats identify a live test page. An explicit leave keeps the clock running.
// Missing heartbeats while that page is active pause at the last confirmed interval.
export async function settleClock(id: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM test_attempts WHERE id = ${id} FOR UPDATE`;
    const a = await tx.testAttempt.findUnique({ where: { id } });
    if (
      a?.status === "in_progress" &&
      a.expiresAt &&
      a.lastHeartbeatAt &&
      !a.pausedAt &&
      Date.now() - a.lastHeartbeatAt.getTime() > 15000
    ) {
      const pausedAt = new Date(a.lastHeartbeatAt.getTime() + 5000);
      // A deadline already reached before connection loss must still finish.
      if (pausedAt < a.expiresAt)
        return tx.testAttempt.update({ where: { id }, data: { pausedAt } });
    }
    return a;
  });
}
export async function presence(ctx: Context, id: string, input: unknown) {
  const { action } = z
    .object({ action: z.enum(["begin", "heartbeat", "leave"]) })
    .parse(input);
  const owned = await ownedAttempt(ctx, id);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM test_attempts WHERE id = ${id} FOR UPDATE`;
    const a = await tx.testAttempt.findUniqueOrThrow({ where: { id } });
    const now = new Date();
    if (a.status !== "in_progress") return { status: a.status };
    if (action === "begin" && !a.timerStartedAt) {
      const limit = owned.assignment.testVersion.timeLimitSeconds;
      return tx.testAttempt.update({
        where: { id },
        data: {
          timerStartedAt: now,
          expiresAt: limit ? new Date(now.getTime() + limit * 1000) : null,
          lastHeartbeatAt: limit ? now : null,
        },
      });
    }
    if (!a.timerStartedAt) return { status: a.status };
    let pause = a.pausedAt;
    if (
      !pause &&
      a.expiresAt &&
      a.lastHeartbeatAt &&
      now.getTime() - a.lastHeartbeatAt.getTime() > 15000 &&
      a.lastHeartbeatAt.getTime() + 5000 < a.expiresAt.getTime()
    )
      pause = new Date(a.lastHeartbeatAt.getTime() + 5000);
    const expiresAt =
      a.expiresAt && pause
        ? new Date(a.expiresAt.getTime() + now.getTime() - pause.getTime())
        : a.expiresAt;
    const updated = await tx.testAttempt.update({
      where: { id },
      data: {
        expiresAt,
        pausedAt: null,
        lastHeartbeatAt: action === "leave" ? null : expiresAt ? now : null,
      },
    });
    return { ...updated, serverTime: now };
  });
}
export function startAttemptSweeper() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const rows = await db.testAttempt.findMany({
        where: {
          status: "in_progress",
          expiresAt: { lte: new Date(Date.now() + 20000) },
        },
        select: {
          id: true,
          assignment: {
            select: {
              membership: { include: { user: true, organization: true } },
            },
          },
        },
      });
      for (const row of rows) {
        const a = await settleClock(row.id);
        if (a?.expiresAt && !a.pausedAt && a.expiresAt <= new Date()) {
          const m = row.assignment.membership;
          await submitAttempt(
            { member: m, user: m.user, org: m.organization, role: "employee" },
            row.id,
          );
        }
      }
    } catch (e) {
      console.error("Attempt finalization failed", e);
    } finally {
      busy = false;
    }
  }, 5000);
  timer.unref();
  return timer;
}
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
    if (latest?.status === "in_progress") {
      await settleClock(latest.id);
      const current = await db.testAttempt.findUniqueOrThrow({
        where: { id: latest.id },
      });
      Object.assign(latest, current);
      if (
        current.expiresAt &&
        !current.pausedAt &&
        current.expiresAt <= new Date()
      )
        latest.status = (await submitAttempt(ctx, latest.id)).status;
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
    await settleClock(existing.id);
    const current = await ownedAttempt(ctx, existing.id);
    if (
      current.expiresAt &&
      !current.pausedAt &&
      current.expiresAt <= new Date()
    ) {
      await submitAttempt(ctx, existing.id);
      return { id: existing.id };
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
        expiresAt: null,
      },
    });
  });
  await audit(orgId(ctx), ctx.user.id, "attempt.started", attempt.id);
  return { id: attempt.id };
}
export async function getAttempt(ctx: Context, id: string) {
  await ownedAttempt(ctx, id);
  await settleClock(id);
  let attempt = await ownedAttempt(ctx, id);
  if (
    attempt.status === "in_progress" &&
    attempt.expiresAt &&
    !attempt.pausedAt &&
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
    timerStartedAt: attempt.timerStartedAt,
    pausedAt: attempt.pausedAt,
    serverTime: new Date(),
    delivery: version.delivery,
    campaignId: attempt.assignment.campaignId,
    name: version.test.name,
    instructions: version.instructions,
    questions: version.questions.map(questionDTO).map((q) => ({
      ...q,
      options:
        (version.delivery as any)?.shuffleOptions || q.type === "ranking"
          ? [...q.options].sort(
              (a, b) => optionOrder(id, a.id) - optionOrder(id, b.id),
            )
          : q.options,
    })),
    answers: answers.map((a) => ({
      questionId: a.questionId,
      value: a.value,
      revision: a.revision,
      durationMs: a.durationMs,
    })),
    durationMinutes: version.durationMinutes,
    timeLimitSeconds: version.timeLimitSeconds,
    responseScale: { min: config.min ?? 1, max: config.max ?? 5 },
  };
}
export async function saveAnswer(ctx: Context, id: string, input: unknown) {
  const data = z
    .object({
      questionId: z.string(),
      value: z.unknown(),
      revision: z.number().int().min(0),
      durationMs: z.number().int().min(0).max(86400000).optional(),
    })
    .parse(input);
  await ownedAttempt(ctx, id);
  await settleClock(id);
  const attempt = await ownedAttempt(ctx, id);
  if (!attempt.timerStartedAt)
    throw new BadRequestException("Сначала начните основной тест");
  if (attempt.status === "expired")
    throw new ConflictException(
      "Время истекло. Сохранённые ответы будут засчитаны.",
    );
  if (
    attempt.expiresAt &&
    !attempt.pausedAt &&
    attempt.expiresAt <= new Date()
  ) {
    await submitAttempt(ctx, id);
    throw new ConflictException(
      "Время истекло. Сохранённые ответы будут засчитаны.",
    );
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
    if (
      current.expiresAt &&
      !current.pausedAt &&
      current.expiresAt <= new Date()
    )
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
        durationMs: data.durationMs ?? 0,
      },
      update: {
        value: json(value),
        revision: { increment: 1 },
        durationMs: data.durationMs,
      },
    });
    return { revision: result.revision, savedAt: result.updatedAt };
  });
}
export async function submitAttempt(ctx: Context, id: string) {
  await ownedAttempt(ctx, id);
  await settleClock(id);
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
    const answered = new Set(
      current.answers.map((answer) => answer.questionId),
    );
    const allAnswered = questions.every((question) =>
      answered.has(question.id),
    );
    const timeExpired = Boolean(
      current.expiresAt && current.expiresAt <= new Date(),
    );
    if (!current.timerStartedAt)
      throw new BadRequestException("Сначала начните основной тест");
    if (!allAnswered && !attempt.assignment.testVersion.timeLimitSeconds)
      throw new BadRequestException(
        "Ответьте на все вопросы перед завершением",
      );
    const key = await tx.scoringKey.findUniqueOrThrow({
      where: { id: current.scoringKeyId },
    });
    let score;
    try {
      score = calculateScore(
        key.algorithm,
        key.config as ScoringConfig,
        deliveredQuestions(attempt.assignment.testVersion, id),
        Object.fromEntries(current.answers.map((a) => [a.questionId, a.value])),
        {
          allowMissing: Boolean(
            attempt.assignment.testVersion.timeLimitSeconds,
          ),
          durations: Object.fromEntries(
            current.answers.map((a) => [a.questionId, a.durationMs]),
          ),
          elapsedMs:
            attempt.assignment.testVersion.timeLimitSeconds && current.expiresAt
              ? Math.max(
                  0,
                  attempt.assignment.testVersion.timeLimitSeconds * 1000 -
                    (current.expiresAt.getTime() - Date.now()),
                )
              : undefined,
        },
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
    {
      allowMissing: Boolean(attempt.assignment.testVersion.timeLimitSeconds),
      durations: Object.fromEntries(
        attempt.answers.map((a) => [a.questionId, a.durationMs]),
      ),
    },
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
export async function reviewResult(ctx: Context, id: string, input: unknown) {
  requireRole(ctx, "expert");
  const data = z
    .object({
      action: z.enum(["accept", "repeat"]),
      reason: z.string().trim().min(5).max(2000),
    })
    .parse(input);
  const r = await db.testResult.findFirst({
    where: { id, organizationId: orgId(ctx) },
    include: { attempt: { include: { assignment: true } } },
  });
  if (!r) throw new NotFoundException();
  await participant(
    ctx,
    r.attempt.assignment.membershipId,
    r.attempt.assignment.campaignId,
  );
  if (!(r.result as any).reviewRequired)
    throw new BadRequestException("Результат не ожидает проверки");
  await db.$transaction(async (tx) => {
    if (data.action === "accept")
      await tx.testResult.update({
        where: { id },
        data: {
          result: json({
            ...(r.result as object),
            reviewRequired: false,
            qualityReview: {
              by: ctx.user.id,
              at: new Date().toISOString(),
              reason: data.reason,
            },
          }),
        },
      });
    else
      await tx.testAttempt.update({
        where: { id: r.attemptId },
        data: { status: "expired" },
      });
    await tx.auditLog.create({
      data: {
        organizationId: orgId(ctx),
        actorId: ctx.user.id,
        action: "result.quality_" + data.action,
        entityId: id,
        detail: json(data),
      },
    });
  });
  return { ok: true };
}
