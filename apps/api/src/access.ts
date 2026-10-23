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
export type AuthRequest = Request & { ctx: Context };
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
    if (
      user.mustChangePassword &&
      !["/api/me", "/api/me/password", "/api/me/consent"].includes(req.path)
    )
      throw new ForbiddenException("Сначала измените временный пароль");
    const selected =
      typeof req.headers["x-organization-id"] === "string"
        ? req.headers["x-organization-id"]
        : undefined;
    const member = await db.membership.findFirst({
      where: {
        userId: user.id,
        ...(selected ? { organizationId: selected } : {}),
        status: "active",
      },
      orderBy: { createdAt: "asc" },
    });
    const orgId = selected ?? member?.organizationId;
    if (!user.platformAdmin && !member)
      throw new ForbiddenException("Нет доступа к организации");
    const org = orgId
      ? await db.organization.findUnique({ where: { id: orgId } })
      : null;
    if (!user.platformAdmin && org?.status !== "active")
      throw new ForbiddenException("Доступ организации приостановлен");
    req.ctx = {
      user,
      member,
      org,
      role: user.platformAdmin ? "superadmin" : member!.role,
    };
    return true;
  }
}
export function requireRole(ctx: Context, ...roles: string[]) {
  if (ctx.role !== "superadmin" && !roles.includes(ctx.role))
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
  const member = await db.membership.findFirst({
    where: { id, organizationId: orgId(ctx) },
  });
  if (!member) throw new ForbiddenException("Участник недоступен");
  if (ctx.role === "employee" && ctx.member?.id !== id)
    throw new ForbiddenException("Участник недоступен");
  if (ctx.role === "expert") {
    const assigned = await db.testAssignment.count({
      where: {
        organizationId: orgId(ctx),
        membershipId: id,
        expertId: ctx.member!.id,
        ...(campaignId ? { campaignId } : {}),
      },
    });
    if (!assigned) throw new ForbiddenException("Участник не назначен вам");
  }
  return member;
}
