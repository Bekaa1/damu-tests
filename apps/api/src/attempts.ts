import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { requiresCamera } from "./video-scope";
import { requireRecording } from "./video";
import { heartbeatGapMs } from "./attempt-journal";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db, audit, json } from "./db";
import { withParticipantWriteFence } from "./participant-write";
import { answerWithinWindow } from "../../../packages/core/assessment-policy";
import { hasCurrentConsent, pilotCanStart } from "../../../packages/core/pilot";
import { participantDeletionDate } from "../../../packages/core/data-policy";
import { queueCompletedAssessment } from "./report-lifecycle";
import { assessmentCompletion } from "../../../packages/core/result-validity";
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
  v.questions.map(questionDTO).map((q: QuestionInput) => ({
    ...q,
    options:
      v.delivery?.shuffleOptions || q.type === "ranking"
        ? [...q.options].sort(
            (a, b) => optionOrder(id, a.id) - optionOrder(id, b.id),
          )
        : q.options,
  }));
// Heartbeats record presence only. They never extend or pause the server deadline.
export async function settleClock(id: string) {
  return db.testAttempt.findUnique({ where: { id } });
}
export async function presence(ctx: Context, id: string, input: unknown) {
  const { action, eventId, at, videoSession } = z
    .object({
      action: z.enum(["begin", "heartbeat", "leave", "return"]),
      videoSession: z.uuid().optional(),
      eventId: z.string().max(100).optional(),
      at: z.iso.datetime().optional(),
    })
    .parse(input);
  if (!ctx.member) throw new NotFoundException("Прохождение не найдено");
  const scope = { id, organizationId: orgId(ctx), assignment: { membershipId: ctx.member.id } };
  if (!eventId && !at && (action === "heartbeat" || action === "return")) {
    // An ordinary keep-alive has no event to audit. If a return closes an
    // absence, fall through to the locked path that records its duration.
    const now = new Date();
    const [updated] = await db.testAttempt.updateManyAndReturn({
      where: {
        ...scope,
        timerStartedAt: { not: null },
        lastHeartbeatAt: { gt: new Date(now.getTime() - heartbeatGapMs) },
        ...(action === "return" ? { leftAt: null } : {}),
      },
      data: { lastHeartbeatAt: now, pausedAt: null },
    });
    if (updated) return { ...updated, serverTime: now };
  }
  const owned = await db.testAttempt.findFirst({
    where: scope,
    select: { assignment: { select: { campaignId: true, testVersion: { select: { timeLimitSeconds: true } } } } },
  });
  if (!owned) throw new NotFoundException("Прохождение не найдено");
  if (action === "begin" && requiresCamera(orgId(ctx), owned.assignment.campaignId))
    await requireRecording(ctx, id, videoSession);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM test_attempts WHERE id = ${id} FOR UPDATE`;
    const a = await tx.testAttempt.findUniqueOrThrow({ where: { id } }),
      now = new Date();
    if (action === "begin" && !a.timerStartedAt && a.status === "in_progress") {
      const limit = owned.assignment.testVersion.timeLimitSeconds;
      const updated = await tx.testAttempt.update({
        where: { id },
        data: {
          timerStartedAt: now,
          expiresAt: limit ? new Date(now.getTime() + limit * 1000) : null,
          lastHeartbeatAt: now,
          pausedAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId(ctx),
          actorId: ctx.user.id,
          action: limit ? "attempt.timer_started" : "attempt.started",
          entityId: id,
          detail: json({ deadline: updated.expiresAt, limitSeconds: limit }),
        },
      });
      return { ...updated, serverTime: now };
    }
    if (!a.timerStartedAt) return { ...a, serverTime: now };
    // Keep-alive and visibility events can be retried after a network interruption.
    const duplicate =
      eventId &&
      (await tx.auditLog.findFirst({
        where: {
          organizationId: orgId(ctx),
          entityId: id,
          action: "attempt.presence",
          detail: { path: ["eventId"], equals: eventId },
        },
      }));
    if (duplicate) return { ...a, serverTime: now };
    const reported = at ? new Date(at) : now;
    const eventAt = new Date(
      Math.max(
        a.timerStartedAt.getTime(),
        Math.min(now.getTime(), reported.getTime()),
      ),
    );
    const changes: any = { lastHeartbeatAt: now, pausedAt: null };
    if (a.status === "in_progress" && a.lastHeartbeatAt &&
        now.getTime() - a.lastHeartbeatAt.getTime() >= heartbeatGapMs) {
      await tx.auditLog.create({ data: {
        organizationId: orgId(ctx), actorId: ctx.user.id, entityId: id,
        action: "attempt.heartbeat_gap",
        detail: json({ previousAt: a.lastHeartbeatAt, resumedAt: now }),
      } });
    }
    if (action === "leave" && !a.leftAt && a.status === "in_progress")
      Object.assign(changes, { leftAt: eventAt, departures: { increment: 1 } });
    if (action === "return" && a.leftAt) {
      const end = Math.min(
        eventAt.getTime(),
        a.submittedAt?.getTime() ?? a.expiresAt?.getTime() ?? now.getTime(),
      );
      Object.assign(changes, {
        awayMs: { increment: Math.max(0, end - a.leftAt.getTime()) },
        leftAt: null,
      });
    }
    const updated = await tx.testAttempt.update({
      where: { id },
      data: changes,
    });
    if (
      action !== "heartbeat" &&
      (eventId || action === "leave" || (action === "return" && a.leftAt))
    )
      await tx.auditLog.create({
        data: {
          organizationId: orgId(ctx),
          actorId: ctx.user.id,
          action: "attempt.presence",
          entityId: id,
          detail: json({
            action,
            eventId: eventId ?? null,
            at: eventAt,
            receivedAt: now,
          }),
        },
      });
    return { ...updated, serverTime: now };
  }, attemptTransactionOptions);
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
  const serverTime = new Date();
  // Presentation order is part of the assessment flow, not assignment creation time.
  const order = new Map<string, number>(
    ["verbal", "numerical", "logical", "personality", "motivation", "situations"]
      .map((testId, index) => [testId, index]),
  );
  return [...assignments]
    .sort((a, b) =>
      (order.get(a.testVersion.testId) ?? order.size) -
      (order.get(b.testVersion.testId) ?? order.size),
    )
    .map((a) => ({ ...a, serverTime }));
}
const attemptTransactionOptions = { maxWait: 20_000, timeout: 20_000 };

async function ownedAttempt(ctx: Context, id: string, questionId?: string) {
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
                ...(questionId ? { where: { id: questionId } } : {}),
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
  if (!ctx.member || !hasCurrentConsent(ctx.member, ctx.org))
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
  if (!pilotCanStart(ctx.org, assignment.campaign))
    throw new ForbiddenException(
      "Пилот ещё не открыт: организатор должен подтвердить разрешение работодателя",
    );
  const existing = await db.testAttempt.findFirst({
    where: { assignmentId: id },
    orderBy: { attemptNumber: "desc" },
  });
  if (existing?.status === "completed") return { id: existing.id };
  if (existing?.status === "in_progress") {
    if (
      assignment.campaign.status !== "active" ||
      assignment.campaign.endsAt < new Date()
    )
      throw new BadRequestException("Срок кампании завершён");
    if (!existing.timerStartedAt) {
      await db.testAttempt.updateMany({
        where: { id: existing.id, timerStartedAt: null, status: "in_progress" },
        data: { language },
      });
    }
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
    if (latest && !["expired", "retry_required"].includes(latest.status))
      return latest;
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
    videoRequired: requiresCamera(attempt.organizationId, attempt.assignment.campaignId),
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    timerStartedAt: attempt.timerStartedAt,
    pausedAt: attempt.pausedAt,
    serverTime: new Date(),
    delivery: version.delivery,
    campaignId: attempt.assignment.campaignId,
    dataDeletionAt: ctx.member?.role === "employee"
      ? participantDeletionDate(ctx.member.createdAt).toISOString() : null,
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
      answeredAt: z.iso.datetime().optional(),
    })
    .parse(input);
  const attempt = await ownedAttempt(ctx, id, data.questionId);
  if (!attempt.timerStartedAt)
    throw new BadRequestException("Сначала начните основной тест");
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
  const receivedAt = new Date(),
    answeredAt = data.answeredAt ? new Date(data.answeredAt) : receivedAt;
  const saved = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM test_attempts WHERE id = ${id} FOR UPDATE`;
    const current = await tx.testAttempt.findUniqueOrThrow({
      where: { id },
      include: { answers: { where: { questionId: data.questionId } } },
    });
    const latest = await tx.testAttempt.findFirst({
      where: { assignmentId: current.assignmentId },
      orderBy: { attemptNumber: "desc" },
      select: { id: true },
    });
    if (current.status === "expired" || latest?.id !== id)
      throw new ConflictException("Попытка заменена новым прохождением");
    const cutoff = current.manuallySubmittedAt ?? current.expiresAt;
    if (
      !answerWithinWindow(
        answeredAt,
        current.timerStartedAt!,
        cutoff,
        receivedAt,
      )
    )
      throw new ConflictException(
        "Ответ создан после завершения времени теста",
      );
    const previous = current.answers.find(
      (a) => a.questionId === data.questionId,
    );
    // A lost acknowledgement is safe to resend without increasing the revision.
    if (
      previous &&
      JSON.stringify(previous.value) === JSON.stringify(value) &&
      previous.answeredAt?.getTime() === answeredAt.getTime()
    )
      return {
        revision: previous.revision,
        savedAt: previous.updatedAt,
        delayed: previous.delayed,
      };
    if ((previous?.revision ?? 0) !== data.revision)
      throw new ConflictException(
        "Ответ изменён в другой вкладке. Обновите страницу.",
      );
    const delayed =
      Boolean(current.expiresAt && receivedAt > current.expiresAt) ||
      current.status === "completed";
    const answer = await tx.userAnswer.upsert({
      where: {
        attemptId_questionId: { attemptId: id, questionId: data.questionId },
      },
      create: {
        organizationId: orgId(ctx),
        attemptId: id,
        questionId: data.questionId,
        value: json(value),
        durationMs: data.durationMs ?? 0,
        answeredAt,
        receivedAt,
        delayed,
      },
      update: {
        value: json(value),
        durationMs: data.durationMs,
        answeredAt,
        receivedAt,
        delayed,
        revision: { increment: 1 },
      },
    });
    if (["completed", "retry_required"].includes(current.status)) {
      // A delayed answer can change a completed result. Re-score against the
      // entire form and the latest committed answers under the attempt lock.
      const all = await tx.userAnswer.findMany({ where: { attemptId: id } });
      const questions = await tx.question.findMany({
        where: { testVersionId: attempt.assignment.testVersionId },
        orderBy: { position: "asc" },
        include: { options: { orderBy: { position: "asc" } } },
      });
      const delivered = deliveredQuestions({ ...attempt.assignment.testVersion, questions }, id);
      const previousScore = await tx.testResult.findUniqueOrThrow({
        where: {
          attemptId_scoringKeyId: { attemptId: id, scoringKeyId: key.id },
        },
      });
      const validity = assessmentCompletion(
        delivered,
        Object.fromEntries(all.map((a) => [a.questionId, a.value])),
        key.config as ScoringConfig,
        key.algorithm === "scales",
      );
      const score = validity.eligible
        ? calculateScore(
            key.algorithm,
            key.config as ScoringConfig,
            delivered,
            Object.fromEntries(all.map((a) => [a.questionId, a.value])),
            {
              allowMissing: true,
              durations: Object.fromEntries(
                all.map((a) => [a.questionId, a.durationMs]),
              ),
              elapsedMs: Math.max(
                0,
                current.submittedAt!.getTime() -
                  current.timerStartedAt!.getTime(),
              ),
            },
          )
        : {
            algorithm: key.algorithm,
            details: [],
            excluded: true,
            qualityFlags: ["insufficient_answers"],
          };
      await tx.testResult.update({
        where: { id: previousScore.id },
        data: {
          result: json({
            ...score,
            validity,
            sessionQuality: (previousScore.result as any).sessionQuality,
          }),
          reason: "delayed_answer_sync",
        },
      });
      await tx.testAttempt.update({
        where: { id },
        data: { status: validity.eligible ? "completed" : "retry_required" },
      });
      if (current.status === "retry_required" && validity.eligible)
        await tx.auditLog.create({
          data: {
            organizationId: orgId(ctx),
            actorId: ctx.user.id,
            action: "attempt.completed",
            entityId: id,
            detail: json({
              reason: "delayed_answer_recovery",
              completedAt: current.submittedAt,
              recoveredAt: receivedAt,
              ...validity,
            }),
          },
        });
      await tx.auditLog.create({
        data: {
          organizationId: orgId(ctx),
          actorId: ctx.user.id,
          action: "result.delayed_sync",
          entityId: previousScore.id,
          detail: json({
            questionId: data.questionId,
            answeredAt,
            receivedAt,
            previousScore: previousScore.result,
            score,
          }),
        },
      });
    }
    if (delayed)
      await tx.auditLog.create({
        data: {
          organizationId: orgId(ctx),
          actorId: ctx.user.id,
          action: "answer.delayed_received",
          entityId: id,
          detail: json({
            questionId: data.questionId,
            answeredAt,
            receivedAt,
            clientTimestamp: true,
          }),
        },
      });
    return { revision: answer.revision, savedAt: answer.updatedAt, delayed };
  }, attemptTransactionOptions);
  if (["completed", "retry_required"].includes(attempt.status))
    void queueCompletedAssessment(
      attempt.organizationId,
      attempt.assignment.campaignId,
      attempt.assignment.membershipId,
    ).catch(console.error);
  return saved;
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
    if (current.status === "completed" || current.status === "retry_required")
      return {
        status: current.status,
        resultId: current.results[0].id,
        campaignId: attempt.assignment.campaignId,
        membershipId: attempt.assignment.membershipId,
      };
    const questions = attempt.assignment.testVersion.questions;
    const timeExpired = Boolean(
      current.expiresAt && current.expiresAt <= new Date(),
    );
    if (!current.timerStartedAt)
      throw new BadRequestException("Сначала начните основной тест");
    const key = await tx.scoringKey.findUniqueOrThrow({
      where: { id: current.scoringKeyId },
    });
    const validity = assessmentCompletion(
      questions.map(questionDTO),
      Object.fromEntries(current.answers.map((a) => [a.questionId, a.value])),
      key.config as ScoringConfig,
      key.algorithm === "scales",
    );
    if (!validity.eligible && key.algorithm === "scales" && !timeExpired)
      throw new BadRequestException(
        "Ответьте на все вопросы и полностью заполните задание с выбором приоритетов, если оно есть",
      );
    let score;
    try {
      score = validity.eligible
        ? calculateScore(
            key.algorithm,
            key.config as ScoringConfig,
            deliveredQuestions(attempt.assignment.testVersion, id),
            Object.fromEntries(
              current.answers.map((a) => [a.questionId, a.value]),
            ),
            {
              allowMissing: Boolean(
                attempt.assignment.testVersion.timeLimitSeconds,
              ),
              durations: Object.fromEntries(
                current.answers.map((a) => [a.questionId, a.durationMs]),
              ),
              elapsedMs: Math.max(
                0,
                Math.min(
                  Date.now(),
                  current.expiresAt?.getTime() ?? Date.now(),
                ) - current.timerStartedAt!.getTime(),
              ),
            },
          )
        : {
            algorithm: key.algorithm,
            details: [],
            excluded: true,
            qualityFlags: ["insufficient_answers"],
          };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const sessionQuality = {
      departures: current.departures,
      awayMs:
        current.awayMs +
        (current.leftAt
          ? Math.max(
              0,
              Math.min(Date.now(), current.expiresAt?.getTime() ?? Date.now()) -
                current.leftAt.getTime(),
            )
          : 0),
    };
    const result = await tx.testResult.upsert({
      where: {
        attemptId_scoringKeyId: { attemptId: id, scoringKeyId: key.id },
      },
      update: {
        result: json({ ...score, validity, sessionQuality }),
        reason: "completed_after_extension",
      },
      create: {
        organizationId: orgId(ctx),
        attemptId: id,
        scoringKeyId: key.id,
        result: json({ ...score, validity, sessionQuality }),
      },
    });
    await tx.testAttempt.update({
      where: { id },
      data: {
        status: validity.eligible ? "completed" : "retry_required",
        submittedAt: timeExpired ? current.expiresAt : new Date(),
        manuallySubmittedAt: timeExpired ? null : new Date(),
        pausedAt: null,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId(ctx),
        actorId: ctx.user.id,
        action: validity.eligible
          ? "attempt.completed"
          : "attempt.insufficient_answers",
        entityId: id,
        detail: json({
          completedAt: timeExpired ? current.expiresAt : new Date(),
          reason: timeExpired ? "deadline" : "submitted",
          answered: validity.answered,
          required: validity.required,
          total: questions.length,
        }),
      },
    });
    return {
      status: validity.eligible ? "completed" : "retry_required",
      resultId: result.id,
      campaignId: attempt.assignment.campaignId,
      membershipId: attempt.assignment.membershipId,
    };
  }, attemptTransactionOptions);
  if (result.status === "completed")
    void queueCompletedAssessment(
      attempt.organizationId,
      attempt.assignment.campaignId,
      attempt.assignment.membershipId,
    ).catch(console.error);
  return result;
}
export async function recalculate(ctx: Context, id: string, keyId: string) {
  requireRole(ctx, "superadmin");
  const organizationId = orgId(ctx);
  // Discover scope only. Erasure or a changed attempt must win before the
  // final reread, scoring, append-only output and its receipt under one fence.
  const discovered = await db.testAttempt.findFirst({
    where: { id, organizationId, status: "completed" },
    select: { assignmentId: true, assignment: { select: { membershipId: true, campaignId: true } } },
  });
  if (!discovered) throw new NotFoundException();
  return withParticipantWriteFence(organizationId, [discovered.assignment.membershipId], async tx => {
    const attempt = await tx.testAttempt.findFirst({
      where: {
        id, organizationId, status: "completed", assignmentId: discovered.assignmentId,
        assignment: { membershipId: discovered.assignment.membershipId, campaignId: discovered.assignment.campaignId },
      },
      include: {
        answers: true,
        assignment: {
          include: {
            testVersion: {
              include: { questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
            },
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException();
    const key = await tx.scoringKey.findFirst({
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
    const created = await tx.testResult.upsert({
      where: { attemptId_scoringKeyId: { attemptId: id, scoringKeyId: keyId } },
      update: {},
      create: {
        organizationId,
        attemptId: id,
        scoringKeyId: keyId,
        result: json(result),
        reason: "manual_recalculation",
        calculatedBy: ctx.user.id,
      },
    });
    await tx.auditLog.create({ data: {
      organizationId, actorId: ctx.user.id, action: "result.recalculated", entityId: created.id,
    } });
    return created;
  });
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

export async function extendAttempt(ctx: Context, id: string, input: unknown) {
  requireRole(ctx, "admin");
  const data = z
    .object({
      seconds: z.number().int().min(60).max(86400),
      reason: z.string().trim().min(10).max(2000),
    })
    .parse(input);
  const a = await db.testAttempt.findFirst({
    where: { id, organizationId: orgId(ctx) },
    include: { assignment: true },
  });
  if (!a) throw new NotFoundException();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM test_assignments WHERE id = ${a.assignmentId} FOR UPDATE`;
    const latest = await tx.testAttempt.findFirst({
      where: { assignmentId: a.assignmentId },
      orderBy: { attemptNumber: "desc" },
    });
    if (latest?.id !== id)
      throw new BadRequestException(
        "Для этого теста уже назначена новая попытка",
      );
    await tx.$queryRaw`SELECT id FROM test_attempts WHERE id = ${id} FOR UPDATE`;
    const current = await tx.testAttempt.findUniqueOrThrow({ where: { id } });
    if (!current.timerStartedAt || !current.expiresAt)
      throw new BadRequestException("Тест ещё не начат");
    if (current.manuallySubmittedAt || current.status === "expired")
      throw new BadRequestException("Сотрудник уже завершил эту попытку");
    const deadline = new Date(
      Math.max(Date.now(), current.expiresAt.getTime()) + data.seconds * 1000,
    );
    const updated = await tx.testAttempt.update({
      where: { id },
      data: {
        expiresAt: deadline,
        extraSeconds: { increment: data.seconds },
        status: "in_progress",
        submittedAt: null,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId(ctx),
        actorId: ctx.user.id,
        action: "incident.time_added",
        entityId: id,
        detail: json({
          ...data,
          previousDeadline: current.expiresAt,
          deadline,
        }),
      },
    });
    return updated;
  });
  return result;
}
