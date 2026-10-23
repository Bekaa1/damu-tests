import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import { db, audit, json } from "./db";
import { orgId, participant, requireRole, type Context } from "./access";
import { getCampaign, listPeople } from "./people";
import { openRouterKey } from "./secrets";
import { REPORT_PROMPT, REPORT_PROMPT_VERSION, generatedContentSchema, reportAiInput, reportMetrics, validateReportEvidence, type ReportSnapshot } from "../../../packages/core/reporting";

const redis = new URL(process.env.REDIS_URL || "redis://localhost:56379");
const connection = { host: redis.hostname, port: Number(redis.port || 6379), password: redis.password || undefined, maxRetriesPerRequest: null };
export const reportsQueue = new Queue("assessflow-reports", {
  connection,
  defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 15000 }, removeOnComplete: 100, removeOnFail: 100 },
});
reportsQueue.on("error", () => {});

async function captureReport(ctx: Context, campaignId: string, membershipId?: string): Promise<ReportSnapshot> {
  const campaign = await getCampaign(ctx, campaignId);
  if (!campaign) throw new NotFoundException("Кампания не найдена");
  if (membershipId) await participant(ctx, membershipId, campaignId);
  let people: any[];
  if (ctx.role === "employee") {
    if (!ctx.member || membershipId !== ctx.member.id) throw new ForbiddenException("Можно сформировать только собственный индивидуальный отчёт");
    const member = await db.membership.findFirstOrThrow({
      where: { id: ctx.member.id, organizationId: orgId(ctx) },
      include: { user: { select: { name: true } } },
    });
    const assignments = await db.testAssignment.findMany({
      where: { organizationId: orgId(ctx), campaignId, membershipId: member.id },
      include: {
        testVersion: { include: { test: true } },
        attempts: { orderBy: { attemptNumber: "desc" }, take: 1, include: { results: { orderBy: { createdAt: "desc" } } } },
      },
    });
    const completed = assignments.filter(a => a.attempts[0]?.status === "completed").length;
    people = [{
      id: member.id, role: member.role, user: member.user, position: member.position, unit: member.unit, category: member.category,
      total: assignments.length, completed,
      status: assignments.length > 0 && completed === assignments.length ? "completed" : completed ? "in_progress" : "not_started",
      results: assignments.flatMap(a => a.attempts[0]?.results.map(r => ({
        testId: a.testVersion.testId, testVersionId: a.testVersionId, version: a.testVersion.version,
        scoringKeyId: r.scoringKeyId, language: a.attempts[0].language, name: a.testVersion.test.name, score: r.result,
      })) ?? []),
    }];
  } else {
    people = (await listPeople(ctx, campaignId)).filter(p => p.role === "employee" && p.total > 0 && (!membershipId || p.id === membershipId));
  }
  if (!people.length) throw new BadRequestException("В кампании пока нет назначенных участников");
  if (membershipId && people[0].status !== "completed") throw new BadRequestException("Сначала необходимо завершить назначенные тесты");
  const ids = people.map(p => p.id);
  const [observations, conclusions] = await Promise.all([
    db.expertObservation.findMany({ where: { organizationId: orgId(ctx), campaignId, membershipId: { in: ids } }, orderBy: { createdAt: "desc" } }),
    db.finalReport.findMany({ where: { organizationId: orgId(ctx), campaignId, membershipId: { in: ids } }, orderBy: { version: "desc" } }),
  ]);
  return {
    organization: { name: ctx.org!.name, matrixConfig: ctx.org!.matrixConfig },
    campaign: { id: campaign.id, name: campaign.name },
    people: people.map(p => {
      const seen = new Set<string>();
      const latest = observations.filter(o => {
        if (o.membershipId !== p.id) return false;
        const criteria = o.criteriaSnapshot as any;
        const key = JSON.stringify([criteria.type, criteria.name]);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      const expert = conclusions.find(r => r.membershipId === p.id && r.status === "approved") || conclusions.find(r => r.membershipId === p.id);
      return {
        id: p.id, name: p.user.name, position: p.position, unit: p.unit, category: p.category,
        status: p.status, completed: p.completed, total: p.total,
        results: p.results.map((r: any) => {
          const { details, ...score } = (r.score || {}) as Record<string, unknown>;
          return { ...r, score: r.score ? score : null };
        }),
        observations: latest.map(o => ({ id: o.id, criteriaSnapshot: o.criteriaSnapshot, scores: o.scores, notes: o.notes, createdAt: o.createdAt.toISOString() })),
        expert: expert ? { status: expert.status, matrixX: expert.matrixX, matrixY: expert.matrixY, matrixReason: expert.matrixReason, content: expert.content } : null,
      };
    }),
  };
}

const metadata = {
  id: true, campaignId: true, membershipId: true, kind: true, language: true,
  status: true, error: true, createdAt: true, updatedAt: true, participantIds: true, createdBy: true,
} as const;

async function expertCanRead(ctx: Context, ids: string[], campaignId: string) {
  if (ctx.role !== "expert") return true;
  const assignments = await db.testAssignment.findMany({
    where: { organizationId: orgId(ctx), campaignId, expertId: ctx.member!.id, membershipId: { in: ids } },
    select: { membershipId: true },
  });
  const allowed = new Set(assignments.map(a => a.membershipId));
  return ids.every(id => allowed.has(id));
}

export async function listGeneratedReports(ctx: Context, campaignId: string, kind?: string) {
  const employee = ctx.role === "employee";
  if (!employee) requireRole(ctx, "admin", "expert");
  else if (kind && kind !== "individual") throw new ForbiddenException("Сотрудникам доступны только их индивидуальные отчёты");
  await getCampaign(ctx, campaignId);
  if (!campaignId) throw new BadRequestException("Выберите кампанию");
  const rows = await db.generatedReport.findMany({
    where: {
      organizationId: orgId(ctx), campaignId,
      ...(employee ? { membershipId: ctx.member!.id, kind: "individual" } : {}),
      ...(kind ? { kind: z.enum(["individual", "team"]).parse(kind) } : {}),
    },
    select: metadata, orderBy: { createdAt: "desc" }, take: 150,
  });
  const visible = await Promise.all(rows.map(async row => await expertCanRead(ctx, row.participantIds as string[], campaignId) ? row : null));
  const allowed = visible.filter((r): r is NonNullable<typeof r> => Boolean(r));
  const authors = await db.user.findMany({ where: { id: { in: [...new Set(allowed.map(r => r.createdBy))] } }, select: { id: true, name: true } });
  const authorNames = new Map(authors.map(author => [author.id, author.name]));
  return allowed.map(({ participantIds, ...row }) => ({ ...row, createdByName: authorNames.get(row.createdBy) || "", participantCount: (participantIds as string[]).length }));
}

export async function getGeneratedReport(ctx: Context, id: string) {
  const report = await db.generatedReport.findFirst({ where: { id, organizationId: orgId(ctx) } });
  if (!report) throw new NotFoundException("Отчёт не найден");
  if (ctx.role === "employee") {
    if (report.kind !== "individual" || report.membershipId !== ctx.member?.id)
      throw new ForbiddenException("Отчёт недоступен");
  } else requireRole(ctx, "admin", "expert");
  if (!await expertCanRead(ctx, report.participantIds as string[], report.campaignId)) throw new ForbiddenException("Отчёт содержит участников, которые не назначены вам");
  await audit(orgId(ctx), ctx.user.id, "generated_report.viewed", id);
  return report;
}

export async function createGeneratedReport(ctx: Context, body: unknown) {
  const data = z.object({
    campaignId: z.string().min(1), membershipId: z.string().optional(),
    kind: z.enum(["individual", "team"]), language: z.enum(["ru", "kk"]),
    regenerate: z.boolean().default(false),
  }).strict().refine(d => d.kind === "individual" ? Boolean(d.membershipId) : !d.membershipId, "Выберите участника для индивидуального отчёта").parse(body);
  const employee = ctx.role === "employee";
  if (employee) {
    if (data.kind !== "individual" || data.membershipId !== ctx.member?.id)
      throw new ForbiddenException("Можно сформировать только собственный индивидуальный отчёт");
  } else requireRole(ctx, "admin");
  const snapshot = await captureReport(ctx, data.campaignId, data.membershipId);
  if (!reportMetrics(snapshot, data.language).length) throw new BadRequestException("Нет рассчитанных результатов для анализа");
  const settings = await db.platformSettings.findUnique({ where: { id: "default" } });
  const model = settings?.aiModel || process.env.OPENROUTER_MODEL || "";
  if (!openRouterKey(settings) || !model) throw new BadRequestException("AI пока не настроен. Обратитесь к владельцу платформы");
  const providerConfig = { only: settings?.aiProviderAllowlist || [], zdr: settings?.aiZdr ?? true };
  const inputHash = createHash("sha256").update(JSON.stringify({ snapshot, language: data.language, model, providerConfig, prompt: REPORT_PROMPT_VERSION })).digest("hex");
  const outcome = await db.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', orgId(ctx));
    const existing = await tx.generatedReport.findFirst({
      where: { organizationId: orgId(ctx), campaignId: data.campaignId, kind: data.kind, membershipId: data.membershipId || null, language: data.language,
        OR: [{ status: { in: ["pending", "processing"] } }, ...(!data.regenerate ? [{ status: "completed", inputHash }] : [])] },
      orderBy: { createdAt: "desc" }, select: metadata,
    });
    if (existing) return { row: existing, created: false };
    const row = await tx.generatedReport.create({
      data: { organizationId: orgId(ctx), campaignId: data.campaignId, membershipId: data.membershipId || null,
        kind: data.kind, language: data.language, participantIds: snapshot.people.map(p => p.id), snapshot: json(snapshot),
        inputHash, model, prompt: REPORT_PROMPT, promptVersion: REPORT_PROMPT_VERSION, providerConfig: json(providerConfig), createdBy: ctx.user.id },
      select: metadata,
    });
    return { row, created: true };
  });
  if (outcome.created) {
    try { await reportsQueue.add("generate", { reportId: outcome.row.id }, { jobId: outcome.row.id }); }
    catch {
      await db.generatedReport.update({ where: { id: outcome.row.id }, data: { status: "failed", error: "Очередь временно недоступна. Повторите формирование отчёта." } });
      throw new BadRequestException("Очередь временно недоступна. Повторите формирование отчёта.");
    }
    await audit(orgId(ctx), ctx.user.id, "generated_report.requested", outcome.row.id, { kind: data.kind });
  }
  const { participantIds, ...row } = outcome.row;
  return { ...row, participantCount: (participantIds as string[]).length };
}

