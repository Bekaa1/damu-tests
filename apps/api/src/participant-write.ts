import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { participantDataExpired } from "../../../packages/core/data-policy";
import { db } from "./db";

/**
 * Serialize participant persistence against erasure. Authorization (role,
 * campaign and expert assignment) remains the caller's responsibility.
 *
 * The callback must await every side effect, use this tx for DB writes and must
 * not retain tx or start detached work. All users are locked before any member,
 * in deterministic order, matching pilot-retention.ts. Empty sets fail closed.
 * The explicit two-minute budget also accommodates bounded file storage I/O;
 * it is NOT a distributed transaction or a remote PUT cancellation guarantee.
 */
export async function withParticipantWriteFence<T>(
  organizationId: string,
  membershipIds: string[],
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const ids = [...new Set(membershipIds)].sort();
  if (!organizationId || !ids.length || ids.some(id => !id))
    throw new BadRequestException("Укажите организацию и участников записи");
  const unavailable = () => new ForbiddenException("Участник недоступен для записи");

  return db.$transaction(async tx => {
    // Discovery does not authorize a write: rows can change before the locks.
    const discovered = await tx.membership.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, userId: true },
    });
    const userByMember = new Map(discovered.map(member => [member.id, member.userId]));
    if (userByMember.size !== ids.length || ids.some(id => !userByMember.has(id)))
      throw unavailable();
    const userIds = [...new Set(discovered.map(member => member.userId))].sort();
    for (const userId of userIds) {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      if (rows.length !== 1 || rows[0].id !== userId) throw unavailable();
    }
    for (const id of ids) {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM memberships WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`;
      if (rows.length !== 1 || rows[0].id !== id) throw unavailable();
    }
    const now = new Date();
    for (const id of ids) {
      const member = await tx.membership.findUnique({
        where: { id },
        include: { organization: true, user: { select: { id: true, platformAdmin: true } } },
      });
      if (!member || member.organizationId !== organizationId ||
          member.organization?.id !== organizationId || member.status !== "active" ||
          member.userId !== userByMember.get(id) || member.user?.id !== member.userId)
        throw unavailable();
      // Keep the same protected-account exception as participant() and erasure.
      if (!member.user.platformAdmin && participantDataExpired(member, member.organization, now))
        throw new ForbiddenException("Срок хранения данных участника истёк");
    }
    return operation(tx);
  }, { maxWait: 5000, timeout: 120000 });
}
