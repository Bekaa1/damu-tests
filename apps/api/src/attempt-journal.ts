import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { attemptOperations } from "../../../packages/core/attempt-journal";
import { orgId, participant, type Context } from "./access";
import { db } from "./db";
import { withParticipantWriteFence } from "./participant-write";

const stamp = { eventId: z.uuid(), at: z.iso.datetime() };
const operation = z.enum(attemptOperations);
export const heartbeatGapMs = 30_000;
const eventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...stamp, kind: z.enum(["offline", "online", "copy_blocked"]) }),
  z.strictObject({ ...stamp, kind: z.enum(["no_response", "request_recovered"]), operation }),
  z.strictObject({ ...stamp, kind: z.literal("http_error"), operation, status: z.number().int().min(400).max(599), requestId: z.uuid().optional() }),
]);

export async function receiveJournal(ctx: Context, id: string, input: unknown) {
  if (ctx.role !== "employee" || !ctx.member) throw new ForbiddenException();
  const events = z.array(eventSchema).min(1).max(100).parse(input);
  const organizationId = orgId(ctx), membershipId = ctx.member.id;
  return withParticipantWriteFence(organizationId, [membershipId], async tx => {
    const owned = await tx.testAttempt.findFirst({
      where: { id, organizationId, assignment: { membershipId } }, select: { id: true },
    });
    if (!owned) throw new NotFoundException();
    await tx.auditLog.createMany({
      data: events.map(({ eventId, ...detail }) => ({
        id: `journal:${id}:${eventId}`, organizationId, entityId: id, actorId: ctx.user.id,
        action: "attempt.browser_event", detail,
      })),
      skipDuplicates: true,
    });
    return { received: true };
  });
}

export async function readJournal(ctx: Context, id: string) {
  if (ctx.role !== "admin") throw new ForbiddenException();
  const organizationId = orgId(ctx);
  const attempt = await db.testAttempt.findFirst({
    where: { id, organizationId }, select: { assignment: { select: { membershipId: true, campaignId: true } } },
  });
  if (!attempt) throw new NotFoundException();
  const { membershipId, campaignId } = attempt.assignment;
  await participant(ctx, membershipId, campaignId);
  return withParticipantWriteFence(organizationId, [membershipId], async tx => {
    const current = await tx.testAttempt.findFirstOrThrow({
      where: { id, organizationId, assignment: { membershipId, campaignId } },
      select: {
        lastHeartbeatAt: true, status: true, timerStartedAt: true,
        answers: { select: { id: true, questionId: true, answeredAt: true, receivedAt: true, revision: true } },
        assignment: { select: { testVersion: { select: { questions: { orderBy: { position: "asc" }, select: { id: true } } } } } },
      },
    });
    const events = await tx.auditLog.findMany({
      where: { organizationId, entityId: id, action: { in: [
        "attempt.started", "attempt.timer_started", "attempt.heartbeat_gap", "attempt.browser_event",
        "attempt.presence", "attempt.completed", "attempt.insufficient_answers", "incident.time_added",
      ] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, action: true, createdAt: true, detail: true },
    });
    const order = new Map(current.assignment.testVersion.questions.map((q, index) => [q.id, index + 1]));
    const asOf = new Date();
    const active = current.status === "in_progress";
    const sinceLast = current.lastHeartbeatAt ? asOf.getTime() - current.lastHeartbeatAt.getTime() : 0;
    return { asOf, active, lastHeartbeatAt: current.lastHeartbeatAt,
      pendingGapSeconds: active && current.timerStartedAt && sinceLast >= heartbeatGapMs ? Math.floor(sinceLast / 1000) : null,
      events: [
      ...events,
      ...current.answers.map(a => ({
        id: a.id, action: "answer.saved", createdAt: a.receivedAt,
        detail: { at: a.answeredAt, question: order.get(a.questionId), revision: a.revision },
      })),
    ] };
  });
}
