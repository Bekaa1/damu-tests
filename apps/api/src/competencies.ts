import { HOLDING_MODEL_VERSION, holdingProfile } from "../../../packages/core/holding";
import { withParticipantWriteFence } from "./participant-write";
import { projectSourceScore } from "../../../packages/core/competency-source";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { db, json } from "./db";
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
  if (data.content.holdingModelVersion !== HOLDING_MODEL_VERSION)
    throw new BadRequestException("Новые версии используют только модель Холдинга; исторические версии доступны для чтения");
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
/** Append-only activation, scoped and idempotent. Never edits keys, results or people. */
export async function activateHoldingModel(organizationId: string, authorId = "system") {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
    const previous=await tx.competencyModel.findFirst({where:{organizationId},orderBy:{version:"desc"}});
    if((previous?.content as any)?.holdingModelVersion===HOLDING_MODEL_VERSION) return previous;
    const model=await tx.competencyModel.create({data:{organizationId,version:(previous?.version??0)+1,content:json(DEFAULT_COMPETENCIES),authorId}});
    const exercises=await tx.assessmentExercise.findMany({where:{organizationId,active:true}});
    for(const e of exercises) {
      const criteria=exerciseCriteria(DEFAULT_COMPETENCIES,e.type);
      if(!criteria.length) continue;
      await tx.assessmentExercise.update({where:{id:e.id},data:{active:false}});
      await tx.assessmentExercise.create({data:{organizationId,type:e.type,name:json(e.name),version:e.version+1,criteria:json(criteria),active:true}});
    }
    await tx.auditLog.create({data:{organizationId,actorId:authorId,action:"holding_model.activated",entityId:model.id,detail:json({holdingModelVersion:HOLDING_MODEL_VERSION,previousModelId:previous?.id??null})}});
    return model;
  });
}
export async function initializeCompetencies() {
  const orgs=await db.organization.findMany({select:{id:true}});
  for(const org of orgs) await activateHoldingModel(org.id);
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
          if (!criteria.length) continue;
          sources.push({
            id: o.id,
            method: `exercise:${snap.type}`,
            kind: "exercise",
            name: snap.name,
            expertId: o.expertId,
            expertName:
              authors.find((a) => a.id === o.expertId)?.user.name || "",
            notes: o.notes,
            notObserved: criteria.every((i:any)=>(o.scores as any)[i.id]==null),
            scores: criteria.map((i: any) => ({
              id: i.id,
              name: i.name,
              score: (o.scores as any)[i.id] ?? null,
              notObserved: (o.scores as any)[i.id] == null,
              example: (o.indicatorExamples as any)[i.id] || o.notes,
            })),
          });
        }
      }
    }
    return {
      ...c,
      sources,
      methodCount: new Set(sources.filter(s=>!s.notObserved).map((s) => s.method)).size,
      sourceIds: sources.map((s) => s.id),
      insufficientSources: new Set(sources.filter(s=>!s.notObserved).map((s) => s.method)).size < 2,
    };
  });
  return {
    model,
    cards,
    consensus,
    member,
    assessors: authors.map((a) => ({ id: a.id, name: a.user.name })),
    roleId: (consensus?.scores as any)?.roleId || (config.holdingModelVersion===HOLDING_MODEL_VERSION && member.profileRow ? `holding-profile-${member.profileRow}` : ""),
    profile: member.profileRow ? holdingProfile(member.profileRow) : null,
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
            notObserved: z.boolean().default(false),
            evidenceText: z.string().trim().max(4000).default(""),
            reason: z.string().trim().min(10).max(4000),
            evidenceIds: z.array(z.string()).max(100),
          }).superRefine((r,ctx)=>{
            if(r.notObserved && r.value!==null) ctx.addIssue({code:"custom",message:"Не наблюдалось — отдельный статус без балла"});
            if(!r.notObserved && !r.evidenceIds.length) ctx.addIssue({code:"custom",message:"Выберите источник оценки"});
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
  const profile = model.holdingModelVersion===HOLDING_MODEL_VERSION
    ? holdingProfile(model.roles.find(r=>r.id===data.roleId)?.profileRow ?? 0) : undefined;
  if(model.holdingModelVersion===HOLDING_MODEL_VERSION && (!profile || (evidence.member.profileRow && profile.profileRow!==evidence.member.profileRow)))
    throw new BadRequestException("Сначала привяжите участника к его номерному должностному профилю");
  if (new Set(data.ratings.map((r) => r.competencyId)).size !== 8)
    throw new BadRequestException("Оцените все восемь компетенций");
  for (const r of data.ratings) {
    const c = evidence.cards.find((c) => c.id === r.competencyId);
    if (!c || r.evidenceIds.some((id) => !c.sourceIds.includes(id)))
      throw new BadRequestException("Источник не связан с компетенцией");
  }
  const result = await withParticipantWriteFence(orgId(ctx), [membershipId], async (tx) => {
    if (ctx.role === "expert" && !await tx.testAssignment.count({ where: {
      organizationId: orgId(ctx), membershipId, campaignId: data.campaignId,
      OR: [{ expertId: ctx.member!.id }, { assessorIds: { has: ctx.member!.id } }],
    } })) throw new ForbiddenException("Участник не назначен вам");
    const prev = await tx.competencyConsensus.findFirst({
      where: {
        organizationId: orgId(ctx),
        campaignId: data.campaignId,
        membershipId,
      },
      orderBy: { version: "desc" },
    });
    const created = await tx.competencyConsensus.create({
      data: {
        organizationId: orgId(ctx),
        campaignId: data.campaignId,
        membershipId,
        modelId: data.modelId,
        version: (prev?.version ?? 0) + 1,
        authorId: ctx.user.id,
        scores: json({
          ...data,
          ...(profile ? {holdingModelVersion:HOLDING_MODEL_VERSION,participantId:membershipId,profileRow:profile.profileRow,block:profile.block,targetLevelModel:profile.targetLevelModel} : {}),
          ratings: data.ratings.map((r) => ({
            ...r,
            ...(profile ? {
              competencyCode:r.competencyId, criticality:profile.criticality[r.competencyId],
              targetLevelModel:profile.targetLevelModel,targetScore:null,score:r.value,
              evidenceSource:evidence.cards.find(c=>c.id===r.competencyId)!.sources.filter(s=>r.evidenceIds.includes(s.id)).map(s=>({id:s.id,kind:s.kind,method:s.method})),
              assessorScores:evidence.cards.find(c=>c.id===r.competencyId)!.sources.filter(s=>s.kind==="exercise" && r.evidenceIds.includes(s.id)).map(s=>({assessorId:s.expertId,observationId:s.id,scores:s.scores})),
            } : {}),
            methodCount: new Set(
              evidence.cards
                .find((c) => c.id === r.competencyId)!
                .sources.filter((s) => r.evidenceIds.includes(s.id) && !s.notObserved)
                .map((s) => s.method),
            ).size,
          })),
        }),
      },
    });
    await tx.auditLog.create({ data: {
      organizationId: orgId(ctx), actorId: ctx.user.id,
      action: "competencies.consensus_saved", entityId: created.id,
    } });
    return created;
  });
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
  return withParticipantWriteFence(orgId(ctx), [id], async tx => {
    const experts = await tx.membership.count({
      where: {
        organizationId: orgId(ctx),
        role: "expert",
        status: "active",
        id: { in: data.expertIds },
      },
    });
    if (experts !== new Set(data.expertIds).size)
      throw new BadRequestException("Эксперт недоступен");
    await tx.testAssignment.updateMany({
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
    await tx.auditLog.create({ data: {
      organizationId: orgId(ctx), actorId: ctx.user.id,
      action: "assessors.assigned", entityId: id, detail: json(data),
    } });
    return { ok: true };
  });
}
