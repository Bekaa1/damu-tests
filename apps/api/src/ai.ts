import { Queue, Worker } from "bullmq";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, audit, json } from "./db";
import { openRouterKey } from "./secrets";
import {
  aiContentSchema,
  DEFAULT_AI_PROMPT,
} from "../../../packages/core/contracts";
const redisUrl = new URL(process.env.REDIS_URL || "redis://localhost:56379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
};
export const aiQueue = new Queue("assessflow-ai", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 15000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
aiQueue.on("error", () => {});
export async function queueAi(
  organizationId: string,
  campaignId: string,
  membershipId: string,
  regenerate = false,
  oncePerCampaign = false,
) {
  const tasks = await db.testAssignment.findMany({
    where: { organizationId, campaignId, membershipId },
    include: {
      attempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
        include: { results: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });
  if (
    !tasks.length ||
    !tasks.every((t) => t.attempts[0]?.status === "completed")
  )
    return { status: "incomplete" };
  const ids = tasks
    .flatMap((t) => t.attempts[0].results.map((r) => r.id))
    .sort();
  const settings = await db.platformSettings.findUnique({
    where: { id: "default" },
  });
  const model = settings?.aiModel || process.env.OPENROUTER_MODEL || "";
  const promptVersion = settings?.aiPromptVersion || "1.0",
    prompt = settings?.aiPrompt || DEFAULT_AI_PROMPT;
  const providerConfig = {
    only: (settings?.aiProviderAllowlist ?? []) as string[],
    zdr: settings?.aiZdr ?? true,
  };
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify({ ids, model, promptVersion, prompt, providerConfig }),
    )
    .digest("hex");
  const ready = Boolean(openRouterKey(settings) && model);
  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM memberships WHERE id = ${membershipId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    if (oncePerCampaign) {
      const existing = await tx.aiReport.findFirst({
        where: {
          organizationId,
          campaignId,
          membershipId,
          status: { in: ["pending", "processing", "completed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { report: existing, created: false };
    }
    const recent = await tx.aiReport.findFirst({
      where: {
        organizationId,
        campaignId,
        membershipId,
        ...(!oncePerCampaign ? { inputHash } : {}),
        status: {
          in: ["pending", "processing", "completed", "awaiting_configuration"],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      recent &&
      (["pending", "processing"].includes(recent.status) ||
        (!regenerate && !(recent.status === "awaiting_configuration" && ready)))
    )
      return { report: recent, created: false };
    const report = await tx.aiReport.create({
      data: {
        organizationId,
        campaignId,
        membershipId,
        model,
        promptVersion,
        prompt,
        providerConfig: json(providerConfig),
        inputHash,
        resultIds: ids,
        status: ready ? "pending" : "awaiting_configuration",
      },
    });
    return { report, created: true };
  });
  if (ready && outcome.created) {
    try {
      await aiQueue.add(
        "generate",
        { reportId: outcome.report.id },
        { jobId: outcome.report.id },
      );
    } catch {
      await db.aiReport.update({
        where: { id: outcome.report.id },
        data: {
          status: "failed",
          error: "Очередь временно недоступна. Повторите генерацию.",
        },
      });
      return { id: outcome.report.id, status: "failed" };
    }
  }
  return { id: outcome.report.id, status: outcome.report.status };
}
export async function generateAi(
  reportId: string,
  attemptsMade = 0,
  maxAttempts = 1,
) {
  const report = await db.aiReport.findUniqueOrThrow({
    where: { id: reportId },
  });
  if (report.status === "completed") return;
  const settings = await db.platformSettings.findUniqueOrThrow({
    where: { id: "default" },
  });
  const apiKey = openRouterKey(settings);
  if (!apiKey || !report.model) {
    await db.aiReport.update({
      where: { id: reportId },
      data: { status: "awaiting_configuration" },
    });
    return;
  }
  const member = await db.membership.findFirstOrThrow({
    where: { id: report.membershipId, organizationId: report.organizationId },
  });
  const results = await db.testResult.findMany({
    where: {
      organizationId: report.organizationId,
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
  if (results.length !== (report.resultIds as string[]).length)
    throw new Error("Result snapshot is incomplete");
  const input = {
    participantId: createHash("sha256")
      .update(`${report.organizationId}:${member.id}`)
      .digest("hex")
      .slice(0, 24),
    category: member.category,
    language: results[0]?.attempt.language ?? "ru",
    results: results.map((r) => {
      const v = r.attempt.assignment.testVersion;
      const { details, ...scores } = r.result as Record<string, unknown>;
      return {
        id: r.id,
        method: v.test.name,
        version: v.version,
        scoringKeyId: r.scoringKeyId,
        scores,
        limitations: v.limitations,
      };
    }),
  };
  const provider = report.providerConfig as { only?: string[]; zdr?: boolean };
  const request = {
    model: report.model,
    max_tokens: 6000,
    provider: {
      data_collection: "deny",
      zdr: provider.zdr ?? true,
      require_parameters: true,
      allow_fallbacks: false,
      ...(provider.only?.length ? { only: provider.only } : {}),
      max_price: { prompt: 20, completion: 20, request: 0 },
    },
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "assessment_analysis",
        strict: true,
        schema: z.toJSONSchema(aiContentSchema),
      },
    },
    messages: [
      { role: "system", content: report.prompt || DEFAULT_AI_PROMPT },
      { role: "user", content: JSON.stringify(input) },
    ],
  };
  const requestBody = JSON.stringify(request);
  // Reserve $1 before every paid attempt: <=30 KB input, 6000 output tokens and $20/M price ceilings.
  // Unknown cost after timeout stays charged conservatively, including each retry.
  if (Buffer.byteLength(requestBody) > 30000) {
    await db.aiReport.update({
      where: { id: reportId },
      data: {
        status: "failed",
        error: "Объём запроса превышает лимит бюджета. Сократите промпт.",
      },
    });
    return;
  }
  const reserved = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${report.organizationId} FOR UPDATE`;
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: report.organizationId },
    });
    const spent = await tx.aiReport.aggregate({
      where: { organizationId: report.organizationId },
      _sum: { cost: true },
    });
    if (
      organization.status !== "active" ||
      (spent._sum.cost ?? 0) + 1 > organization.aiBudget
    )
      return false;
    await tx.aiReport.update({
      where: { id: reportId },
      data: { status: "processing", error: null, cost: { increment: 1 } },
    });
    return true;
  });
  if (!reserved) {
    await db.aiReport.update({
      where: { id: reportId },
      data: {
        status: "budget_exceeded",
        error: "Лимит расходов исчерпан или организация приостановлена",
      },
    });
    return;
  }
  let refundReservation = false;
  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        signal: AbortSignal.timeout(120000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "AssessFlow",
        },
        body: requestBody,
      },
    );
    if (!response.ok) {
      refundReservation = true;
      throw new Error(`OpenRouter HTTP ${response.status}`);
    }
    const body = (await response.json()) as any;
    const actualCost = body.usage?.cost;
    if (
      typeof actualCost === "number" &&
      Number.isFinite(actualCost) &&
      actualCost >= 0
    )
      await db.aiReport.update({
        where: { id: reportId },
        data: { cost: { increment: actualCost - 1 } },
      });
    const content = aiContentSchema.parse(
      JSON.parse(body.choices?.[0]?.message?.content),
    );
    const ids = new Set(results.map((r) => r.id));
    for (const [section, entries] of Object.entries(content))
      if (section !== "limitations")
        for (const entry of entries as { evidenceIds: string[] }[])
          if (!entry.evidenceIds.every((id) => ids.has(id)))
            throw new Error("AI references unknown evidence");
    await db.aiReport.update({
      where: { id: reportId },
      data: {
        status: "completed",
        content: json(content),
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
      },
    });
    await audit(report.organizationId, null, "ai.completed", reportId);
  } catch (e) {
    const message =
      e instanceof z.ZodError
        ? "Ответ AI не соответствует схеме"
        : e instanceof Error
          ? e.message.slice(0, 250)
          : "Generation failed";
    await db.aiReport.update({
      where: { id: reportId },
      data: {
        status: attemptsMade + 1 >= maxAttempts ? "failed" : "processing",
        error: message,
        ...(refundReservation ? { cost: { decrement: 1 } } : {}),
      },
    });
    throw new Error(message);
  }
}
export function startAiWorker() {
  const worker = new Worker(
    "assessflow-ai",
    (job) => generateAi(job.data.reportId, job.attemptsMade, job.opts.attempts ?? 1),
    { connection, concurrency: 1 },
  );
  worker.on("error", () => {});
  worker.on("failed", (job, error) => {
    console.error("AI job failed", job?.id);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const message = error?.message.slice(0, 250) || "Generation failed";
      void db.aiReport
        .updateMany({
          where: {
            id: job.data.reportId,
            status: { in: ["pending", "processing"] },
          },
          data: { status: "failed", error: message },
        })
        .catch((persistError) =>
          console.error("Failed to persist terminal AI status", persistError),
        );
    }
  });
  return worker;
}
