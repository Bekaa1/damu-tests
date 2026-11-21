import { BadRequestException } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { db, json, audit } from "./db";
import { orgId, requireRole, type Context } from "./access";
import { LEGACY_COMPETENCIES } from "../../../packages/core/competencies";
import { HOLDING_MODEL_VERSION, HOLDING_SJT_CASES } from "../../../packages/core/holding";
import { compileEffectivenessKey } from "../../../packages/core/sjt-calibration";
import { calculateScore } from "../../../packages/core/scoring";
const definition = async () =>
  JSON.parse(
    await readFile(
      resolve(process.cwd(), "data/review/sjt-16-draft.json"),
      "utf8",
    ),
  );
export async function getSjtExpertKey(ctx: Context) {
  requireRole(ctx, "expert");
  const model = await db.competencyModel.findFirst({ where: { organizationId: orgId(ctx) }, orderBy: { version: "desc" } });
  if ((model?.content as any)?.holdingModelVersion === HOLDING_MODEL_VERSION) {
    const forms = JSON.parse(await readFile(resolve(process.cwd(), "data/new-forms.json"), "utf8"));
    const form = forms.find((f: any) => f.id === "situations");
    return { questions: form.questions, cases: HOLDING_SJT_CASES, version: 0, ratings: {}, status: "unapproved",
      holdingModelVersion: HOLDING_MODEL_VERSION, keyPanelLabel: "Ключ не утверждён экспертной панелью" };
  }
  const d = await definition(),
    row = await db.sjtExpertKey.findFirst({
      where: { organizationId: orgId(ctx) },
      orderBy: { version: "desc" },
    });
  return {
    questions: d.questions,
    version: row?.version || 0,
    status: row?.status || "draft",
    ratings: (row?.payload as any)?.ratings || {},
  };
}
export async function saveSjtExpertKey(ctx: Context, body: unknown) {
  requireRole(ctx, "expert");
  const model = await db.competencyModel.findFirst({ where: { organizationId: orgId(ctx) }, orderBy: { version: "desc" } });
  if ((model?.content as any)?.holdingModelVersion === HOLDING_MODEL_VERSION)
    throw new BadRequestException("Ключ Холдинга остаётся черновым до утверждения экспертной панелью. Формула 28 баллов не заменяется весами; изменения оформляются новой версией с журналом.");
  const data = z
    .object({
      version: z.number().int().min(0),
      approve: z.boolean().default(false),
      ratings: z.record(
        z.string(),
        z.record(z.string(), z.number().int().min(1).max(5).nullable()),
      ),
    })
    .strict()
    .parse(body);
  const d = await definition();
  for (const [qid, ratings] of Object.entries(data.ratings)) {
    const q = d.questions.find((q: any) => q.id === qid);
    if (
      !q ||
      Object.keys(ratings).some(
        (oid) => !q.options.some((o: any) => o.id === oid),
      )
    )
      throw new BadRequestException("Неизвестная ситуация или вариант");
  }
  if (data.approve) {
    try {
      compileEffectivenessKey(
        d.questions,
        expertPanel(d, data.ratings, ctx.user.name),
      );
    } catch (error: any) {
      throw new BadRequestException(
        error.message || "Проверьте оценки всех 64 вариантов",
      );
    }
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${orgId(ctx)} FOR UPDATE`;
    const latest = await tx.sjtExpertKey.findFirst({
      where: { organizationId: orgId(ctx) },
      orderBy: { version: "desc" },
    });
    if ((latest?.version || 0) !== data.version)
      throw new BadRequestException("Ключ уже изменён. Откройте его заново.");
    const row = await tx.sjtExpertKey.create({
      data: {
        organizationId: orgId(ctx),
        version: data.version + 1,
        status: data.approve ? "ready" : "draft",
        payload: json({
          ratings: data.ratings,
          approvedBy: ctx.user.name,
          mode: "single",
        }),
        authorId: ctx.user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId(ctx),
        actorId: ctx.user.id,
        action: data.approve ? "sjt.expert_key_ready" : "sjt.expert_key_draft",
        entityId: row.id,
        detail: json({ version: row.version, mode: "single" }),
      },
    });
    return { version: row.version, status: row.status };
  });
}
function expertPanel(d: any, ratings: any, name: string) {
  return {
    mode: "single",
    approvedBy: name,
    experts: [name],
    cases: Object.fromEntries(
      d.questions.map((q: any) => [
        q.id,
        {
          competencyId: LEGACY_COMPETENCIES.competencies.find(
            (c) => c.name.ru === d.config.items[q.id].competency.ru,
          )!.id,
          options: Object.fromEntries(
            q.options.map((o: any) => [
              o.id,
              ratings[q.id]?.[o.id] == null ? [] : [ratings[q.id][o.id]],
            ]),
          ),
        },
      ]),
    ),
  };
}
export async function exportSjtExpertKey(ctx: Context) {
  requireRole(ctx, "expert");
  const row = await db.sjtExpertKey.findFirst({
    where: { organizationId: orgId(ctx) },
    orderBy: { version: "desc" },
  });
  if (row?.status !== "ready")
    throw new BadRequestException(
      "Сначала завершите и утвердите экспертный ключ",
    );
  const d = await definition(),
    old = d.questions,
    ratings = (row.payload as any).ratings;
  const prefix = `situations-expert-${orgId(ctx)}-${row.version}`;
  d.questions = old.map((q: any, i: number) => ({
    ...q,
    id: `${prefix}-${i + 1}`,
    options: q.options.map((o: any, j: number) => ({
      ...o,
      id: `${prefix}-${i + 1}-${j + 1}`,
    })),
  }));
  const remapped = Object.fromEntries(
    d.questions.map((q: any, i: number) => [
      q.id,
      Object.fromEntries(
        q.options.map((o: any, j: number) => [
          o.id,
          ratings[old[i].id]?.[old[i].options[j].id],
        ]),
      ),
    ]),
  );
  // Competency mapping comes from the authored source, never from the option ratings.
  const original = await definition();
  d.config.items = Object.fromEntries(
    d.questions.map((q: any, i: number) => [
      q.id,
      original.config.items[old[i].id],
    ]),
  );
  const config = compileEffectivenessKey(
    d.questions,
    expertPanel(d, remapped, (row.payload as any).approvedBy),
  );
  const answers = Object.fromEntries(
    d.questions.map((q: any) => {
      const ids = q.options
        .map((o: any) => o.id)
        .sort(
          (a: string, b: string) =>
            config.items[q.id].effectiveness![b] -
            config.items[q.id].effectiveness![a],
        );
      return [q.id, { most: ids[0], least: ids.at(-1) }];
    }),
  );
  await audit(orgId(ctx), ctx.user.id, "sjt.expert_key_exported", row.id);
  return {
    testId: d.id,
    version: `3.0-expert-${orgId(ctx)}-${row.version}`,
    name: d.name,
    description: d.description,
    direction: d.direction,
    source: d.source,
    licenseStatus: d.licenseStatus,
    scientificBasis:
      "Экспертный ключ одного специалиста; публикация после методологической проверки и пилота.",
    durationMinutes: d.durationMinutes,
    timeLimitSeconds: d.timeLimitSeconds,
    instructions: d.instructions,
    limitations: d.limitations,
    delivery: d.delivery,
    questions: d.questions,
    algorithm: "sjt",
    config,
    controlExamples: [
      {
        name: "Идеальные разности",
        answers,
        expected: calculateScore("sjt", config, d.questions, answers),
      },
    ],
  };
}
