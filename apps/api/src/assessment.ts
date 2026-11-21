import { latestAssessorObservations } from "../../../packages/core/competencies";
import { withParticipantWriteFence } from "./participant-write";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { db, audit, json } from "./db";
import { orgId, participant, requireRole, type Context } from "./access";
import {
  exerciseSchema,
  reportContentSchema,
} from "../../../packages/core/contracts";
export async function participantDetails(
  ctx: Context,
  id: string,
  campaignId: string,
) {
  requireRole(ctx, "admin", "expert");
  // Initial policy check is not publication authority; discard its subject data.
  await participant(ctx, id, campaignId);
  const organizationId = orgId(ctx);
  return withParticipantWriteFence(organizationId, [id], async tx => {
    if (ctx.role === "expert" && !await tx.testAssignment.count({ where: {
      organizationId, membershipId: id, campaignId,
      OR: [{ expertId: ctx.member!.id }, { assessorIds: { has: ctx.member!.id } }],
    } })) throw new ForbiddenException("Участник не назначен вам");
    const member = await tx.membership.findUniqueOrThrow({ where: { id, organizationId } });
    const user = await tx.user.findUniqueOrThrow({
      where: { id: member.userId },
      select: { name: true, email: true, locale: true },
    });
    const assignments = await tx.testAssignment.findMany({
      where: { organizationId, campaignId, membershipId: id },
      include: {
        testVersion: { include: { test: true } },
        attempts: {
          orderBy: { attemptNumber: "desc" },
          take: 1,
          include: {
            results: { orderBy: { createdAt: "desc" } },
            _count: { select: { answers: true } },
          },
        },
      },
    });
    const reports = await tx.finalReport.findMany({
      where: { organizationId, campaignId, membershipId: id },
      orderBy: { version: "desc" },
    });
    const allDone =
      assignments.length > 0 &&
      assignments.every((a) => a.attempts[0]?.status === "completed");
    const [ai, observations, files] = await Promise.all([
      tx.aiReport.findMany({
        where: { organizationId, campaignId, membershipId: id },
        orderBy: { createdAt: "desc" },
      }),
      tx.expertObservation.findMany({
        where: { organizationId, campaignId, membershipId: id },
        orderBy: { createdAt: "desc" },
      }),
      tx.fileAsset.findMany({
        where: { organizationId, campaignId, membershipId: id },
        select: {
          id: true,
          name: true,
          size: true,
          createdAt: true,
          uploadedBy: true,
        },
      }),
    ]);
    const details = {
      member: { ...member, user },
      allDone,
      canSelfGenerateAi: false,
      assignments: assignments.map((a) => ({
        ...a,
        attempts: a.attempts.map((t) => ({
          ...t,
          scoringKeyId: undefined,
          results: t.results.map((r) => ({
            ...r,
            result: {
              ...(r.result as object),
              sessionQuality: { departures: t.departures, awayMs: t.awayMs },
            },
          })),
        })),
      })),
      reports,
      ai,
      observations,
      files,
      attemptHistory: await tx.testAttempt.findMany({
        where: { organizationId, assignment: { membershipId: id, campaignId } },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          assignmentId: true,
          attemptNumber: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          timerStartedAt: true,
          _count: { select: { answers: true } },
          assignment: {
            select: {
              testVersion: { select: { test: { select: { name: true } } } },
            },
          },
          results: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { result: true },
          },
        },
      }),
      retakes: await tx.auditLog.findMany({
        where: {
          organizationId,
          entityId: id,
          action: "incident.retake_assigned",
          detail: { path: ["campaignId"], equals: campaignId },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, actorId: true, createdAt: true, detail: true },
      }),
      incidents: await tx.auditLog.findMany({
        where: {
          organizationId,
          entityId: {
            in: assignments.flatMap((a) => a.attempts.map((t) => t.id)),
          },
          action: "incident.time_added",
        },
        orderBy: { createdAt: "desc" },
      }),
    };
    await tx.auditLog.create({ data: {
      organizationId, actorId: ctx.user.id, action: "results.viewed", entityId: id,
      detail: { campaignId },
    } });
    return details;
  });
}
export async function saveExercise(
  ctx: Context,
  id: string | undefined,
  input: unknown,
) {
  requireRole(ctx, "expert");
  const data = exerciseSchema.parse(input);
  const organizationId = orgId(ctx);
  if (new Set(data.criteria.map((c) => c.id)).size !== data.criteria.length)
    throw new BadRequestException("ID критериев должны быть уникальными");
  for (const c of data.criteria)
    if (new Set(c.scale.map((s) => s.value)).size !== c.scale.length)
      throw new BadRequestException("Баллы шкалы должны быть уникальными");
  const previous = id
    ? await db.assessmentExercise.findFirst({ where: { id, organizationId } })
    : null;
  if (id && !previous) throw new NotFoundException();
  const result = await db.assessmentExercise.create({
    data: {
      organizationId,
      type: data.type,
      name: json(data.name),
      criteria: json(data.criteria),
      version: (previous?.version ?? 0) + 1,
    },
  });
  if (previous)
    await db.assessmentExercise.update({
      where: { id: previous.id },
      data: { active: false },
    });
  await audit(organizationId, ctx.user.id, "exercise.configured", result.id);
  return result;
}
export async function saveObservation(ctx: Context, input: unknown) {
  requireRole(ctx, "expert");
  const data = z
    .object({
      campaignId: z.string(),
      membershipId: z.string(),
      exerciseId: z.string(),
      scores: z.record(z.string(), z.number().int().nullable()),
      indicatorExamples: z
        .record(z.string(), z.string().trim().max(3000))
        .default({}),
      notes: z.string().min(10).max(12000),
    })
    .parse(input);
  await participant(ctx, data.membershipId, data.campaignId);
  const organizationId = orgId(ctx);
  const exercise = await db.assessmentExercise.findFirst({
    where: { id: data.exerciseId, organizationId, active: true },
  });
  if (!exercise) throw new NotFoundException("Упражнение не найдено");
  const criteria = exercise.criteria as z.infer<
    typeof exerciseSchema
  >["criteria"];
  if (Object.keys(data.scores).length !== criteria.length)
    throw new BadRequestException("Заполните все критерии");
  for (const c of criteria) {
    const value = data.scores[c.id];
    if (
      (c as any).competencyId &&
      value !== null &&
      (data.indicatorExamples[c.id] || "").length < 5
    )
      throw new BadRequestException(
        "Добавьте пример поведения для каждого оценённого индикатора",
      );
    if (
      value === undefined ||
      (value === null && !c.allowNotObserved) ||
      (value !== null && !c.scale.some((s) => s.value === value))
    )
      throw new BadRequestException("Недопустимый балл");
  }
  const result = await withParticipantWriteFence(organizationId, [data.membershipId], async (tx) => {
    const previous = await tx.expertObservation.count({
      where: {
        organizationId,
        campaignId: data.campaignId,
        membershipId: data.membershipId,
        exerciseId: exercise.id,
        expertId: ctx.member?.id ?? ctx.user.id,
      },
    });
    if (ctx.role === "expert" && !await tx.testAssignment.count({ where: {
      organizationId, membershipId: data.membershipId, campaignId: data.campaignId,
      OR: [{ expertId: ctx.member!.id }, { assessorIds: { has: ctx.member!.id } }],
    } })) throw new ForbiddenException("Участник не назначен вам");
    const observation = await tx.expertObservation.create({
      data: {
        ...data,
        organizationId,
        expertId: ctx.member?.id ?? ctx.user.id,
        criteriaSnapshot: json({
          name: exercise.name,
          type: exercise.type,
          criteria,
          exerciseId: exercise.id,
        }),
        scores: json(data.scores),
        version: previous + 1,
      },
    });
    await tx.auditLog.create({ data: {
      organizationId, actorId: ctx.user.id, action: "observation.saved", entityId: observation.id,
    } });
    return observation;
  });
  return result;
}
export async function saveReport(ctx: Context, input: unknown) {
  requireRole(ctx, "expert");
  const data = z
    .object({
      campaignId: z.string(),
      membershipId: z.string(),
      content: reportContentSchema,
      matrixX: z.number().int().min(1).max(3),
      matrixY: z.number().int().min(1).max(3),
      matrixReason: z.string().min(20).max(6000),
      approve: z.boolean().default(false),
    })
    .parse(input);
  await participant(ctx, data.membershipId, data.campaignId);
  const organizationId = orgId(ctx);
  return withParticipantWriteFence(organizationId, [data.membershipId], async (tx) => {
    const assignments = await tx.testAssignment.findMany({
      where: {
        organizationId,
        campaignId: data.campaignId,
        membershipId: data.membershipId,
      },
      include: {
        attempts: {
          orderBy: { attemptNumber: "desc" },
          take: 1,
          include: { results: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
      },
    });
    if (!assignments.length)
      throw new BadRequestException("Сотрудник не участвует в кампании");
    if (
      data.approve &&
      (["strengths", "development", "risks", "recommendations"].some(
        (k) => (data.content as any)[k].trim().length < 10,
      ) ||
        !data.content.developmentPlan.length ||
        data.content.developmentPlan.some((p) =>
          Object.values(p).some((v) => !v.trim()),
        ))
    )
      throw new BadRequestException(
        "Для утверждения заполните выводы, рекомендации и индивидуальный план развития",
      );
    if (
      data.approve &&
      !assignments.every((a) => a.attempts[0]?.status === "completed")
    )
      throw new BadRequestException(
        "Для утверждения необходимо завершить назначенные тесты",
      );
    const observations = await tx.expertObservation.findMany({
      where: {
        organizationId,
        campaignId: data.campaignId,
        membershipId: data.membershipId,
      },
      orderBy: { createdAt: "desc" },
    });
    const latestObservations = latestAssessorObservations(observations);
    const ai = await tx.aiReport.findFirst({
      where: {
        organizationId,
        campaignId: data.campaignId,
        membershipId: data.membershipId,
        status: "completed",
      },
      orderBy: { createdAt: "desc" },
    });
    const previous = await tx.finalReport.findFirst({
      where: {
        organizationId,
        campaignId: data.campaignId,
        membershipId: data.membershipId,
      },
      orderBy: { version: "desc" },
    });
    if (ctx.role === "expert" && !await tx.testAssignment.count({ where: {
      organizationId, membershipId: data.membershipId, campaignId: data.campaignId,
      OR: [{ expertId: ctx.member!.id }, { assessorIds: { has: ctx.member!.id } }],
    } })) throw new ForbiddenException("Участник не назначен вам");
    const report = await tx.finalReport.create({
      data: {
        organizationId,
        campaignId: data.campaignId,
        membershipId: data.membershipId,
        authorId: ctx.user.id,
        version: (previous?.version ?? 0) + 1,
        status: data.approve ? "approved" : "draft",
        content: json(data.content),
        matrixX: data.matrixX,
        matrixY: data.matrixY,
        matrixReason: data.matrixReason,
        approvedAt: data.approve ? new Date() : null,
        resultIds: json(
          assignments.flatMap(
            (a) => a.attempts[0]?.results.map((r) => r.id) ?? [],
          ),
        ),
        observationIds: json(latestObservations.map((o) => o.id)),
        aiReportId: ai?.id,
      },
    });
    await tx.auditLog.create({ data: {
      organizationId, actorId: ctx.user.id,
      action: data.approve ? "report.approved" : "report.saved", entityId: report.id,
    } });
    return report;
  });
}
export async function getReport(ctx: Context, id: string) {
  requireRole(ctx, "admin", "expert");
  const organizationId = orgId(ctx);
  // Discover only the subject scope; final payload and receipt share its lease.
  const scope = await db.finalReport.findFirst({
    where: { id, organizationId },
    select: { membershipId: true, campaignId: true },
  });
  if (!scope) throw new NotFoundException();
  await participant(ctx, scope.membershipId, scope.campaignId);
  return withParticipantWriteFence(organizationId, [scope.membershipId], async tx => {
    if (ctx.role === "expert" && !await tx.testAssignment.count({ where: {
      organizationId, membershipId: scope.membershipId, campaignId: scope.campaignId,
      OR: [{ expertId: ctx.member!.id }, { assessorIds: { has: ctx.member!.id } }],
    } })) throw new ForbiddenException("Участник не назначен вам");
    const report = await tx.finalReport.findFirst({
      where: { id, organizationId, membershipId: scope.membershipId, campaignId: scope.campaignId },
    });
    if (!report) throw new NotFoundException();
    const member = await tx.membership.findUniqueOrThrow({
      where: { id: report.membershipId, organizationId },
      include: { user: { select: { name: true, email: true, locale: true } } },
    });
    const results = await tx.testResult.findMany({
      where: {
        organizationId,
        id: { in: report.resultIds as string[] },
      },
      include: {
        attempt: {
          include: {
            assignment: { include: { testVersion: { include: { test: true } } } },
          },
        },
      },
    });
    const observations = await tx.expertObservation.findMany({
      where: {
        organizationId,
        id: { in: report.observationIds as string[] },
      },
    });
    const ai = report.aiReportId
      ? await tx.aiReport.findFirst({
          where: { id: report.aiReportId, organizationId },
        })
      : null;
    const expertIds = [...new Set(observations.map((o) => o.expertId))];
    const authors = await tx.membership.findMany({
      where: { organizationId, id: { in: expertIds } },
      include: { user: { select: { name: true } } },
    });
    const author = await tx.user.findUnique({
      where: { id: report.authorId },
      select: { name: true },
    });
    await tx.auditLog.create({ data: {
      organizationId, actorId: ctx.user.id, action: "report.viewed", entityId: id,
    } });
    return {
      report,
      member,
      results,
      observations: observations.map((o) => ({
        ...o,
        expertName:
          authors.find((a) => a.id === o.expertId)?.user.name ?? author?.name,
      })),
      ai,
      author,
      organization: ctx.org,
    };
  });
}
