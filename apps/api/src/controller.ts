import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import type { Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, audit, json } from "./db";
import { auth } from "./auth";
import { exportPersonalData, erasePersonalData } from "./privacy";
import { encryptSecret, openRouterKey } from "./secrets";
import {
  AccessGuard,
  orgId,
  requireRole,
  participant,
  type AuthRequest,
} from "./access";
import {
  createPerson,
  createOrganization,
  resetPassword,
  listPeople,
  createCampaign,
  assignTests,
} from "./people";
import {
  myAssignments,
  startAttempt,
  getAttempt,
  saveAnswer,
  submitAttempt,
  recalculate,
  questionDTO,
} from "./attempts";
import {
  participantDetails,
  saveExercise,
  saveObservation,
  saveReport,
  getReport,
} from "./assessment";
import { queueAi } from "./ai";
import {
  defaultMatrix,
  DEFAULT_AI_PROMPT,
} from "../../../packages/core/contracts";
import {
  questionSchema,
  calculateScore,
  verifyScoringConfig,
  type ScoringConfig,
} from "../../../packages/core/scoring";
import {
  exportPeople,
  importPeople,
  exportIndividualPdf,
  exportTeamPdf,
} from "./exports";
import { uploadAsset, downloadAsset } from "./storage";
@Controller("api")
@UseGuards(AccessGuard)
export class AppController {
  @Get("me") async me(@Req() req: AuthRequest) {
    return {
      user: {
        id: req.ctx.user.id,
        name: req.ctx.user.name,
        email: req.ctx.user.email,
        locale: req.ctx.user.locale,
        mustChangePassword: req.ctx.user.mustChangePassword,
      },
      role: req.ctx.role,
      member: req.ctx.member,
      organization: req.ctx.org,
      organizations: await db.organization.findMany({
        where:
          req.ctx.role === "superadmin"
            ? {}
            : {
                memberships: {
                  some: { userId: req.ctx.user.id, status: "active" },
                },
              },
        select: { id: true, name: true, slug: true },
      }),
      demo: process.env.DEMO_MODE === "true",
    };
  }
  @Post("me/password") async password(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = z
      .object({
        currentPassword: z.string(),
        newPassword: z.string().min(12).max(128),
      })
      .parse(body);
    const changed = await auth.api.changePassword({
      headers: fromNodeHeaders(req.headers),
      body: { ...data, revokeOtherSessions: true },
      returnHeaders: true,
    });
    const cookies = changed.headers.getSetCookie();
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    await db.user.update({
      where: { id: req.ctx.user.id },
      data: { mustChangePassword: false },
    });
    await audit(req.ctx.org?.id ?? null, req.ctx.user.id, "password.changed");
    return { ok: true };
  }
  @Post("me/consent") async consent(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    z.object({ accepted: z.literal(true) }).parse(body);
    if (!req.ctx.member) throw new BadRequestException();
    await db.membership.update({
      where: { id: req.ctx.member.id },
      data: { consentAt: new Date(), consentVersion: "1.0" },
    });
    await audit(
      orgId(req.ctx),
      req.ctx.user.id,
      "consent.accepted",
      req.ctx.member.id,
      { version: "1.0" },
    );
    return { ok: true };
  }
  @Patch("me/locale") async locale(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const data = z.object({ locale: z.enum(["ru", "kk"]) }).parse(body);
    await db.user.update({ where: { id: req.ctx.user.id }, data });
    return { ok: true };
  }
  @Get("campaigns") async campaigns(@Req() req: AuthRequest) {
    const organizationId = orgId(req.ctx);
    return db.campaign.findMany({
      where: {
        organizationId,
        ...(req.ctx.role === "employee"
          ? { assignments: { some: { membershipId: req.ctx.member!.id } } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }
  @Post("campaigns") campaign(@Req() req: AuthRequest, @Body() body: unknown) {
    return createCampaign(req.ctx, body);
  }
  @Post("assignments") assign(@Req() req: AuthRequest, @Body() body: unknown) {
    return assignTests(req.ctx, body);
  }
  @Get("people") people(
    @Req() req: AuthRequest,
    @Query("campaignId") campaignId?: string,
  ) {
    return listPeople(req.ctx, campaignId);
  }
  @Post("people") create(@Req() req: AuthRequest, @Body() body: unknown) {
    return createPerson(req.ctx, body);
  }
  @Post("people/:id/reset-password") reset(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return resetPassword(req.ctx, id);
  }
  @Patch("people/:id") async editPerson(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    requireRole(req.ctx, "admin");
    await participant(req.ctx, id);
    const data = z
      .object({
        position: z.string().max(150).optional(),
        unit: z.string().min(1).max(150).optional(),
        category: z.string().max(150).optional(),
        status: z.enum(["active", "blocked"]).optional(),
      })
      .parse(body);
    const member = await db.membership.update({ where: { id }, data });
    if (data.status === "blocked")
      await db.session.deleteMany({ where: { userId: member.userId } });
    await audit(orgId(req.ctx), req.ctx.user.id, "employee.updated", id);
    return { ok: true };
  }
  @Get("people/:id/data") async personalExport(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    res
      .type("application/json")
      .attachment("assessflow-personal-data.json")
      .send(JSON.stringify(await exportPersonalData(req.ctx, id), null, 2));
  }
  @Delete("people/:id") async erase(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return erasePersonalData(req.ctx, id, body);
  }
  @Get("people/:id") details(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Query("campaignId") campaignId: string,
  ) {
    if (!campaignId) throw new BadRequestException("Выберите кампанию");
    return participantDetails(req.ctx, id, campaignId);
  }
  @Get("my/assignments") mine(
    @Req() req: AuthRequest,
    @Query("campaignId") campaignId?: string,
  ) {
    return myAssignments(req.ctx, campaignId);
  }
  @Post("assignments/:id/start") start(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return startAttempt(req.ctx, id, body);
  }
  @Get("attempts/:id") attempt(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return getAttempt(req.ctx, id);
  }
  @Post("attempts/:id/answers") answer(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return saveAnswer(req.ctx, id, body);
  }
  @Post("attempts/:id/submit") async submit(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    const result = await submitAttempt(req.ctx, id);
    void queueAi(orgId(req.ctx), result.campaignId, result.membershipId).catch(
      () => {},
    );
    return result;
  }
  @Post("attempts/:id/recalculate") recalc(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return recalculate(
      req.ctx,
      id,
      z.object({ keyId: z.string() }).parse(body).keyId,
    );
  }
  @Get("tests") async tests(@Req() req: AuthRequest) {
    requireRole(req.ctx, "admin", "expert");
    return db.test.findMany({
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { questions: true } } },
        },
      },
    });
  }
  @Get("exercises") exercises(@Req() req: AuthRequest) {
    requireRole(req.ctx, "admin", "expert");
    return db.assessmentExercise.findMany({
      where: { organizationId: orgId(req.ctx), active: true },
      orderBy: { type: "asc" },
    });
  }
  @Post("exercises") exercise(@Req() req: AuthRequest, @Body() body: unknown) {
    return saveExercise(req.ctx, undefined, body);
  }
  @Post("exercises/:id/version") exerciseVersion(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return saveExercise(req.ctx, id, body);
  }
  @Post("observations") observation(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return saveObservation(req.ctx, body);
  }
  @Post("reports") report(@Req() req: AuthRequest, @Body() body: unknown) {
    return saveReport(req.ctx, body);
  }
  @Get("reports/:id") reportDetails(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return getReport(req.ctx, id);
  }
  @Post("ai/generate") async ai(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    requireRole(req.ctx, "admin", "expert");
    const d = z
      .object({ campaignId: z.string(), membershipId: z.string() })
      .parse(body);
    await participant(req.ctx, d.membershipId, d.campaignId);
    return queueAi(orgId(req.ctx), d.campaignId, d.membershipId, true);
  }
  @Get("activity") async activity(@Req() req: AuthRequest) {
    requireRole(req.ctx, "admin");
    return db.auditLog.findMany({
      where: { organizationId: orgId(req.ctx) },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
  }
  @Get("settings") settings(@Req() req: AuthRequest) {
    requireRole(req.ctx, "admin");
    return req.ctx.org;
  }
  @Patch("settings") async settingsSave(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    requireRole(req.ctx, "admin");
    const data = z
      .object({
        name: z.string().min(2).max(100).optional(),
        showPreliminary: z.boolean().optional(),
        showApproved: z.boolean().optional(),
        retentionDays: z.number().int().min(30).max(3650).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        matrixConfig: z
          .object({
            x: z.object({ ru: z.string().min(1), kk: z.string().min(1) }),
            y: z.object({ ru: z.string().min(1), kk: z.string().min(1) }),
            levels: z
              .array(z.object({ ru: z.string(), kk: z.string() }))
              .length(3),
            criteria: z.string().min(10),
          })
          .optional(),
        logoUrl: z
          .string()
          .max(500000)
          .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
          .optional(),
      })
      .parse(body);
    const r = await db.organization.update({
      where: { id: orgId(req.ctx) },
      data,
    });
    await audit(
      orgId(req.ctx),
      req.ctx.user.id,
      "organization.settings_updated",
    );
    return r;
  }
  @Get("export/people") async excel(
    @Req() req: AuthRequest,
    @Query("campaignId") c: string,
    @Res() res: Response,
  ) {
    requireRole(req.ctx, "admin");
    const buffer = await exportPeople(req.ctx, c);
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .attachment("assessflow-results.xlsx")
      .send(buffer);
  }
  @Post("import/people") import(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return importPeople(req.ctx, body);
  }
  @Get("export/team") async team(
    @Req() req: AuthRequest,
    @Query("campaignId") c: string,
    @Res() res: Response,
  ) {
    requireRole(req.ctx, "admin", "expert");
    const buffer = await exportTeamPdf(req.ctx, c);
    res.type("application/pdf").attachment("assessflow-team.pdf").send(buffer);
  }
  @Get("reports/:id/pdf") async pdf(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    res
      .type("application/pdf")
      .attachment(`assessflow-${id}.pdf`)
      .send(await exportIndividualPdf(req.ctx, id));
  }
  @Post("files") upload(@Req() req: AuthRequest, @Body() body: unknown) {
    return uploadAsset(req.ctx, body);
  }
  @Get("files/:id") async download(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const file = await downloadAsset(req.ctx, id);
    res.type(file.contentType).attachment(file.name).send(file.bytes);
  }
  @Get("assets/omib/:name") async image(
    @Req() req: AuthRequest,
    @Param("name") name: string,
    @Res() res: Response,
  ) {
    if (!/^item-\d+(-option-\d+)?\.svg$/.test(name))
      throw new NotFoundException();
    if (req.ctx.role === "employee") {
      const allowed = await db.testAssignment.count({
        where: {
          organizationId: orgId(req.ctx),
          membershipId: req.ctx.member!.id,
          testVersion: { testId: "logical" },
        },
      });
      if (!allowed) throw new ForbiddenException();
    }
    const bytes = await readFile(resolve("data/assets/omib", name)).catch(
      () => null,
    );
    if (!bytes) throw new NotFoundException();
    res
      .type("image/svg+xml")
      .setHeader("Cache-Control", "private, max-age=3600")
      .send(bytes);
  }
  @Get("platform/organizations") async organizations(@Req() req: AuthRequest) {
    requireRole(req.ctx, "superadmin");
    return db.organization.findMany({
      include: { _count: { select: { memberships: true, campaigns: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
  @Post("platform/organizations") async newOrg(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return createOrganization(req.ctx, body);
  }
  @Patch("platform/organizations/:id") async orgUpdate(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    requireRole(req.ctx, "superadmin");
    const data = z
      .object({
        status: z.enum(["active", "blocked"]).optional(),
        employeeLimit: z.number().int().min(1).optional(),
        assessmentLimit: z.number().int().min(1).optional(),
        aiBudget: z.number().min(0).optional(),
      })
      .parse(body);
    const r = await db.organization.update({ where: { id }, data });
    await audit(id, req.ctx.user.id, "organization.updated");
    return r;
  }
  @Get("platform/ai") async aiSettings(@Req() req: AuthRequest) {
    requireRole(req.ctx, "superadmin");
    const settings = await db.platformSettings.findUnique({
      where: { id: "default" },
    });
    const { encryptedApiKey, ...safe } = settings!;
    return {
      settings: safe,
      keyConfigured: Boolean(openRouterKey(settings)),
      history: await db.aiReport.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          organizationId: true,
          status: true,
          model: true,
          cost: true,
          promptTokens: true,
          completionTokens: true,
          error: true,
          createdAt: true,
        },
      }),
    };
  }
  @Patch("platform/ai") async aiSettingsSave(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    requireRole(req.ctx, "superadmin");
    const parsed = z
      .object({
        apiKey: z.string().max(500).optional(),
        aiModel: z.string().max(150),
        aiPrompt: z.string().min(100).max(20000),
        aiPromptVersion: z.string().min(1),
        aiProviderAllowlist: z.array(z.string()),
        aiZdr: z.boolean(),
      })
      .parse(body);
    const { apiKey, ...rest } = parsed;
    const data = {
      ...rest,
      ...(apiKey ? { encryptedApiKey: encryptSecret(apiKey) } : {}),
    };
    await db.platformSettings.upsert({
      where: { id: "default" },
      create: data,
      update: data,
    });
    await audit(null, req.ctx.user.id, "ai.settings_updated");
    return { ok: true };
  }
  @Get("platform/tests/:id") async method(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    requireRole(req.ctx, "superadmin");
    return db.testVersion.findUnique({
      where: { id },
      include: {
        test: true,
        questions: {
          orderBy: { position: "asc" },
          include: { options: { orderBy: { position: "asc" } } },
        },
        keys: { orderBy: { createdAt: "desc" } },
      },
    });
  }
  @Post("platform/tests/import") async importTest(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    requireRole(req.ctx, "superadmin");
    const data = z
      .object({
        testId: z.string().regex(/^[a-z0-9-]+$/),
        version: z.string().min(1),
        name: z.object({ ru: z.string(), kk: z.string() }),
        description: z.object({ ru: z.string(), kk: z.string() }),
        direction: z.string(),
        source: z.url(),
        licenseStatus: z.string(),
        scientificBasis: z.string(),
        durationMinutes: z.number().int().min(1),
        questions: z.array(questionSchema).min(1).max(500),
        algorithm: z.enum(["cognitive", "scales", "sjt"]),
        config: z.custom<ScoringConfig>(),
        controlExamples: z
          .array(
            z.object({
              name: z.string(),
              answers: z.record(z.string(), z.unknown()),
              expected: z.unknown(),
            }),
          )
          .min(1),
      })
      .parse(body);
    verifyScoringConfig(data.config, data.questions);
    for (const ex of data.controlExamples) {
      const result = calculateScore(
        data.algorithm,
        data.config,
        data.questions,
        ex.answers,
      );
      if (JSON.stringify(result) !== JSON.stringify(ex.expected))
        throw new BadRequestException("Контрольный пример не пройден");
    }
    const version = await db.$transaction(async (tx) => {
      await tx.test.upsert({
        where: { id: data.testId },
        update: {},
        create: {
          id: data.testId,
          name: data.name,
          description: data.description,
          direction: data.direction,
          source: data.source,
          licenseStatus: data.licenseStatus,
          scientificBasis: data.scientificBasis,
        },
      });
      return tx.testVersion.create({
        data: {
          testId: data.testId,
          version: data.version,
          durationMinutes: data.durationMinutes,
          instructions: json({
            ru: "Следуйте инструкции методики.",
            kk: "Әдістеме нұсқаулығын орындаңыз.",
          }),
          limitations: json({
            ru: "Ожидает методологического утверждения.",
            kk: "Әдістемелік бекітуді күтуде.",
          }),
          questions: {
            create: data.questions.map((q, i) => ({
              id: q.id,
              position: i,
              type: q.type,
              text: q.text,
              imageUrl: q.imageUrl,
              options: {
                create: q.options.map((o, j) => ({ ...o, position: j })),
              },
            })),
          },
          keys: {
            create: {
              version: "1.0",
              algorithm: data.algorithm,
              config: json(data.config),
              source: data.source,
              controlExamples: json(data.controlExamples),
            },
          },
        },
      });
    });
    return { id: version.id };
  }
  @Post("platform/tests/:id/publish") async publish(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    requireRole(req.ctx, "superadmin");
    const data = z
      .object({
        approvedBy: z.string().min(3),
        confirmRights: z.literal(true),
        confirmTranslations: z.literal(true),
      })
      .parse(body);
    const version = await db.testVersion.findUniqueOrThrow({
      where: { id },
      include: {
        questions: { include: { options: true } },
        keys: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!version.keys.length) throw new BadRequestException("Нет ключа");
    const key = version.keys[0];
    for (const example of key.controlExamples as any[]) {
      const actual = calculateScore(
        key.algorithm,
        key.config as ScoringConfig,
        version.questions.map(questionDTO),
        example.answers,
      );
      if (JSON.stringify(actual) !== JSON.stringify(example.expected))
        throw new BadRequestException("Контрольный пример не пройден");
    }
    await db.testVersion.update({
      where: { id },
      data: {
        status: "published",
        approvedBy: data.approvedBy,
        approvedAt: new Date(),
        translationStatus: "approved",
      },
    });
    await audit(null, req.ctx.user.id, "test.published", id);
    return { ok: true };
  }
  @Post("platform/tests/:id/archive") async archive(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    requireRole(req.ctx, "superadmin");
    await db.testVersion.update({
      where: { id },
      data: { status: "archived" },
    });
    await audit(null, req.ctx.user.id, "test.archived", id);
    return { ok: true };
  }
  @Post("platform/tests/:id/keys") async newKey(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    requireRole(req.ctx, "superadmin");
    const data = z
      .object({
        version: z.string(),
        config: z.custom<ScoringConfig>(),
        source: z.string().min(5),
        approvedBy: z.string().optional(),
        controlExamples: z
          .array(
            z.object({
              name: z.string(),
              answers: z.record(z.string(), z.unknown()),
              expected: z.unknown(),
            }),
          )
          .min(1),
      })
      .parse(body);
    const v = await db.testVersion.findUniqueOrThrow({
      where: { id },
      include: {
        questions: { include: { options: true } },
        keys: { take: 1, orderBy: { createdAt: "desc" } },
      },
    });
    const algorithm = v.keys[0]?.algorithm;
    if (!algorithm) throw new BadRequestException();
    verifyScoringConfig(data.config, v.questions.map(questionDTO));
    for (const e of data.controlExamples)
      if (
        JSON.stringify(
          calculateScore(
            algorithm,
            data.config,
            v.questions.map(questionDTO),
            e.answers,
          ),
        ) !== JSON.stringify(e.expected)
      )
        throw new BadRequestException("Контрольный пример не пройден");
    const key = await db.scoringKey.create({
      data: {
        testVersionId: id,
        version: data.version,
        algorithm,
        config: json(data.config),
        source: data.source,
        approvedBy: data.approvedBy,
        approvedAt: data.approvedBy ? new Date() : null,
        status: data.approvedBy ? "approved" : "preliminary",
        controlExamples: json(data.controlExamples),
      },
    });
    await audit(null, req.ctx.user.id, "scoring.key_version_created", key.id);
    return key;
  }
}
