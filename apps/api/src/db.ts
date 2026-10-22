import "dotenv/config";
import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient();
export const json = (value: unknown) => JSON.parse(JSON.stringify(value));
export function audit(
  organizationId: string | null,
  actorId: string | null,
  action: string,
  entityId?: string,
  detail?: unknown,
) {
  return db.auditLog.create({
    data: {
      organizationId,
      actorId,
      action,
      entityId,
      detail: detail ? json(detail) : undefined,
    },
  });
}
