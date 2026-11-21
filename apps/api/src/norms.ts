import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, json } from "./db";
import { requireRole, orgId, type Context } from "./access";
import { getCampaign } from "./people";
import {
  buildFrozenPayload,
  type NormResult,
} from "../../../packages/core/frozen-norms";
import { invalidProfile } from "../../../packages/core/report-policy";
import { usableAttempt } from "../../../packages/core/result-validity";
export async function normRoster(
  client: any,
  organizationId: string,
  campaignId: string,
) {
  const tasks = await client.testAssignment.findMany({
    where: { organizationId, campaignId, membership: { role: "employee" } },
    include: {
      testVersion: { select: { testId: true } },
      attempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
        include: { results: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });
  const members = [
    ...new Set(tasks.map((t: any) => t.membershipId)),
  ] as string[];
  const rows: NormResult[] = tasks.flatMap((t: any) => {
    const a = t.attempts[0],
      r = a?.results[0];
    return usableAttempt(a) && r
      ? [
          {
            membershipId: t.membershipId,
            resultId: r.id,
            testId: t.testVersion.testId,
            testVersionId: t.testVersionId,
            scoringKeyId: r.scoringKeyId,
            language: a.language,
            score: r.result,
          },
        ]
      : [];
  });
  const completed = members.filter((id) =>
    tasks
      .filter((t: any) => t.membershipId === id)
      .every((t: any) => usableAttempt(t.attempts[0])),
  );
  const excluded = new Set(
    rows
      .filter((r) => invalidProfile({ results: [r] } as any))
      .map((r) => r.membershipId),
  );
  return {
    tasks,
    members,
    rows,
    completed: completed.length,
    excluded: excluded.size,
    pendingQuality: rows.filter((r) => r.score?.reviewRequired).length,
  };
}
export const normMetadata = (norm: any) =>
  norm
    ? {
        id: norm.id,
        createdAt: norm.createdAt,
        expectedCount: norm.expectedCount,
        excludedCount: norm.excludedCount,
        method: norm.metrics?.method,
        languageMode: norm.metrics?.languageMode,
        sourceHash: norm.sourceHash,
        country: norm.metrics?.provenance?.country || null,
        period: norm.metrics?.provenance?.period || null,
        provenance: norm.metrics?.provenance || null,
        actualN: Object.fromEntries((norm.metrics?.metrics || []).map((m: any) => [m.key, m.n])),
      }
    : null;
export async function getNormStatus(ctx: Context, campaignId: string) {
  requireRole(ctx, "admin", "expert");
  await getCampaign(ctx, campaignId);
  const norm = await db.frozenNorm.findFirst({
    where: { organizationId: orgId(ctx), campaignId },
  });
  const roster = await normRoster(db, orgId(ctx), campaignId);
  return {
    norm: normMetadata(norm),
    expectedCount: 65,
    assigned: roster.members.length,
    completed: roster.completed,
    excluded: roster.excluded,
    pendingQuality: roster.pendingQuality,
    ready:
      !norm &&
      roster.members.length === 65 &&
      roster.completed === 65 &&
      roster.pendingQuality === 0,
  };
}
export async function freezeNorm(
  ctx: Context,
  campaignId: string,
  input: unknown,
) {
  requireRole(ctx, "expert");
  const campaign = await getCampaign(ctx, campaignId);
  if (!campaign) throw new BadRequestException("Кампания не найдена");
  const data = z
    .object({
      confirm: z.literal(true),
      reason: z.string().trim().min(10).max(3000),
      languageMode: z.enum(["separate", "combined"]).default("separate"),
      confirmEquivalentLanguages: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  if (data.languageMode === "combined" && !data.confirmEquivalentLanguages)
    throw new BadRequestException(
      "Для общей нормы RU/KK эксперт должен подтвердить сопоставимость языковых версий",
    );
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id=${orgId(ctx)} FOR UPDATE`;
        const existing = await tx.frozenNorm.findFirst({
          where: { organizationId: orgId(ctx), campaignId },
        });
        if (existing) return normMetadata(existing);
        const roster = await normRoster(tx, orgId(ctx), campaignId);
        if (
          ctx.role === "expert" &&
          roster.members.some(
            (id) =>
              !roster.tasks.some(
                (t: any) =>
                  t.membershipId === id &&
                  (t.expertId === ctx.member!.id ||
                    t.assessorIds.includes(ctx.member!.id)),
              ),
          )
        )
          throw new ForbiddenException(
            "Фиксация доступна эксперту, которому назначена вся группа",
          );
        if (roster.members.length !== 65 || roster.completed !== 65)
          throw new BadRequestException(
            `Нужны завершённые назначения всех 65 участников. Назначено: ${roster.members.length}, завершили: ${roster.completed}`,
          );
        if (roster.pendingQuality)
          throw new BadRequestException(
            "Сначала завершите проверку качества проблемных опросников",
          );
        const metrics = {
          ...buildFrozenPayload(roster.rows, data.languageMode),
          provenance: {
            source: "campaign",
            // Country is an explicit source-sample attribute, never inferred
            // from the organization, host location, or interface language.
            country: (campaign as any).country || null,
            period: campaign.startsAt && campaign.endsAt ? { startsAt: campaign.startsAt.toISOString(), endsAt: campaign.endsAt.toISOString() } : null,
          },
        };
        if (!metrics.metrics.some((m) => m.n >= 30))
          throw new BadRequestException(
            "Нет минимум 30 сопоставимых достоверных результатов для расчёта нормы",
          );
        const sourceHash = createHash("sha256")
          .update(
            JSON.stringify({
              method: metrics.method,
              languageMode: data.languageMode,
              provenance: metrics.provenance,
              rows: [...roster.rows].sort((a, b) =>
                a.resultId.localeCompare(b.resultId),
              ),
            }),
          )
          .digest("hex");
        const norm = await tx.frozenNorm.create({
          data: {
            organizationId: orgId(ctx),
            campaignId,
            expectedCount: 65,
            excludedCount: roster.excluded,
            metrics: json(metrics),
            sourceHash,
            createdBy: ctx.user.id,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: orgId(ctx),
            actorId: ctx.user.id,
            action: "norm.frozen",
            entityId: norm.id,
            detail: json({
              reason: data.reason,
              sourceHash,
              expectedCount: 65,
              excluded: roster.excluded,
              method: metrics.method,
              languageMode: data.languageMode,
              confirmEquivalentLanguages: data.confirmEquivalentLanguages,
            }),
          },
        });
        return normMetadata(norm);
      },
      { isolationLevel: "Serializable", timeout: 20000 },
    );
  } catch (error: any) {
    if (["P2002", "P2034"].includes(error.code)) {
      const saved = await db.frozenNorm.findFirst({
        where: { organizationId: orgId(ctx), campaignId },
      });
      if (saved) return normMetadata(saved);
      throw new BadRequestException(
        "Результаты изменились во время фиксации. Проверьте данные и повторите действие.",
      );
    }
    throw error;
  }
}
