import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import ExcelJS from "exceljs";
import { db, json, audit } from "./db";
import { requireRole, orgId, participant, type Context } from "./access";
import { getCampaign, listPeople } from "./people";
const labels = z.object({
  ru: z.string().trim().min(2).max(200),
  kk: z.string().trim().min(2).max(200),
});
const schemeContent = z
  .object({
    groups: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]+$/),
          name: labels,
          criteria: z.object({
            ru: z.string().max(3000),
            kk: z.string().max(3000),
          }),
        }),
      )
      .max(12),
  })
  .strict();
export async function grouping(ctx: Context, campaignId: string) {
  requireRole(ctx, "admin", "expert");
  await getCampaign(ctx, campaignId);
  const scheme = await db.groupScheme.findFirst({
    where: { organizationId: orgId(ctx) },
    orderBy: { version: "desc" },
  });
  const people = (await listPeople(ctx, campaignId)).filter(
    (p) => p.role === "employee",
  );
  const rows = await db.participantGroup.findMany({
    where: {
      organizationId: orgId(ctx),
      campaignId,
      membershipId: { in: people.map((p) => p.id) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { scheme: true },
  });
  return {
    scheme,
    people: people.map((p) => ({
      id: p.id,
      name: p.user.name,
      position: p.position,
      unit: p.unit,
      assignment: rows.find((r) => r.membershipId === p.id) || null,
    })),
  };
}
export async function saveScheme(ctx: Context, body: unknown) {
  requireRole(ctx, "expert");
  const data = z
    .object({
      version: z.number().int().min(0),
      content: schemeContent,
      approve: z.boolean().default(false),
    })
    .strict()
    .parse(body);
  const g = data.content.groups;
  if (
    new Set(g.map((g) => g.id)).size !== g.length ||
    ["ru", "kk"].some(
      (lang) =>
        new Set(g.map((g) => g.name[lang as "ru" | "kk"].toLocaleLowerCase()))
          .size !== g.length,
    )
  )
    throw new BadRequestException("Названия и ID групп должны различаться");
  if (
    data.approve &&
    (g.length < 2 ||
      g.some(
        (g) =>
          g.criteria.ru.trim().length < 10 || g.criteria.kk.trim().length < 10,
      ))
  )
    throw new BadRequestException(
      "Для утверждения задайте минимум две группы и критерии распределения на RU/KK",
    );
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${orgId(ctx)} FOR UPDATE`;
    const previous = await tx.groupScheme.findFirst({
      where: { organizationId: orgId(ctx) },
      orderBy: { version: "desc" },
    });
    if ((previous?.version || 0) !== data.version)
      throw new BadRequestException(
        "Справочник уже изменён. Обновите страницу.",
      );
    const row = await tx.groupScheme.create({
      data: {
        organizationId: orgId(ctx),
        version: data.version + 1,
        status: data.approve ? "approved" : "draft",
        content: json(data.content),
        authorId: ctx.user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId(ctx),
        actorId: ctx.user.id,
        action: data.approve ? "groups.approved" : "groups.draft_saved",
        entityId: row.id,
        detail: json({ version: row.version, count: g.length }),
      },
    });
    return row;
  });
}
export async function assignGroup(
  ctx: Context,
  campaignId: string,
  membershipId: string,
  body: unknown,
) {
  requireRole(ctx, "expert");
  await getCampaign(ctx, campaignId);
  const member = await participant(ctx, membershipId, campaignId);
  if (member.role !== "employee")
    throw new BadRequestException("Выберите сотрудника");
  const data = z
    .object({
      schemeId: z.string().min(1),
      groupId: z.string().min(1),
      reason: z.string().trim().min(20).max(3000),
    })
    .strict()
    .parse(body);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${orgId(ctx)} FOR UPDATE`;
    const scheme = await tx.groupScheme.findFirst({
      where: { organizationId: orgId(ctx) },
      orderBy: { version: "desc" },
    });
    if (!scheme || scheme.status !== "approved" || scheme.id !== data.schemeId)
      throw new BadRequestException(
        "Сначала утвердите актуальный справочник групп",
      );
    const config = schemeContent.parse(scheme.content);
    if (!config.groups.some((g) => g.id === data.groupId))
      throw new BadRequestException("Группа не найдена");
    const consensus = await tx.competencyConsensus.findFirst({
      where: { organizationId: orgId(ctx), campaignId, membershipId },
      orderBy: { version: "desc" },
    });
    const ratings = (consensus?.scores as any)?.ratings;
    const model =
      consensus &&
      (await tx.competencyModel.findFirst({
        where: {
          id: consensus.modelId,
          organizationId: orgId(ctx),
          status: "approved",
        },
      }));
    if (
      !model ||
      !Array.isArray(ratings) ||
      ratings.length !== 8 ||
      ratings.some(
        (r) => !Number.isInteger(r.value) || r.value < 1 || r.value > 5,
      )
    )
      throw new BadRequestException(
        "Сначала сохраните итоговые оценки всех восьми компетенций по утверждённой модели",
      );
    const row = await tx.participantGroup.create({
      data: {
        organizationId: orgId(ctx),
        campaignId,
        membershipId,
        schemeId: scheme.id,
        groupId: data.groupId,
        reason: data.reason,
        consensusId: consensus!.id,
        authorId: ctx.user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId(ctx),
        actorId: ctx.user.id,
        action: "groups.participant_assigned",
        entityId: row.id,
        detail: json({
          membershipId,
          campaignId,
          schemeId: scheme.id,
          groupId: data.groupId,
          consensusId: consensus!.id,
        }),
      },
    });
    return row;
  });
}
export async function exportGroups(ctx: Context, campaignId: string) {
  const data = await grouping(ctx, campaignId),
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Группы сотрудников");
  sheet.addRow([
    "ФИО",
    "Должность",
    "Подразделение",
    "Группа",
    "Обоснование эксперта",
    "Версия схемы",
    "Дата назначения",
  ]);
  for (const p of data.people) {
    const r = p.assignment;
    if (!r) continue;
    const group = schemeContent
      .parse(r.scheme.content)
      .groups.find((g) => g.id === r.groupId);
    sheet.addRow([
      p.name,
      p.position,
      p.unit,
      group?.name.ru || r.groupId,
      r.reason,
      r.scheme.version,
      r.createdAt,
    ]);
  }
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column, i) => {
    column.width = i === 4 ? 65 : 28;
  });
  await audit(orgId(ctx), ctx.user.id, "groups.exported", campaignId);
  return book.xlsx.writeBuffer();
}
