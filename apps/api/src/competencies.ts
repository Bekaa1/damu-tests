import { projectSourceScore } from "../../../packages/core/competency-source";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { db, audit, json } from "./db";
import { orgId, participant, requireRole, type Context } from "./access";
import {
  DEFAULT_COMPETENCIES,
  competencyModelSchema,
  exerciseCriteria,
  latestAssessorObservations,
  type CompetencyConfig,
} from "../../../packages/core/competencies";
export async function getCompetencyModel(ctx: Context) {
  requireRole(ctx, "expert", "admin");
  return db.competencyModel.findFirst({
    where: { organizationId: orgId(ctx) },
    orderBy: { version: "desc" },
  });
}
export async function saveCompetencyModel(ctx: Context, input: unknown) {
  requireRole(ctx, "expert");
  const data = z
    .object({
      content: competencyModelSchema,
      approve: z.boolean().default(false),
    })
    .parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${orgId(ctx)} FOR UPDATE`;
    const prev = await tx.competencyModel.findFirst({
      where: { organizationId: orgId(ctx) },
      orderBy: { version: "desc" },
    });
    const row = await tx.competencyModel.create({
      data: {
        organizationId: orgId(ctx),
        version: (prev?.version ?? 0) + 1,
        status: data.approve ? "approved" : "draft",
        content: json(data.content),
        authorId: ctx.user.id,
        approvedAt: data.approve ? new Date() : null,
      },
    });
    const exercises = await tx.assessmentExercise.findMany({
      where: { organizationId: orgId(ctx), active: true },
    });
    for (const e of exercises) {
      const criteria = exerciseCriteria(data.content, e.type);
      if (!criteria.length) continue;
      await tx.assessmentExercise.update({
        where: { id: e.id },
        data: { active: false },
      });
      await tx.assessmentExercise.create({
        data: {
          organizationId: orgId(ctx),
          type: e.type,
          name: json(e.name),
          version: e.version + 1,
          criteria: json(criteria),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: orgId(ctx),
        actorId: ctx.user.id,
        action: data.approve
          ? "competency_model.approved"
          : "competency_model.draft_saved",
        entityId: row.id,
        detail: json({ version: row.version }),
      },
    });
    return row;
  });
}
export async function initializeCompetencies() {
  const orgs = await db.organization.findMany({ select: { id: true } });
  for (const org of orgs)
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${org.id} FOR UPDATE`;
      if (await tx.competencyModel.count({ where: { organizationId: org.id } }))
        return;
      await tx.competencyModel.create({
        data: {
          organizationId: org.id,
          version: 1,
          content: json(DEFAULT_COMPETENCIES),
          authorId: "system",
        },
      });
      // Replace placeholders only, preserve all existing observations and custom criteria.
      const exercises = await tx.assessmentExercise.findMany({
        where: { organizationId: org.id, active: true },
      });
      for (const e of exercises)
        if (JSON.stringify(e.criteria).includes("Компетенция для настройки")) {
          await tx.assessmentExercise.update({
            where: { id: e.id },
            data: { active: false },
          });
          await tx.assessmentExercise.create({
            data: {
              organizationId: org.id,
              type: e.type,
              name: json(e.name),
              version: e.version + 1,
              criteria: json(exerciseCriteria(DEFAULT_COMPETENCIES, e.type)),
            },
          });
        }
    });
}
export async function competencyEvidence(
  ctx: Context,
  membershipId: string,
  campaignId: string,
) {
  requireRole(ctx, "admin", "expert");
  const member = await participant(ctx, membershipId, campaignId);
  const model = await getCompetencyModel(ctx);
  if (!model) throw new NotFoundException("Модель компетенций не настроена");
  const config = model.content as unknown as CompetencyConfig;
  const [tasks, all, consensus] = await Promise.all([
    db.testAssignment.findMany({
      where: { organizationId: orgId(ctx), campaignId, membershipId },
      include: {
        testVersion: { include: { test: true } },
        attempts: {
          orderBy: { attemptNumber: "desc" },
          take: 1,
          include: { results: true },
        },
      },
    }),
    db.expertObservation.findMany({
      where: { organizationId: orgId(ctx), campaignId, membershipId },
      orderBy: { createdAt: "desc" },
    }),
    db.competencyConsensus.findFirst({
      where: {
        organizationId: orgId(ctx),
        campaignId,
        membershipId,
        modelId: model.id,
      },
      orderBy: { version: "desc" },
    }),
  ]);
  const latest = latestAssessorObservations(all);
  const authors = await db.membership.findMany({
    where: {
      organizationId: orgId(ctx),
      id: { in: [...new Set(all.map((o) => o.expertId))] },
    },
    include: { user: { select: { name: true } } },
  });
  const cards = config.competencies.map((c) => {
    const sources: any[] = [];
    for (const mapping of c.sources) {
      if (mapping.kind === "test") {
        const task = tasks.find(
          (a) =>
            a.testVersion.testId === mapping.id ||
            a.testVersion.test.direction === mapping.id,
        );
        const attempt = task?.attempts[0];
        if (attempt?.status !== "completed") continue;
        const r = attempt.results[attempt.results.length - 1],
          score = r?.result as any;
        if (
          !r ||
          score.reviewRequired ||
          score.validity?.eligible === false ||
          score.excluded
        )
          continue;
        if (
          mapping.scales.length &&
          !mapping.scales.some(
            (id) =>
              score.scales?.[id] ||
              score.competencies?.[id] ||
              score.details?.some((d: any) => d.questionId === id),
          )
        )
          continue;
        sources.push({
          id: r.id,
          method: `test:${task!.testVersion.testId}`,
          kind: "test",
          name: task!.testVersion.test.name,
          scales: mapping.scales,
          score: projectSourceScore(score, mapping.scales),
        });
      } else {
        for (const o of latest) {
          const snap = o.criteriaSnapshot as any;
          if (snap.type !== mapping.id) continue;
          const criteria = (snap.criteria || []).filter(
            (i: any) => i.competencyId === c.id,
          );
          const observed = criteria.filter(
            (i: any) =>
              (o.scores as any)[i.id] !== null &&
              (o.scores as any)[i.id] !== undefined,
          );
          if (!observed.length) continue;
          sources.push({
            id: o.id,
            method: `exercise:${snap.type}`,
            kind: "exercise",
            name: snap.name,
            expertId: o.expertId,
            expertName:
              authors.find((a) => a.id === o.expertId)?.user.name || "",
            notes: o.notes,
            scores: observed.map((i: any) => ({
              id: i.id,
              name: i.name,
              score: (o.scores as any)[i.id],
              example: (o.indicatorExamples as any)[i.id] || o.notes,
            })),
          });
        }
      }
    }
    return {
      ...c,
      sources,
      methodCount: new Set(sources.map((s) => s.method)).size,
      sourceIds: sources.map((s) => s.id),
      insufficientSources: new Set(sources.map((s) => s.method)).size < 2,
    };
  });
  return {
    model,
    cards,
    consensus,
    member,
    assessors: authors.map((a) => ({ id: a.id, name: a.user.name })),
    roleId: (consensus?.scores as any)?.roleId || "",
  };
}
export async function saveConsensus(
  ctx: Context,
  membershipId: string,
  input: unknown,
) {
  requireRole(ctx, "expert");
  const data = z
    .object({
      campaignId: z.string(),
      modelId: z.string(),
      roleId: z.string(),
      ratings: z
        .array(
          z.object({
            competencyId: z.string(),
            value: z.number().int().min(1).max(5).nullable(),
            reason: z.string().trim().min(10).max(4000),
            evidenceIds: z.array(z.string()).min(1),
          }),
        )
        .length(8),
    })
    .parse(input);
  const evidence = await competencyEvidence(ctx, membershipId, data.campaignId);
  if (evidence.model.id !== data.modelId)
    throw new BadRequestException("Модель обновлена. Перезагрузите карточку");
  const model = evidence.model.content as unknown as CompetencyConfig;
  if (!model.roles.some((r) => r.id === data.roleId))
    throw new BadRequestException("Укажите должностной профиль");
  if (new Set(data.ratings.map((r) => r.competencyId)).size !== 8)
    throw new BadRequestException("Оцените все восемь компетенций");
  for (const r of data.ratings) {
    const c = evidence.cards.find((c) => c.id === r.competencyId);
    if (!c || r.evidenceIds.some((id) => !c.sourceIds.includes(id)))
      throw new BadRequestException("Источник не связан с компетенцией");
  }
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM memberships WHERE id = ${membershipId} FOR UPDATE`;
    const prev = await tx.competencyConsensus.findFirst({
      where: {
        organizationId: orgId(ctx),
        campaignId: data.campaignId,
        membershipId,
      },
      orderBy: { version: "desc" },
    });
    return tx.competencyConsensus.create({
      data: {
        organizationId: orgId(ctx),
        campaignId: data.campaignId,
        membershipId,
        modelId: data.modelId,
        version: (prev?.version ?? 0) + 1,
        authorId: ctx.user.id,
        scores: json({
          ...data,
          ratings: data.ratings.map((r) => ({
            ...r,
            methodCount: new Set(
              evidence.cards
                .find((c) => c.id === r.competencyId)!
                .sources.filter((s) => r.evidenceIds.includes(s.id))
                .map((s) => s.method),
            ).size,
          })),
        }),
      },
    });
  });
  await audit(
    orgId(ctx),
    ctx.user.id,
    "competencies.consensus_saved",
    result.id,
  );
  const { queueCompletedAssessment } = await import("./report-lifecycle");
  void queueCompletedAssessment(
    orgId(ctx),
    data.campaignId,
    membershipId,
  ).catch(console.error);
  return result;
}
export async function assignAssessors(
  ctx: Context,
  id: string,
  input: unknown,
) {
  requireRole(ctx, "admin");
  const data = z
    .object({
      campaignId: z.string(),
      expertIds: z.array(z.string()).min(1).max(20),
    })
    .parse(input);
  await participant(ctx, id, data.campaignId);
  const experts = await db.membership.count({
    where: {
      organizationId: orgId(ctx),
      role: "expert",
      status: "active",
      id: { in: data.expertIds },
    },
  });
  if (experts !== new Set(data.expertIds).size)
    throw new BadRequestException("Эксперт недоступен");
  await db.testAssignment.updateMany({
    where: {
      organizationId: orgId(ctx),
      campaignId: data.campaignId,
      membershipId: id,
    },
    data: {
      expertId: data.expertIds[0],
      assessorIds: [...new Set(data.expertIds)],
    },
  });
  await audit(orgId(ctx), ctx.user.id, "assessors.assigned", id, data);
  return { ok: true };
}
