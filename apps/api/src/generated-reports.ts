import { persistReportPdf, makeFallbackAvailable } from "./report-lifecycle";
import { withParticipantWriteFence } from "./participant-write";
import { assertReportSubjectsAvailable, reportSubjectScope, withReportSubjectFence, ignoreUnavailableReport } from "./report-subject";
import type { GeneratedReport, Prisma } from "@prisma/client";
import { competencyEvidence } from "./competencies";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import { db, json } from "./db";
import { orgId, participant, requireRole, type Context } from "./access";
import { getCampaign, listPeople } from "./people";
import { openRouterKey } from "./secrets";
import { campaignRanks } from "./cohort";
import { normMetadata } from "./norms";
import {
  REPORT_POLICY_VERSION,
  riskEvidence,
  reportTextIssues,
  paragraphIssues,
} from "../../../packages/core/report-policy";
import { customerReportTemplate } from "./customer-report";
import { externalAiAllowed } from "../../../packages/core/data-policy";
import {
  REPORT_PROMPT,
  REPORT_PROMPT_VERSION,
  generatedContentSchema,
  reportAiInput,
  reportMetrics,
  validateReportEvidence,
  type ReportSnapshot,
} from "../../../packages/core/reporting";

const redis = new URL(process.env.REDIS_URL || "redis://localhost:56379");
const connection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  password: redis.password || undefined,
  maxRetriesPerRequest: null,
};
export const reportsQueue = new Queue("assessflow-reports", {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 15000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});
reportsQueue.on("error", () => {});

