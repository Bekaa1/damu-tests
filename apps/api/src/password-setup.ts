import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { hashPassword } from "better-auth/crypto";
import type { AuthRequest } from "./access";
import { db } from "./db";

const setupWindowMs = 15 * 60 * 1000;

export async function setInitialPassword(
  req: AuthRequest,
  newPassword: string,
) {
  const { user, org } = req.ctx;
  if (!user.mustChangePassword)
    throw new ForbiddenException("Для смены пароля укажите текущий пароль.");

  const password = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    // Use the same account-first lock order as administrator password resets.
    const [credential] = await tx.$queryRaw<{ id: string; updatedAt: Date }[]>`
      SELECT id, "updatedAt"
      FROM accounts
      WHERE "userId" = ${user.id} AND "providerId" = 'credential' AND password IS NOT NULL
      FOR UPDATE
    `;
    const now = new Date();
    if (!credential)
      throw new ForbiddenException("Для учётной записи не задан временный пароль.");
    const oldestAllowedLogin = new Date(
      Math.max(credential.updatedAt.getTime(), now.getTime() - setupWindowMs),
    );
    const session = await tx.session.findFirst({
      where: {
        id: req.authSessionId,
        userId: user.id,
        expiresAt: { gt: now },
        createdAt: { gte: oldestAllowedLogin },
      },
      select: { id: true },
    });
    if (!session)
      throw new UnauthorizedException("Чтобы задать пароль, войдите в систему заново.");

    const updated = await tx.user.updateMany({
      where: { id: user.id, mustChangePassword: true },
      data: { mustChangePassword: false },
    });
    if (!updated.count)
      throw new ForbiddenException("Для смены пароля укажите текущий пароль.");

    await tx.account.update({ where: { id: credential.id }, data: { password } });
    await tx.session.deleteMany({
      where: { userId: user.id, id: { not: session.id } },
    });
    await tx.auditLog.create({
      data: {
        organizationId: org?.id ?? null,
        actorId: user.id,
        action: "password.changed",
      },
    });
  });
}
