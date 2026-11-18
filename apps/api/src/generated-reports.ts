import { persistReportPdf, makeFallbackAvailable } from "./report-lifecycle";
import { competencyEvidence } from "./competencies";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import { db, audit, json } from "./db";
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
    select: { id: true, config: true },
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
    campaign: { id: campaign.id, name: campaign.name },
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
            return {
              ...r,
              score: r.score
                ? {
                    ...score,
                    bandThresholds: (
                      keys.find((k) => k.id === r.scoringKeyId)?.config as any
                    )?.bands,
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

async function expertCanRead(ctx: Context, ids: string[], campaignId: string) {
  if (ctx.role !== "expert") return true;
  const assignments = await db.testAssignment.findMany({
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
    select: metadata,
    orderBy: { createdAt: "desc" },
    take: 150,
  });
  const visible = await Promise.all(
    rows.map(async (row) =>
      (await expertCanRead(ctx, row.participantIds as string[], campaignId))
        ? row
        : null,
    ),
  );
  const allowed = visible.filter((r): r is NonNullable<typeof r> => Boolean(r));
  const authors = await db.user.findMany({
    where: { id: { in: [...new Set(allowed.map((r) => r.createdBy))] } },
    select: { id: true, name: true },
  });
  const authorNames = new Map(
    authors.map((author) => [author.id, author.name]),
  );
  return allowed.map(({ participantIds, ...row }) => ({
    ...row,
    createdByName:
      row.createdBy === "system"
        ? "AssessFlow"
        : authorNames.get(row.createdBy) || "",
    participantCount: (participantIds as string[]).length,
  }));
}

export async function getGeneratedReport(ctx: Context, id: string) {
  requireRole(ctx, "admin", "expert");
  const report = await db.generatedReport.findFirst({
    where: { id, organizationId: orgId(ctx) },
  });
  if (!report) throw new NotFoundException("Отчёт не найден");
  if (
    !(await expertCanRead(
      ctx,
      report.participantIds as string[],
      report.campaignId,
    ))
  )
    throw new ForbiddenException(
      "Отчёт содержит участников, которые не назначены вам",
    );
  await audit(orgId(ctx), ctx.user.id, "generated_report.viewed", id);
  return report;
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
  const claimed = await db.generatedReport.updateMany({
    where: { id, status: "manual_review", updatedAt: new Date(data.updatedAt) },
    data: {
      status: "processing",
      generationMode: "expert",
      error: null,
      content: json(data.content),
      presentationEdits: json(data.presentationEdits),
    },
  });
  if (!claimed.count)
    throw new BadRequestException("Отчёт уже изменён. Откройте его заново.");
  try {
    await persistReportPdf(id, data.content, "expert");
  } catch (error) {
    await db.generatedReport.updateMany({
      where: { id, readyAt: null },
      data: {
        status: "manual_review",
        error: "Не удалось подготовить PDF. Повторите проверку.",
      },
    });
    throw error;
  }
  await audit(orgId(ctx), ctx.user.id, "generated_report.reviewed", id, {
    presentationEdits: data.presentationEdits,
  });
  return reportReview(ctx, id);
}

export async function createGeneratedReport(
  ctx: Context,
  body: unknown,
  automatic = false,
) {
  requireRole(ctx, "admin");
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
  if (!reportMetrics(snapshot, data.language).length)
    throw new BadRequestException("Нет рассчитанных результатов для анализа");
  const settings = await db.platformSettings.findUnique({
    where: { id: "default" },
  });
  const model = settings?.aiModel || process.env.OPENROUTER_MODEL || "";
  const providerReady = Boolean(openRouterKey(settings) && model);
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
  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT id FROM organizations WHERE id = $1 FOR UPDATE",
      orgId(ctx),
    );
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
      select: metadata,
    });
    if (existing) return { row: existing, created: false };
    const row = await tx.generatedReport.create({
      data: {
        organizationId: orgId(ctx),
        campaignId: data.campaignId,
        membershipId: data.membershipId || null,
        kind: data.kind,
        language: data.language,
        participantIds: snapshot.people.map((p) => p.id),
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
    await audit(
      orgId(ctx),
      ctx.user.id,
      "generated_report.requested",
      outcome.row.id,
      { kind: data.kind, automatic },
    );
  }
  const { participantIds, ...row } = outcome.row;
  return { ...row, participantCount: (participantIds as string[]).length };
}

export async function generateReport(id: string, attempt = 0, attempts = 2) {
  const report = await db.generatedReport.findUnique({ where: { id } });
  if (
    !report ||
    ["completed", "manual_review"].includes(report.status) ||
    report.generationMode === "expert"
  )
    return;
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
    await db.generatedReport.updateMany({
      where: { id, readyAt: null },
      data: {
        status: "failed",
        error: !key
          ? "AI временно не настроен"
          : "Объём данных превышает лимит генерации отчёта",
      },
    });
    await makeFallbackAvailable(id);
    return;
  }
  // At most 60 KB input + 8500 output tokens, capped at $20/M: reserve $2 per paid attempt.
  const reserved = await db.$transaction(async (tx) => {
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
  });
  if (!reserved) {
    await db.generatedReport.updateMany({
      where: { id, readyAt: null },
      data: {
        status: "failed",
        error: "Лимит AI-расходов исчерпан или организация приостановлена",
      },
    });
    await makeFallbackAvailable(id);
    return;
  }
  let refund = false;
  try {
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
      await audit(
        report.organizationId,
        null,
        "generated_report.upstream_error",
        id,
        {
          httpStatus: response.status,
          message: String(upstream?.error?.message || "")
            .replace(/sk-or-\S+/g, "[redacted]")
            .slice(0, 1000),
          code: upstream?.error?.code,
        },
      );
      throw new Error("OpenRouter HTTP " + response.status);
    }
    const answer = (await response.json()) as any;
    const cost = answer.usage?.cost;
    const tokenCount = (value: unknown) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : 0;
    await db.generatedReport.updateMany({
      where: { id },
      data: {
        ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0
          ? { cost: { increment: cost - 2 } }
          : {}),
        promptTokens: { increment: tokenCount(answer.usage?.prompt_tokens) },
        completionTokens: {
          increment: tokenCount(answer.usage?.completion_tokens),
        },
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
      await audit(
        report.organizationId,
        null,
        "generated_report.completed",
        id,
      );
  } catch (error) {
    await audit(
      report.organizationId,
      null,
      "generated_report.validation_failed",
      id,
      {
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
      },
    );
    const message =
      error instanceof z.ZodError
        ? "Не удалось проверить структуру ответа AI. Повторите генерацию."
        : error instanceof Error && error.message.startsWith("OpenRouter HTTP")
          ? "Сервис AI вернул ошибку. Повторите генерацию."
          : "Не удалось завершить анализ. Повторите генерацию.";
    await db.generatedReport.updateMany({
      where: { id, readyAt: null },
      data: {
        status: attempt + 1 >= attempts ? "failed" : "pending",
        error: message,
        ...(refund ? { cost: { decrement: 2 } } : {}),
      },
    });
    await makeFallbackAvailable(id);
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