async function captureReport(
  ctx: Context,
  campaignId: string,
  membershipId?: string,
): Promise<ReportSnapshot> {
  requireRole(ctx, "admin", "expert");
  const campaign = await getCampaign(ctx, campaignId);
  if (!campaign) throw new NotFoundException("Кампания не найдена");
  if (membershipId) await participant(ctx, membershipId, campaignId);
  const people = (await listPeople(ctx, campaignId)).filter(
    (p) =>
      p.role === "employee" &&
      p.total > 0 &&
      (!membershipId || p.id === membershipId),
  );
  if (!people.length)
    throw new BadRequestException("В кампании пока нет назначенных участников");
  if (membershipId && people[0].status !== "completed")
    throw new BadRequestException(
      "Сначала необходимо завершить назначенные тесты",
    );
  const ids = people.map((p) => p.id);
  const frozen = await db.frozenNorm.findFirst({
    where: { organizationId: orgId(ctx), campaignId },
  });
  const ranks = await campaignRanks(orgId(ctx), campaignId, frozen);
  const keys = await db.scoringKey.findMany({
    where: {
      id: {
        in: people.flatMap((p) =>
          p.results.map((r: any) => r.scoringKeyId).filter(Boolean),
        ),
      },
    },
    select: { id: true, config: true, status: true },
  });
  const [observations, conclusions] = await Promise.all([
    db.expertObservation.findMany({
      where: {
        organizationId: orgId(ctx),
        campaignId,
        membershipId: { in: ids },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.finalReport.findMany({
      where: {
        organizationId: orgId(ctx),
        campaignId,
        membershipId: { in: ids },
      },
      orderBy: { version: "desc" },
    }),
  ]);
  return {
    norm: normMetadata(frozen),
    organization: { name: ctx.org!.name, matrixConfig: ctx.org!.matrixConfig },
    campaign: { id: campaign.id, name: campaign.name, startsAt: campaign.startsAt?.toISOString(), endsAt: campaign.endsAt?.toISOString(), country: campaign.country },
    people: await Promise.all(
      people.map(async (p) => {
        const seen = new Set<string>();
        const latest = observations.filter((o) => {
          if (o.membershipId !== p.id) return false;
          const criteria = o.criteriaSnapshot as any;
          const key = JSON.stringify([o.expertId, o.exerciseId, criteria.type]);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const expert =
          conclusions.find(
            (r) => r.membershipId === p.id && r.status === "approved",
          ) || conclusions.find((r) => r.membershipId === p.id);
        const competencies = await competencyEvidence(
          ctx,
          p.id,
          campaignId,
        ).catch(() => null);
        return {
          competencyProfile: competencies,
          id: p.id,
          name: p.user.name,
          position: p.position,
          unit: p.unit,
          category: p.category,
          status: p.status,
          completed: p.completed,
          total: p.total,
          results: p.results.map((r: any) => {
            const { details, ...score } = (ranks.get(r.resultId) ||
              r.score ||
              {}) as Record<string, unknown>;
            const key = keys.find((k) => k.id === r.scoringKeyId);
            return {
              ...r,
              ...(key ? { scoringKeyStatus: key.status } : {}),
              score: r.score
                ? {
                    ...score,
                    bandThresholds: (key?.config as any)?.bands,
                  }
                : null,
            };
          }),
          observations: latest.map((o) => ({
            id: o.id,
            expertId: o.expertId,
            exerciseId: o.exerciseId,
            indicatorExamples: o.indicatorExamples,
            criteriaSnapshot: o.criteriaSnapshot,
            scores: o.scores,
            notes: o.notes,
            createdAt: o.createdAt.toISOString(),
          })),
          expert: expert
            ? {
                status: expert.status,
                matrixX: expert.matrixX,
                matrixY: expert.matrixY,
                matrixReason: expert.matrixReason,
                content: expert.content,
              }
            : null,
        };
      }),
    ),
  };
}

const metadata = {
  policyVersion: true,
  reviewIssues: true,
  id: true,
  campaignId: true,
  membershipId: true,
  kind: true,
  language: true,
  status: true,
  error: true,
  readyAt: true,
  assessmentCompletedAt: true,
  generationMode: true,
  createdAt: true,
  updatedAt: true,
  participantIds: true,
  createdBy: true,
} as const;

async function expertCanRead(ctx: Context, ids: string[], campaignId: string, client: Pick<Prisma.TransactionClient, "testAssignment"> = db) {
  if (ctx.role !== "expert") return true;
  const assignments = await client.testAssignment.findMany({
    where: {
      organizationId: orgId(ctx),
      campaignId,
      OR: [
        { expertId: ctx.member!.id },
        { assessorIds: { has: ctx.member!.id } },
      ],
      membershipId: { in: ids },
    },
    select: { membershipId: true },
  });
  const allowed = new Set(assignments.map((a) => a.membershipId));
  return ids.every((id) => allowed.has(id));
}

export async function listGeneratedReports(
  ctx: Context,
  campaignId: string,
  kind?: string,
) {
  requireRole(ctx, "admin", "expert");
  await getCampaign(ctx, campaignId);
  if (!campaignId) throw new BadRequestException("Выберите кампанию");
  const rows = await db.generatedReport.findMany({
    where: {
      organizationId: orgId(ctx),
      campaignId,
      ...(kind ? { kind: z.enum(["individual", "team"]).parse(kind) } : {}),
    },
    // Scope is checked internally; frozen participant payload is never listed.
    select: { ...metadata, organizationId: true, snapshot: true },
    orderBy: { createdAt: "desc" },
    take: 150,
  });
  const visible = await Promise.all(rows.map(async row => {
    try {
      const scope = await assertReportSubjectsAvailable(row);
      return await expertCanRead(ctx, scope.ids, campaignId) ? row : null;
    } catch (error) {
      if (error instanceof ForbiddenException) return null;
      throw error;
    }
  }));
  const allowed = visible.filter((r): r is NonNullable<typeof r> => Boolean(r));
  const authors = await db.user.findMany({
    where: { id: { in: [...new Set(allowed.map((r) => r.createdBy))] } },
    select: { id: true, name: true },
  });
  const authorNames = new Map(
    authors.map((author) => [author.id, author.name]),
  );
  return allowed.map((report) => {
    const { participantIds, snapshot, organizationId, ...row } = report;
    return {
      ...row,
      createdByName: row.createdBy === "system" ? "AssessFlow" : authorNames.get(row.createdBy) || "",
      participantCount: reportSubjectScope(report).peopleIds.length,
    };
  });
}

/** For download consumers: read artifact bytes and write its export audit inside
 * this callback. Do not call the global DB client or render while holding it.
 */
export async function withGeneratedReportAccess<T>(
  ctx: Context,
  id: string,
  operation: (tx: Prisma.TransactionClient, report: GeneratedReport) => Promise<T>,
): Promise<T> {
  requireRole(ctx, "admin", "expert");
  const report = await db.generatedReport.findFirst({ where: { id, organizationId: orgId(ctx) } });
  if (!report) throw new NotFoundException("Отчёт не найден");
  return withReportSubjectFence(report, async (tx, current) => {
    if (!(await expertCanRead(ctx, reportSubjectScope(current).ids, current.campaignId, tx)))
      throw new ForbiddenException("Отчёт содержит участников, которые не назначены вам");
    return operation(tx, current);
  });
}

export async function getGeneratedReport(ctx: Context, id: string) {
  return withGeneratedReportAccess(ctx, id, async (tx, current) => {
    await tx.auditLog.create({ data: {
      organizationId: orgId(ctx), actorId: ctx.user.id,
      action: "generated_report.viewed", entityId: id,
    } });
    return current;
  });
}
function editableEvidenceTexts(snapshot: ReportSnapshot) {
  const texts = new Set<string>();
  for (const p of snapshot.people) {
    for (const o of p.observations) {
      texts.add(o.notes);
      for (const v of Object.values(o.indicatorExamples || {}))
        if (typeof v === "string") texts.add(v);
    }
    for (const r of p.competencyProfile?.consensus?.scores?.ratings || [])
      texts.add(r.reason);
    for (const card of p.competencyProfile?.cards || [])
      for (const s of card.sources || [])
        if (s.kind === "exercise")
          for (const v of s.scores || []) if (v.example) texts.add(v.example);
  }
  return texts;
}

export async function reportReview(ctx: Context, id: string) {
  requireRole(ctx, "expert");
  const report = await getGeneratedReport(ctx, id);
  const sourceTexts = new Set<string>();
  const allowedTexts = editableEvidenceTexts(
    report.snapshot as unknown as ReportSnapshot,
  );
  if (report.content)
    customerReportTemplate(
      report.snapshot as unknown as ReportSnapshot,
      report.content as any,
      {
        kind: report.kind as "individual" | "team",
        language: report.language as "ru" | "kk",
        createdAt: report.createdAt,
        collectText: (text) => {
          if (
            allowedTexts.has(text) &&
            (reportTextIssues(text).length || paragraphIssues(text).length)
          )
            sourceTexts.add(text);
        },
      },
    );
  return {
    id: report.id,
    status: report.status,
    language: report.language,
    content: report.content,
    issues: report.reviewIssues,
    updatedAt: report.updatedAt,
    sourceTexts: [...sourceTexts],
    presentationEdits: report.presentationEdits,
    interviewQuestions:
      report.kind === "individual"
        ? (report.snapshot as unknown as ReportSnapshot).people.flatMap(
            (p) => riskEvidence(p, report.language as "ru" | "kk").interview,
          )
        : [],
  };
}
export async function saveReportReview(
  ctx: Context,
  id: string,
  body: unknown,
) {
  requireRole(ctx, "expert");
  const data = z
    .object({
      content: generatedContentSchema,
      updatedAt: z.string().datetime(),
      presentationEdits: z
        .record(z.string(), z.string().trim().min(1).max(5000))
        .default({}),
    })
    .strict()
    .parse(body);
  const report = await getGeneratedReport(ctx, id);
  if (report.status !== "manual_review")
    throw new BadRequestException("Отчёт не ожидает проверки");
  const allowedTexts = editableEvidenceTexts(
    report.snapshot as unknown as ReportSnapshot,
  );
  if (
    Object.keys(data.presentationEdits).some((text) => !allowedTexts.has(text))
  )
    throw new BadRequestException(
      "Можно редактировать только формулировки наблюдений. Имена и результаты сохраняются без изменений.",
    );
  const { evidence } = reportAiInput(
    report.snapshot as unknown as ReportSnapshot,
    report.kind as "individual" | "team",
    report.language as "ru" | "kk",
  );
  validateReportEvidence(data.content, evidence);
  const claimed = await withReportSubjectFence(report, async (tx, current) => {
    if (!(await expertCanRead(ctx, reportSubjectScope(current).ids, current.campaignId, tx)))
      throw new ForbiddenException("Отчёт содержит участников, которые не назначены вам");
    return tx.generatedReport.updateMany({
      where: { id, organizationId: orgId(ctx), status: "manual_review", updatedAt: new Date(data.updatedAt) },
      data: {
        status: "processing", generationMode: "expert", error: null,
        content: json(data.content), presentationEdits: json(data.presentationEdits),
      },
    });
  });
  if (!claimed.count)
    throw new BadRequestException("Отчёт уже изменён. Откройте его заново.");
  const editedReport = { ...report, presentationEdits: json(data.presentationEdits) };
  try {
    await persistReportPdf(id, data.content, "expert");
  } catch (error) {
    await ignoreUnavailableReport(() => withReportSubjectFence(editedReport, async tx => {
      await tx.generatedReport.updateMany({
        where: { id, organizationId: orgId(ctx), readyAt: null, generationMode: "expert" },
        data: { status: "manual_review", error: "Не удалось подготовить PDF. Повторите проверку." },
      });
    }));
    throw error;
  }
  await withReportSubjectFence(editedReport, async (tx, current) => {
    if (!(await expertCanRead(ctx, reportSubjectScope(current).ids, current.campaignId, tx)))
      throw new ForbiddenException("Отчёт содержит участников, которые не назначены вам");
    await tx.auditLog.create({ data: {
      organizationId: orgId(ctx), actorId: ctx.user.id, action: "generated_report.reviewed", entityId: id,
      detail: json({ presentationEdits: data.presentationEdits }),
    } });
  });
  return reportReview(ctx, id);
}

export async function createGeneratedReport(
  ctx: Context,
  body: unknown,
  automatic = false,
) {
  requireRole(ctx, "admin");
  if (ctx.org?.purpose === "pilot")
    throw new ForbiddenException(
      "В пилоте автоматические отчёты и передача данных внешнему AI отключены. Результаты доступны команде проверки в аналитике и Excel.",
    );
  const data = z
    .object({
      campaignId: z.string().min(1),
      membershipId: z.string().optional(),
      kind: z.enum(["individual", "team"]),
      language: z.enum(["ru", "kk"]),
      regenerate: z.boolean().default(false),
    })
    .strict()
    .refine(
      (d) =>
        d.kind === "individual" ? Boolean(d.membershipId) : !d.membershipId,
      "Выберите участника для индивидуального отчёта",
    )
    .parse(body);
  const completedTasks = data.membershipId
    ? await db.testAssignment.findMany({
        where: {
          organizationId: orgId(ctx),
          campaignId: data.campaignId,
          membershipId: data.membershipId,
        },
        include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } },
      })
    : [];
  const completedAt = completedTasks.length
    ? new Date(
        Math.max(
          ...completedTasks.map(
            (t) => t.attempts[0]?.submittedAt?.getTime() ?? 0,
          ),
        ),
      )
    : null;
  const snapshot = await captureReport(ctx, data.campaignId, data.membershipId);
  const capturedScope = {
    organizationId: orgId(ctx), campaignId: data.campaignId,
    membershipId: data.membershipId || null, kind: data.kind,
    participantIds: snapshot.people.map(p => p.id), snapshot: json(snapshot),
  };
  const subjects = reportSubjectScope(capturedScope);
  if (!reportMetrics(snapshot, data.language, data.kind).length)
    throw new BadRequestException("Нет рассчитанных результатов для анализа");
  const settings = await db.platformSettings.findUnique({
    where: { id: "default" },
  });
  const model = settings?.aiModel || process.env.OPENROUTER_MODEL || "";
  const providerReady = externalAiAllowed(ctx.org) && Boolean(openRouterKey(settings) && model);
  const providerConfig = {
    only: settings?.aiProviderAllowlist || [],
    zdr: settings?.aiZdr ?? true,
  };
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify({
        snapshot,
        language: data.language,
        model,
        providerConfig,
        prompt: REPORT_PROMPT_VERSION,
      }),
    )
    .digest("hex");
  const outcome = await withParticipantWriteFence(orgId(ctx), subjects.ids, async (tx) => {
    // Erasure takes users -> memberships. Never take this org lock first.
    await tx.$queryRawUnsafe(
      "SELECT id FROM organizations WHERE id = $1 FOR UPDATE",
      orgId(ctx),
    );
    await assertReportSubjectsAvailable(capturedScope, tx);
    const existing = await tx.generatedReport.findFirst({
      where: {
        organizationId: orgId(ctx),
        campaignId: data.campaignId,
        kind: data.kind,
        membershipId: data.membershipId || null,
        language: data.language,
        OR: [
          {
            status: { in: ["pending", "processing", "manual_review"] },
            inputHash,
          },
          ...(!data.regenerate ? [{ status: "completed", inputHash }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { ...metadata, organizationId: true, snapshot: true },
    });
    if (existing) {
      if (JSON.stringify(reportSubjectScope(existing)) !== JSON.stringify(subjects))
        throw new ForbiddenException("Состав сохранённого отчёта изменился");
      await assertReportSubjectsAvailable(existing, tx);
      const { snapshot: _snapshot, organizationId: _organizationId, ...row } = existing;
      return { row, created: false };
    }
    const row = await tx.generatedReport.create({
      data: {
        organizationId: orgId(ctx),
        campaignId: data.campaignId,
        membershipId: data.membershipId || null,
        kind: data.kind,
        language: data.language,
        participantIds: subjects.ids,
        snapshot: json(snapshot),
        assessmentCompletedAt: completedAt,
        inputHash,
        model,
        prompt: REPORT_PROMPT,
        promptVersion: REPORT_PROMPT_VERSION,
        policyVersion: REPORT_POLICY_VERSION,
        providerConfig: json(providerConfig),
        createdBy: automatic ? "system" : ctx.user.id,
      },
      select: metadata,
    });
    await tx.auditLog.create({ data: {
      organizationId: orgId(ctx), actorId: ctx.user.id, action: "generated_report.requested", entityId: row.id,
      detail: json({ kind: data.kind, automatic }),
    } });
    return { row, created: true };
  });
  if (outcome.created) {
    try {
      if (providerReady)
        await reportsQueue.add(
          "generate",
          { reportId: outcome.row.id },
          { jobId: outcome.row.id, attempts: automatic ? 1 : 2 },
        );
      else await makeFallbackAvailable(outcome.row.id);
    } catch {
      await makeFallbackAvailable(outcome.row.id);
    }
  }
  const { participantIds, ...row } = outcome.row;
  return { ...row, participantCount: subjects.peopleIds.length };
}

export async function generateReport(id: string, attempt = 0, attempts = 2) {
  const report = await db.generatedReport.findUnique({ where: { id } });
  if (
    !report ||
    ["completed", "manual_review"].includes(report.status) ||
    report.generationMode === "expert"
  )
    return;
  const organization = await db.organization.findUnique({ where: { id: report.organizationId } });
  if (!organization || organization.purpose === "pilot") {
    await db.generatedReport.updateMany({
      where: { id, readyAt: null },
      data: { status: "failed", error: "В пилоте выпуск PDF отключён; организация недоступна для формирования отчёта." },
    });
    return;
  }
  if (!await ignoreUnavailableReport(() => assertReportSubjectsAvailable(report))) return;
  const change = (data: Prisma.GeneratedReportUpdateManyMutationInput, unready = false) =>
    ignoreUnavailableReport(() => withReportSubjectFence(report, async tx => tx.generatedReport.updateMany({
      where: { id, organizationId: report.organizationId, ...(unready ? { readyAt: null } : {}) }, data,
    })));
  const workerAudit = (action: string, detail?: unknown) =>
    ignoreUnavailableReport(() => withReportSubjectFence(report, async tx => tx.auditLog.create({ data: {
      organizationId: report.organizationId, actorId: null, action, entityId: id,
      ...(detail === undefined ? {} : { detail: json(detail) }),
    } })));
  // Re-check the current policy for jobs queued before consent/privacy changed.
  // No provider settings, data serialization, budget or network access precedes it.
  if (!externalAiAllowed(organization)) {
    await makeFallbackAvailable(id);
    return;
  }
  const settings = await db.platformSettings.findUnique({
    where: { id: "default" },
  });
  const key = openRouterKey(settings);
  const prompt =
    report.promptVersion === REPORT_PROMPT_VERSION
      ? report.prompt
      : REPORT_PROMPT;
  const { input, evidence } = reportAiInput(
    report.snapshot as unknown as ReportSnapshot,
    report.kind as "individual" | "team",
    report.language as "ru" | "kk",
  );
  const provider = report.providerConfig as { only?: string[]; zdr?: boolean };
  const body = JSON.stringify({
    model: report.model,
    max_tokens: 8500,
    provider: {
      only: provider.only?.length ? provider.only : undefined,
      zdr: provider.zdr,
      data_collection: "deny",
      require_parameters: true,
      allow_fallbacks: false,
      max_price: { prompt: 20, completion: 20 },
    },
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "professional_report",
        strict: true,
        schema: z.toJSONSchema(generatedContentSchema),
      },
    },
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: JSON.stringify(input) },
    ],
  });
  if (!key || Buffer.byteLength(body) > 60000) {
    await change({
      status: "failed",
      error: !key ? "AI временно не настроен" : "Объём данных превышает лимит генерации отчёта",
    }, true);
    await makeFallbackAvailable(id);
    return;
  }
  // At most 60 KB input + 8500 output tokens, capped at $20/M: reserve $2 per paid attempt.
  const reserved = await ignoreUnavailableReport(() => withReportSubjectFence(report, async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT id FROM organizations WHERE id = $1 FOR UPDATE",
      report.organizationId,
    );
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: report.organizationId },
    });
    const [analyses, reports] = await Promise.all([
      tx.aiReport.aggregate({
        where: { organizationId: org.id },
        _sum: { cost: true },
      }),
      tx.generatedReport.aggregate({
        where: { organizationId: org.id },
        _sum: { cost: true },
      }),
    ]);
    if (
      org.status !== "active" ||
      (analyses._sum.cost || 0) + (reports._sum.cost || 0) + 2 > org.aiBudget
    )
      return false;
    return (
      (
        await tx.generatedReport.updateMany({
          where: { id, readyAt: null },
          data: {
            status: "processing",
            error: null,
            prompt,
            promptVersion: REPORT_PROMPT_VERSION,
            cost: { increment: 2 },
          },
        })
      ).count > 0
    );
  }));
  if (!reserved) {
    await change({ status: "failed", error: "Лимит AI-расходов исчерпан или организация приостановлена" }, true);
    await makeFallbackAvailable(id);
    return;
  }
  let refund = false;
  try {
    if (!externalAiAllowed(await db.organization.findUnique({ where: { id: report.organizationId } }))) {
      await change({ cost: { decrement: 2 } });
      await makeFallbackAvailable(id);
      return;
    }
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        signal: AbortSignal.timeout(120000),
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
          "X-Title": "AssessFlow reports",
        },
        body,
      },
    );
    if (!response.ok) {
      refund = true;
      const upstream = await response.json().catch(() => ({}));
      await workerAudit("generated_report.upstream_error", {
          httpStatus: response.status,
          message: String(upstream?.error?.message || "")
            .replace(/sk-or-\S+/g, "[redacted]")
            .slice(0, 1000),
          code: upstream?.error?.code,
      });
      throw new Error("OpenRouter HTTP " + response.status);
    }
    const answer = (await response.json()) as any;
    const cost = answer.usage?.cost;
    const tokenCount = (value: unknown) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : 0;
    await change({
        ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0
          ? { cost: { increment: cost - 2 } }
          : {}),
        promptTokens: { increment: tokenCount(answer.usage?.prompt_tokens) },
        completionTokens: {
          increment: tokenCount(answer.usage?.completion_tokens),
        },
    });
    const content = generatedContentSchema.parse(
      JSON.parse(answer.choices?.[0]?.message?.content),
    );
    validateReportEvidence(content, evidence);
    await persistReportPdf(id, content);
    if (
      (
        await db.generatedReport.findUnique({
          where: { id },
          select: { status: true },
        })
      )?.status === "completed"
    )
      await workerAudit("generated_report.completed");
  } catch (error) {
    await workerAudit("generated_report.validation_failed", {
        attempt: attempt + 1,
        issues:
          error instanceof z.ZodError
            ? error.issues.map((issue) => ({
                path: issue.path.join("."),
                code: issue.code,
                message: issue.message,
              }))
            : [],
        category: error instanceof Error ? error.name : "unknown",
    });
    const message =
      error instanceof z.ZodError
        ? "Не удалось проверить структуру ответа AI. Повторите генерацию."
        : error instanceof Error && error.message.startsWith("OpenRouter HTTP")
          ? "Сервис AI вернул ошибку. Повторите генерацию."
          : "Не удалось завершить анализ. Повторите генерацию.";
    await change({
      status: attempt + 1 >= attempts ? "failed" : "pending", error: message,
      ...(refund ? { cost: { decrement: 2 } } : {}),
    }, true);
    await ignoreUnavailableReport(() => makeFallbackAvailable(id));
  }
}
export function startReportWorker() {
  const worker = new Worker(
    "assessflow-reports",
    (job) =>
      generateReport(
        job.data.reportId,
        job.attemptsMade,
        job.opts.attempts || 2,
      ),
    { connection, concurrency: 3 },
  );
  worker.on("error", () => {});
  worker.on("failed", (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 2))
      void db.generatedReport
        .updateMany({
          where: {
            id: job.data.reportId,
            readyAt: null,
            status: { in: ["pending", "processing"] },
          },
          data: {
            status: "failed",
            error: "Генерация прервана. Повторите формирование отчёта.",
          },
        })
        .catch(() => {});
  });
  return worker;
}
