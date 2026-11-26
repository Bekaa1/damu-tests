import { needsVideoConsent } from "./video-scope";
import { hasCurrentConsent } from "../../../packages/core/pilot";
import { participantDataExpired } from "../../../packages/core/data-policy";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import type { Membership, User, Organization } from "@prisma/client";
import { auth } from "./auth";
import { db } from "./db";
import { isTrustedOrigin } from "./origins";
export type Context = {
  user: User;
  member: Membership | null;
  org: Organization | null;
  role: string;
};
export type AuthRequest = Request & { ctx: Context; authSessionId: string };
export class AccessGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!isTrustedOrigin(req.headers.origin))
        throw new ForbiddenException("Недопустимый источник запроса");
    }
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) throw new UnauthorizedException("Войдите в систему");
    const user = await db.user.findUniqueOrThrow({
      where: { id: session.user.id },
    });
    const platformAccess = user.platformAdmin && !user.demoOnly;
    if (
      user.mustChangePassword &&
      !["/api/me", "/api/me/password", "/api/me/consent"].includes(req.path)
    )
      throw new ForbiddenException("Сначала измените временный пароль");
    const selected =
      typeof req.headers["x-organization-id"] === "string"
        ? req.headers["x-organization-id"]
        : ["GET", "HEAD"].includes(req.method) && /^\/api\/video\/[\w-]+\/(?:download|play)$/.test(req.path) && typeof req.query.organization === "string"
          ? req.query.organization : undefined;
    const member = await db.membership.findFirst({
      where: {
        userId: user.id,
        ...(selected ? { organizationId: selected } : {}),
        // A restricted login may retain an older real membership for history.
        // It must bootstrap from an active synthetic scope, never the oldest real one.
        ...(user.demoOnly ? { organization: { dataMode: "synthetic" } } : {}),
        status: "active",
      },
      orderBy: { createdAt: "asc" },
    });
    const orgId = selected ?? member?.organizationId;
    if (!platformAccess && !member)
      throw new ForbiddenException("Нет доступа к организации");
    const org = orgId
      ? await db.organization.findUnique({ where: { id: orgId } })
      : null;
    // Demo credentials cannot become real-data credentials through an old
    // membership, a forged org header or the platform-admin role bypass.
    if (user.demoOnly && org?.dataMode !== "synthetic")
      throw new ForbiddenException("Демонстрационная учётная запись доступна только в демонстрационной организации");
    if (!platformAccess && org?.status !== "active")
      throw new ForbiddenException("Доступ организации приостановлен");
    if (!user.platformAdmin && participantDataExpired(member, org))
      throw new ForbiddenException("Срок хранения данных участника истёк. Обратитесь к организатору.");
    const ownScheduleRequest = (req.method === "GET" && req.path === "/api/me/schedule") ||
      (req.method === "POST" && req.path === "/api/me/schedule/acknowledge");
    if (!ownScheduleRequest && !["/api/me", "/api/me/locale", "/api/me/password", "/api/me/video-consent"].includes(req.path) && await needsVideoConsent(member))
      throw new ForbiddenException("Подтвердите согласие на видеозапись");
    if (
      member?.role === "employee" &&
      !hasCurrentConsent(member, org) &&
      !ownScheduleRequest &&
      ![
        "/api/me",
        "/api/me/consent",
        "/api/me/video-consent",
        "/api/me/password",
        "/api/me/locale",
      ].includes(req.path)
    )
      throw new ForbiddenException(
        "Подтвердите согласие на обработку персональных данных",
      );
    req.ctx = {
      user,
      member,
      org,
      role: platformAccess ? "superadmin" : member!.role,
    };
    req.authSessionId = session.session.id;
    return true;
  }
}
export function requireRole(ctx: Context, ...roles: string[]) {
  const role = ctx.user?.demoOnly ? ctx.member?.role : ctx.role;
  if ((ctx.user?.demoOnly && roles.includes("superadmin")) ||
      (role !== "superadmin" && (!role || !roles.includes(role))) ||
      (ctx.user?.demoOnly && role === "superadmin"))
    throw new ForbiddenException("Недостаточно прав");
}
export function orgId(ctx: Context) {
  if (!ctx.org) throw new BadRequestException("Выберите организацию");
  return ctx.org.id;
}
export async function participant(
  ctx: Context,
  id: string,
  campaignId?: string,
) {
  if (ctx.user?.demoOnly && ctx.org?.dataMode !== "synthetic")
    throw new ForbiddenException("Демонстрационная учётная запись доступна только в демонстрационной организации");
  const member = await db.membership.findFirst({
    where: { id, organizationId: orgId(ctx) },
    include: { user: { select: { platformAdmin: true } } },
  });
  if (!member) throw new ForbiddenException("Участник недоступен");
  if (!member.user.platformAdmin && participantDataExpired(member, ctx.org))
    throw new ForbiddenException("Срок хранения данных участника истёк");
  if (ctx.role === "employee" && ctx.member?.id !== id)
    throw new ForbiddenException("Участник недоступен");
  if (ctx.role === "expert") {
    const assigned = await db.testAssignment.count({
      where: {
        organizationId: orgId(ctx),
        membershipId: id,
        OR: [
          { expertId: ctx.member!.id },
          { assessorIds: { has: ctx.member!.id } },
        ],
        ...(campaignId ? { campaignId } : {}),
      },
    });
    if (!assigned) throw new ForbiddenException("Участник не назначен вам");
  }
  const { user: _user, ...participantMember } = member;
  return participantMember;
}
