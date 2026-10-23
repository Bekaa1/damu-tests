import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
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
  const member = await participant(ctx, id, campaignId);
  const organizationId = orgId(ctx);
  const user = await db.user.findUniqueOrThrow({
    where: { id: member.userId },
    select: { name: true, email: true, locale: true },
  });
  const assignments = await db.testAssignment.findMany({
    where: { organizationId, campaignId, membershipId: id },
    include: {
      testVersion: { include: { test: true } },
      attempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
        include: { results: { orderBy: { createdAt: "desc" } } },
      },
    },
  });
  const reports = await db.finalReport.findMany({
    where: { organizationId, campaignId, membershipId: id },
    orderBy: { version: "desc" },
  });
  const allDone =
    assignments.length > 0 &&
    assignments.every((a) => a.attempts[0]?.status === "completed");
  const employee = ctx.role === "employee";
  if (employee && !allDone)
    return {
      member: { ...member, user },
      assignments: [],
      reports: [],
      ai: [],
      observations: [],
      files: [],
      allDone: false,
      canSelfGenerateAi: false,
    };
  const ai =
    !employee || ctx.org!.showPreliminary
      ? await db.aiReport.findMany({
          where: { organizationId, campaignId, membershipId: id },
          orderBy: { createdAt: "desc" },
        })
      : [];
  const observations = !employee
    ? await db.expertObservation.findMany({
        where: { organizationId, campaignId, membershipId: id },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const files = !employee
    ? await db.fileAsset.findMany({
        where: { organizationId, campaignId, membershipId: id },
        select: {
          id: true,
          name: true,
          size: true,
          createdAt: true,
          uploadedBy: true,
        },
      })
    : [];
  await audit(organizationId, ctx.user.id, "results.viewed", id, {
    campaignId,
  });
  return {
    member: { ...member, user },
    allDone,
    canSelfGenerateAi: employee && ctx.org!.showPreliminary,
    assignments:
      employee && !ctx.org!.showPreliminary
        ? []
        : assignments.map((a) => ({
            ...a,
            attempts: a.attempts.map((t) => ({
              ...t,
              scoringKeyId: undefined,
              results: t.results.map((r) => ({
                ...r,
                result: employee
                  ? { ...(r.result as object), details: undefined }
                  : r.result,
              })),
            })),
          })),
    reports: employee
      ? ctx.org!.showApproved
        ? reports.filter((r) => r.status === "approved")
        : []
      : reports,
    ai: ai.map((r) => ({ ...r, error: employee ? undefined : r.error })),
    observations,
    files,
  };
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
      value === undefined ||
      (value === null && !c.allowNotObserved) ||
      (value !== null && !c.scale.some((s) => s.value === value))
    )
      throw new BadRequestException("Недопустимый балл");
  }
  const previous = await db.expertObservation.count({
    where: {
      organizationId,
      campaignId: data.campaignId,
      membershipId: data.membershipId,
      exerciseId: exercise.id,
    },
  });
  const result = await db.expertObservation.create({
    data: {
      ...data,
      organizationId,
      expertId: ctx.member?.id ?? ctx.user.id,
      criteriaSnapshot: json({
        name: exercise.name,
        type: exercise.type,
        criteria,
      }),
      scores: json(data.scores),
      version: previous + 1,
    },
  });
  await audit(organizationId, ctx.user.id, "observation.saved", result.id);
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
  const assignments = await db.testAssignment.findMany({
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
  const observations = await db.expertObservation.findMany({
    where: {
      organizationId,
      campaignId: data.campaignId,
      membershipId: data.membershipId,
    },
    orderBy: { createdAt: "desc" },
  });
  const latestObservations = observations.filter(
    (o, i) =>
      observations.findIndex((x) => x.exerciseId === o.exerciseId) === i,
  );
  const ai = await db.aiReport.findFirst({
    where: {
      organizationId,
      campaignId: data.campaignId,
      membershipId: data.membershipId,
      status: "completed",
    },
    orderBy: { createdAt: "desc" },
  });
  const report = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM memberships WHERE id = ${data.membershipId} FOR UPDATE`;
    const previous = await tx.finalReport.findFirst({
      where: {
        organizationId,
        campaignId: data.campaignId,
        membershipId: data.membershipId,
      },
      orderBy: { version: "desc" },
    });
    return tx.finalReport.create({
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
  });
  await audit(
    organizationId,
    ctx.user.id,
    data.approve ? "report.approved" : "report.saved",
    report.id,
  );
  return report;
}
export async function getReport(ctx: Context, id: string) {
  const report = await db.finalReport.findFirst({
    where: { id, organizationId: orgId(ctx) },
  });
  if (!report) throw new NotFoundException();
  await participant(ctx, report.membershipId, report.campaignId);
  if (
    ctx.role === "employee" &&
    (report.status !== "approved" || !ctx.org!.showApproved)
  )
    throw new ForbiddenException("Отчёт пока недоступен");
  const member = await db.membership.findUniqueOrThrow({
    where: { id: report.membershipId },
    include: { user: { select: { name: true, email: true, locale: true } } },
  });
  const results = await db.testResult.findMany({
    where: {
      organizationId: orgId(ctx),
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
  const observations = await db.expertObservation.findMany({
    where: {
      organizationId: orgId(ctx),
      id: { in: report.observationIds as string[] },
    },
  });
  const ai = report.aiReportId
    ? await db.aiReport.findFirst({
        where: { id: report.aiReportId, organizationId: orgId(ctx) },
      })
    : null;
  const expertIds = [...new Set(observations.map((o) => o.expertId))];
  const authors = await db.membership.findMany({
    where: { organizationId: orgId(ctx), id: { in: expertIds } },
    include: { user: { select: { name: true } } },
  });
  const author = await db.user.findUnique({
    where: { id: report.authorId },
    select: { name: true },
  });
  await audit(orgId(ctx), ctx.user.id, "report.viewed", id);
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
}
