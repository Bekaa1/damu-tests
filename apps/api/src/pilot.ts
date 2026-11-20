import { BadRequestException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { db, json } from "./db";
import { orgId, requireRole, type Context } from "./access";

export async function recordEmployerPermission(
  ctx: Context,
  campaignId: string,
  input: unknown,
) {
  requireRole(ctx, "admin");
  if (ctx.org?.purpose !== "pilot")
    throw new BadRequestException(
      "Разрешение регистрируется в отдельной организации пилота",
    );
  const data = z
    .object({
      employer: z.string().trim().min(2).max(200),
      reference: z.string().trim().min(5).max(1000),
      receivedAt: z.iso.date(),
      confirmed: z.literal(true),
    })
    .parse(input);
  if (new Date(data.receivedAt) > new Date())
    throw new BadRequestException(
      "Дата получения разрешения не может быть в будущем",
    );
  const organizationId = orgId(ctx);
  const permission = {
    employer: data.employer,
    reference: data.reference,
    receivedAt: data.receivedAt,
    recordedAt: new Date().toISOString(),
    recordedBy: ctx.user.id,
  };
  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, organizationId },
    });
    if (!campaign) throw new NotFoundException("Кампания не найдена");
    await tx.campaign.update({
      where: { id: campaignId },
      data: { employerPermission: json(permission) },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: ctx.user.id,
        action: "pilot.employer_permission_recorded",
        entityId: campaignId,
        detail: json({ previous: campaign.employerPermission, permission }),
      },
    });
    return { ok: true, employerPermission: permission };
  });
}
