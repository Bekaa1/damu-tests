import { resolveProfileBinding } from "../../../packages/core/profile-binding";
import {
  DEFAULT_COMPETENCIES,
  exerciseCriteria,
} from "../../../packages/core/competencies";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { hashPassword } from "better-auth/crypto";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, audit, json } from "./db";
import { orgId, requireRole, participant, type Context } from "./access";
import { defaultMatrix } from "../../../packages/core/contracts";
import { usableAttempt } from "../../../packages/core/result-validity";
import { participantDataExpired } from "../../../packages/core/data-policy";
export async function createOrganization(ctx: Context, input: unknown) {
  requireRole(ctx, "superadmin");
  const d = z
    .object({
      name: z.string().min(2).max(150),
      slug: z.string().regex(/^[a-z0-9-]{3,50}$/),
      purpose: z.enum(["assessment", "pilot"]).default("assessment"),
      dataMode: z.enum(["real", "synthetic"]).default("real"),
      adminName: z.string().min(3).max(150),
      adminEmail: z.email().transform((s) => s.toLowerCase()),
    })
    .parse(input);
  const temporaryPassword = `Af!${randomBytes(12).toString("base64url")}`,
    password = await hashPassword(temporaryPassword);
  const result = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: d.name,
        slug: d.slug,
        purpose: d.purpose,
        dataMode: d.dataMode,
        showPreliminary: true,
        showApproved: true,
        matrixConfig: json(defaultMatrix),
      },
    });
    const user = await tx.user.create({
      data: {
        name: d.adminName,
        email: d.adminEmail,
        emailVerified: true,
        mustChangePassword: true,
      },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password,
      },
    });
    const admin = await tx.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: "admin" },
    });
    await tx.organizationUnit.create({
      data: { organizationId: organization.id, name: "Головной офис" },
    });
    const exercises = [
      ["group", "Групповое упражнение", "Топтық жаттығу"],
      ["roleplay", "Ролевая игра", "Рөлдік ойын"],
      ["presentation", "Аналитическая презентация", "Талдау таныстырылымы"],
      ["interview", "Структурированное интервью", "Құрылымдалған сұхбат"],
      ["facts", "Поиск фактов", "Деректерді іздеу"],
    ];
    for (const [type, ru, kk] of exercises)
      await tx.assessmentExercise.create({
        data: {
          organizationId: organization.id,
          type,
          name: json({ ru, kk }),
          criteria: json(exerciseCriteria(DEFAULT_COMPETENCIES, type)),
        },
      });
    await tx.competencyModel.create({
      data: {
        organizationId: organization.id,
        version: 1,
        content: json(DEFAULT_COMPETENCIES),
        authorId: ctx.user.id,
      },
    });
    return {
      organization,
      admin: {
        ...admin,
        user: { name: user.name, email: user.email },
        temporaryPassword,
      },
    };
  });
  await audit(
    result.organization.id,
    ctx.user.id,
    "organization.created",
    result.organization.id,
  );
  return result;
}
export const personSchema = z.object({
  name: z.string().trim().min(3).max(150),
  email: z.email().transform((s) => s.toLowerCase()),
  position: z.string().max(300).default(""),
  unit: z.string().max(300).default(""),
  profileRow: z.preprocess(v => v === "" || v == null ? undefined : typeof v === "string" && /^(?:[1-9]|[1-5][0-9]|6[0-5])$/.test(v) ? Number(v) : v, z.number().int().min(1).max(65).optional()),
  category: z.string().max(100).default("Руководитель"),
  locale: z.enum(["ru", "kk"]).default("ru"),
  role: z.enum(["employee", "expert", "admin"]).default("employee"),
}).superRefine((p,ctx)=>{
  if(p.profileRow===undefined && !p.unit.trim()) ctx.addIssue({code:"custom",path:["unit"],message:"Укажите подразделение или номер профиля"});
}).transform((p,ctx)=>{
  try {
    const profile=p.profileRow===undefined ? undefined : resolveProfileBinding(p.profileRow,{unit:p.unit,position:p.position});
    return {...p, ...profile, block:profile?.block ?? null, targetLevelModel:profile?.targetLevelModel ?? "В"};
  } catch(error) {
    ctx.addIssue({code:"custom",path:["profileRow"],message:error instanceof Error ? error.message : "Некорректный должностной профиль"});
    return z.NEVER;
  }
});
export async function createPerson(ctx: Context, input: unknown) {
  requireRole(ctx, "admin");
  const data = personSchema.parse(input);
  const organizationId = orgId(ctx);
  const password = `Af!${randomBytes(12).toString("base64url")}`;
  const hashed = await hashPassword(password);
  const created = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
    const count = await tx.membership.count({
      where: { organizationId, status: "active", role: "employee" },
    });
    if (data.role === "employee" && count >= ctx.org!.employeeLimit)
      throw new BadRequestException("Достигнут лимит сотрудников");
    const existing = await tx.user.findUnique({ where: { email: data.email } });
    if (existing)
      throw new BadRequestException(
        "Этот email уже зарегистрирован. Используйте другой адрес или обратитесь к администратору платформы.",
      );
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        locale: data.locale,
        mustChangePassword: true,
        emailVerified: true,
      },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hashed,
      },
    });
    await tx.organizationUnit.upsert({
      where: { organizationId_name: { organizationId, name: data.unit } },
      create: { organizationId, name: data.unit },
      update: {},
    });
    return tx.membership.create({
      data: {
        organizationId,
        userId: user.id,
        role: data.role,
        profileRow: data.profileRow ?? null,
        block: data.block,
        targetLevelModel: data.targetLevelModel,
        position: data.position,
        unit: data.unit,
        category: data.category,
      },
      include: { user: { select: { name: true, email: true, locale: true } } },
    });
  });
  await audit(organizationId, ctx.user.id, "employee.created", created.id, {
    role: data.role,
  });
  return { ...created, temporaryPassword: password };
}
export async function resetPassword(ctx: Context, id: string) {
  requireRole(ctx, "admin");
  const person = await participant(ctx, id);
  const target = await db.user.findUniqueOrThrow({
    where: { id: person.userId },
  });
  if (target.platformAdmin && ctx.role !== "superadmin")
    throw new ForbiddenException(
      "Учётной записью владельца управляет суперадминистратор",
    );
  const password = `Af!${randomBytes(12).toString("base64url")}`;
  const hashed = await hashPassword(password);
  await db.$transaction([
    db.account.updateMany({
      where: { userId: person.userId, providerId: "credential" },
      data: { password: hashed },
    }),
    db.user.update({
      where: { id: person.userId },
      data: { mustChangePassword: true },
    }),
    db.session.deleteMany({ where: { userId: person.userId } }),
  ]);
  await audit(orgId(ctx), ctx.user.id, "employee.password_reset", id);
  return { temporaryPassword: password };
}
export async function getCampaign(ctx: Context, id?: string) {
  const campaign = await db.campaign.findFirst({
    where: { organizationId: orgId(ctx), ...(id ? { id } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (id && !campaign) throw new NotFoundException("Кампания не найдена");
  return campaign;
}
export async function listPeople(ctx: Context, campaignId?: string, membershipId?: string) {
  requireRole(ctx, "admin", "expert");
  const organizationId = orgId(ctx);
  const campaign = await getCampaign(ctx, campaignId);
  const assigned =
    ctx.role === "expert"
      ? await db.testAssignment.findMany({
          where: {
            organizationId,
            OR: [
              { expertId: ctx.member!.id },
              { assessorIds: { has: ctx.member!.id } },
            ],
            ...(campaign ? { campaignId: campaign.id } : {}),
          },
          select: { membershipId: true },
        })
      : null;
  const members = await db.membership.findMany({
    where: {
      organizationId,
      status: "active",
      ...(assigned ? { id: { in: assigned.map((a) => a.membershipId) } } : {}),
      ...(membershipId ? { AND: { id: membershipId } } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          locale: true,
          mustChangePassword: true,
          platformAdmin: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const assignments = campaign
    ? await db.testAssignment.findMany({
        where: { organizationId, campaignId: campaign.id, membershipId },
        include: {
          testVersion: {
            include: { test: true, _count: { select: { questions: true } } },
          },
          attempts: {
            orderBy: { attemptNumber: "desc" },
            take: 1,
            include: {
              results: { orderBy: { createdAt: "desc" }, take: 1 },
              _count: { select: { answers: true } },
            },
          },
        },
      })
    : [];
  const reports = campaign
    ? await db.finalReport.findMany({
        where: { organizationId, campaignId: campaign.id, membershipId },
        orderBy: { version: "desc" },
      })
    : [];
  const ai = campaign
    ? await db.aiReport.findMany({
        where: { organizationId, campaignId: campaign.id, membershipId },
        orderBy: { createdAt: "desc" },
      })
    : [];
  // Deny disclosure even when storage cleanup has not yet erased the rows.
  const eligibilityTime = new Date();
  const eligibleMembers = members.filter(
    (m) => m.user.platformAdmin || !participantDataExpired(m, ctx.org, eligibilityTime),
  );
  return eligibleMembers.map((m) => {
    const { platformAdmin: _platformAdmin, ...user } = m.user;
    const tasks = assignments.filter((a) => a.membershipId === m.id);
    const done = tasks.filter((a) => usableAttempt(a.attempts[0])).length;
    const now = Date.now();
    const activeAttempt = tasks.some(
      (a) =>
        a.attempts[0]?.status === "in_progress" &&
        (a.attempts[0]?._count.answers ?? 0) > 0,
    );
    const expiredAttempt = tasks.some((a) =>
      ["expired", "retry_required"].includes(a.attempts[0]?.status),
    );
    const report = reports.find((r) => r.membershipId === m.id);
    return {
      ...m,
      user,
      total: tasks.length,
      completed: done,
      progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      status:
        tasks.length === 0
          ? "unassigned"
          : done === tasks.length
            ? "completed"
            : expiredAttempt
              ? "retry_required"
              : done > 0 || activeAttempt
                ? "in_progress"
                : "not_started",
      expertId: tasks[0]?.expertId,
      report: report
        ? {
            id: report.id,
            status: report.status,
            matrixX: report.matrixX,
            matrixY: report.matrixY,
            version: report.version,
          }
        : null,
      aiStatus:
        ai.find((r) => r.membershipId === m.id)?.status ?? "not_started",
      results: tasks.map((a) => ({
        resultId: a.attempts[0]?.results[0]?.id,
        testId: a.testVersion.testId,
        testVersionId: a.testVersionId,
        version: a.testVersion.version,
        scoringKeyId: a.attempts[0]?.results[0]?.scoringKeyId,
        language: a.attempts[0]?.language,
        name: a.testVersion.test.name,
        score: usableAttempt(a.attempts[0])
          ? a.attempts[0].results[0].result
          : null,
      })),
    };
  });
}
export async function createCampaign(ctx: Context, input: unknown) {
  requireRole(ctx, "admin");
  const data = z
    .object({
      name: z.string().min(3).max(150),
      description: z.string().max(1000).default(""),
      country: z.preprocess(v=>typeof v === "string" && !v.trim() ? undefined : v, z.string().trim().min(2).max(100).nullable().optional()),
      endsAt: z.iso.datetime(),
    })
    .parse(input);
  if (new Date(data.endsAt) <= new Date())
    throw new BadRequestException("Дата окончания должна быть в будущем");
  const result = await db.campaign.create({
    data: { ...data, organizationId: orgId(ctx) },
  });
  await audit(orgId(ctx), ctx.user.id, "campaign.created", result.id);
  return result;
}
export async function assignTests(ctx: Context, input: unknown) {
  requireRole(ctx, "admin");
  const data = z
    .object({
      campaignId: z.string(),
      membershipIds: z.array(z.string()).min(1).max(500),
      testVersionIds: z.array(z.string()).min(1).max(30),
      expertId: z.string(),
    })
    .parse(input);
  const organizationId = orgId(ctx);
  const campaign = await getCampaign(ctx, data.campaignId);
  if (campaign?.status !== "active" || campaign.endsAt < new Date())
    throw new BadRequestException("Кампания закрыта");
  const people = await db.membership.count({
    where: {
      organizationId,
      id: { in: data.membershipIds },
      role: "employee",
      status: "active",
    },
  });
  if (people !== new Set(data.membershipIds).size)
    throw new BadRequestException("Некорректный список сотрудников");
  const expert = await db.membership.findFirst({
    where: {
      id: data.expertId,
      organizationId,
      role: "expert",
      status: "active",
    },
  });
  if (!expert) throw new BadRequestException("Выберите эксперта организации");
  const versions = await db.testVersion.findMany({
    where: { id: { in: data.testVersionIds }, status: "published" },
    include: { questions: true, keys: true },
  });
  if (
    versions.length !== new Set(data.testVersionIds).size ||
    versions.some((v) => !v.questions.length || !v.keys.length)
  )
    throw new BadRequestException(
      "Назначать можно опубликованные методики с вопросами и ключом",
    );
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
    const current = await tx.testAssignment.count({
      where: { organizationId },
    });
    const existing = await tx.testAssignment.count({
      where: {
        organizationId,
        campaignId: data.campaignId,
        membershipId: { in: data.membershipIds },
        testVersionId: { in: data.testVersionIds },
      },
    });
    if (
      current + people * versions.length - existing >
      ctx.org!.assessmentLimit
    )
      throw new BadRequestException("Превышен лимит тестирований");
    for (const membershipId of data.membershipIds) {
      await tx.testAssignment.updateMany({
        where: { organizationId, campaignId: data.campaignId, membershipId },
        data: { expertId: data.expertId },
      });
      for (const testVersionId of data.testVersionIds)
        await tx.testAssignment.upsert({
          where: {
            campaignId_membershipId_testVersionId: {
              campaignId: data.campaignId,
              membershipId,
              testVersionId,
            },
          },
          create: {
            organizationId,
            campaignId: data.campaignId,
            membershipId,
            testVersionId,
            expertId: data.expertId,
          },
          update: { expertId: data.expertId },
        });
    }
    return { assigned: people * versions.length };
  });
  await audit(organizationId, ctx.user.id, "tests.assigned", data.campaignId, {
    count: result.assigned,
  });
  return result;
}
