import { ForbiddenException } from "@nestjs/common";
import { z } from "zod";
import type { Context } from "./access";
import { db } from "./db";

function ownSchedule(ctx: Context) {
  if (ctx.role !== "employee" || ctx.member?.role !== "employee" || ctx.member.organizationId !== ctx.org?.id)
    throw new ForbiddenException();
  return {
    membershipId: ctx.member.id,
    organizationId: ctx.member.organizationId,
    campaign: { status: "active", assignments: { some: { membershipId: ctx.member.id } } },
  };
}

export function mySchedule(ctx: Context) {
  return db.participantSchedule.findMany({
    where: ownSchedule(ctx),
    select: { campaignId: true, campaign: { select: { name: true } }, scheduledAt: true, revision: true, acknowledgedAt: true },
    orderBy: [{ scheduledAt: "asc" }, { campaignId: "asc" }],
  });
}

export async function acknowledgeSchedule(ctx: Context, input: unknown) {
  const scope = ownSchedule(ctx);
  const { campaignId, revision } = z.object({ campaignId: z.string().min(1), revision: z.number().int().positive() }).parse(input);
  // A concurrent reschedule wins. A retry preserves the first acknowledgement.
  await db.participantSchedule.updateMany({
    where: { ...scope, campaignId, revision, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
  return mySchedule(ctx);
}