export async function generateReport(id: string, attempt = 0, attempts = 2) {
  const report = await db.generatedReport.findUnique({ where: { id } });
  if (!report || report.status === "completed") return;
  const settings = await db.platformSettings.findUnique({ where: { id: "default" } });
  const key = openRouterKey(settings);
  const prompt = report.promptVersion === REPORT_PROMPT_VERSION ? report.prompt : REPORT_PROMPT;
  const { input, evidence } = reportAiInput(report.snapshot as unknown as ReportSnapshot, report.kind as "individual" | "team", report.language as "ru" | "kk");
  const provider = report.providerConfig as { only?: string[]; zdr?: boolean };
  const body = JSON.stringify({
    model: report.model, max_tokens: 8500,
    provider: { only: provider.only?.length ? provider.only : undefined, zdr: provider.zdr, data_collection: "deny", require_parameters: true, allow_fallbacks: false, max_price: { prompt: 20, completion: 20 } },
    response_format: { type: "json_schema", json_schema: { name: "professional_report", strict: true, schema: z.toJSONSchema(generatedContentSchema) } },
    messages: [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify(input) }],
  });
  if (!key || Buffer.byteLength(body) > 60000) {
    await db.generatedReport.updateMany({ where: { id }, data: { status: "failed", error: !key ? "AI временно не настроен" : "Объём данных превышает лимит генерации отчёта" } });
    return;
  }
  // At most 60 KB input + 8500 output tokens, capped at $20/M: reserve $2 per paid attempt.
  const reserved = await db.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', report.organizationId);
    const org = await tx.organization.findUniqueOrThrow({ where: { id: report.organizationId } });
    const [analyses, reports] = await Promise.all([
      tx.aiReport.aggregate({ where: { organizationId: org.id }, _sum: { cost: true } }),
      tx.generatedReport.aggregate({ where: { organizationId: org.id }, _sum: { cost: true } }),
    ]);
    if (org.status !== "active" || (analyses._sum.cost || 0) + (reports._sum.cost || 0) + 2 > org.aiBudget) return false;
    return (await tx.generatedReport.updateMany({ where: { id }, data: { status: "processing", error: null, prompt, promptVersion: REPORT_PROMPT_VERSION, cost: { increment: 2 } } })).count > 0;
  });
  if (!reserved) {
    await db.generatedReport.updateMany({ where: { id }, data: { status: "failed", error: "Лимит AI-расходов исчерпан или организация приостановлена" } });
    return;
  }
  let refund = false;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(180000),
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Title": "AssessFlow reports" }, body,
    });
    if (!response.ok) { refund = true; throw new Error("OpenRouter HTTP " + response.status); }
    const answer = await response.json() as any;
    const cost = answer.usage?.cost;
    const tokenCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    await db.generatedReport.updateMany({ where: { id }, data: {
      ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? { cost: { increment: cost - 2 } } : {}),
      promptTokens: { increment: tokenCount(answer.usage?.prompt_tokens) },
      completionTokens: { increment: tokenCount(answer.usage?.completion_tokens) },
    } });
    const content = generatedContentSchema.parse(JSON.parse(answer.choices?.[0]?.message?.content));
    validateReportEvidence(content, evidence);
    await db.generatedReport.updateMany({ where: { id }, data: { status: "completed", content: json(content), error: null } });
    await audit(report.organizationId, null, "generated_report.completed", id);
  } catch (error) {
    await audit(report.organizationId, null, "generated_report.validation_failed", id, {
      attempt: attempt + 1,
      issues: error instanceof z.ZodError ? error.issues.map(issue => ({ path: issue.path.join("."), code: issue.code, message: issue.message })) : [],
      category: error instanceof Error ? error.name : "unknown",
    });
    const message = error instanceof z.ZodError ? "Не удалось проверить структуру ответа AI. Повторите генерацию." : error instanceof Error && error.message.startsWith("OpenRouter HTTP") ? "Сервис AI вернул ошибку. Повторите генерацию." : "Не удалось завершить анализ. Повторите генерацию.";
    await db.generatedReport.updateMany({ where: { id }, data: { status: attempt + 1 >= attempts ? "failed" : "pending", error: message, ...(refund ? { cost: { decrement: 2 } } : {}) } });
    throw new Error(message);
  }
}
export function startReportWorker() {
  const worker = new Worker("assessflow-reports", job => generateReport(job.data.reportId, job.attemptsMade, job.opts.attempts || 2), { connection, concurrency: 1 });
  worker.on("error", () => {});
  worker.on("failed", (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 2))
      void db.generatedReport.updateMany({ where: { id: job.data.reportId, status: { in: ["pending", "processing"] } }, data: { status: "failed", error: "Генерация прервана. Повторите формирование отчёта." } }).catch(() => {});
  });
  return worker;
}
