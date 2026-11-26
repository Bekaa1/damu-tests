import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AccessToken,
  DirectFileOutput,
  EgressClient,
  EgressStatus,
  RoomServiceClient,
  TrackSource,
  TrackType,
  type EgressInfo,
} from "livekit-server-sdk";
import type { VideoSession } from "@prisma/client";
import { stat } from "node:fs/promises";
import { recordingPath, removeRecordingFiles } from "./video-mp4";
import { z } from "zod";
import type { Context } from "./access";
import { db, audit, json } from "./db";
import {
  videoConsentText,
  videoConsentVersion,
  videoExpiry,
} from "../../../packages/core/video-policy";
import {
  needsVideoConsent,
  requiresCamera,
  videoCampaign,
} from "./video-scope";

const openStates = ["connecting", "starting", "recording", "closing"];
const roomName = (id: string) => "assessment-" + id;

function media() {
  const {
    LIVEKIT_API_KEY: key,
    LIVEKIT_API_SECRET: secret,
    LIVEKIT_URL: url,
    LIVEKIT_PUBLIC_URL: publicUrl,
  } = process.env;
  if (!key || !secret || !url || !publicUrl)
    throw new ServiceUnavailableException("Видеосервис не настроен");
  return {
    key,
    secret,
    publicUrl,
    rooms: new RoomServiceClient(url, key, secret),
    recorder: new EgressClient(url, key, secret),
  };
}
function requireAdmin(ctx: Context) {
  if (
    ctx.role !== "admin" ||
    ctx.member?.role !== "admin" ||
    ctx.org?.id !== ctx.member.organizationId ||
    !videoCampaign(ctx.org.id)
  )
    throw new ForbiddenException(
      "Видеозаписи доступны руководителю организации",
    );
}
async function credential(s: VideoSession, identity: string, publish: boolean) {
  const { key, secret, publicUrl } = media();
  const token = new AccessToken(key, secret, { identity, ttl: "2m" });
  token.addGrant({
    roomJoin: true,
    room: roomName(s.id),
    canSubscribe: !publish,
    canPublish: publish,
    canPublishData: false,
    ...(publish ? { canPublishSources: [TrackSource.CAMERA] } : {}),
  });
  return { id: s.id, url: publicUrl, token: await token.toJwt() };
}
export async function acceptVideo(ctx: Context, input: unknown) {
  const { locale } = z
    .object({
      accepted: z.literal(true),
      version: z.literal(videoConsentVersion),
      locale: z.enum(["ru", "kk"]),
    })
    .parse(input);
  const member = ctx.member;
  if (
    ctx.role !== "employee" ||
    !member ||
    !videoCampaign(member.organizationId)
  )
    throw new ForbiddenException();
  if (member.videoConsentVersion === videoConsentVersion)
    return { accepted: true };
  if (!(await needsVideoConsent(member))) throw new ForbiddenException();
  await db.$transaction(async (tx) => {
    const at = new Date();
    const update = await tx.membership.updateMany({
      where: {
        id: member.id,
        OR: [
          { videoConsentVersion: null },
          { videoConsentVersion: { not: videoConsentVersion } },
        ],
      },
      data: {
        videoConsentVersion,
        videoConsentAt: at,
        videoConsentLocale: locale,
      },
    });
    if (update.count)
      await tx.auditLog.create({
        data: {
          organizationId: member.organizationId,
          actorId: ctx.user.id,
          entityId: member.id,
          action: "video.consent",
          detail: json({
            at,
            version: videoConsentVersion,
            locale,
            text: videoConsentText[locale],
          }),
        },
      });
  });
  return { accepted: true };
}
async function activeAttempt(ctx: Context, attemptId: string) {
  if (
    ctx.role !== "employee" ||
    ctx.member?.videoConsentVersion !== videoConsentVersion ||
    !ctx.org
  )
    throw new ForbiddenException();
  const attempt = await db.testAttempt.findFirst({
    where: {
      id: attemptId,
      organizationId: ctx.org.id,
      assignment: { membershipId: ctx.member.id },
    },
    include: { assignment: { select: { campaignId: true } } },
  });
  if (!attempt || !requiresCamera(ctx.org.id, attempt.assignment.campaignId))
    throw new NotFoundException();
  if (
    attempt.status !== "in_progress" ||
    (attempt.expiresAt && attempt.expiresAt <= new Date())
  )
    throw new ConflictException("Попытка завершена");
  return attempt;
}
export async function openCamera(ctx: Context, attemptId: string) {
  const a = await activeAttempt(ctx, attemptId);
  const { rooms } = media();
  const session = await db.videoSession.create({
    data: {
      attemptId,
      organizationId: a.organizationId,
      membershipId: ctx.member!.id,
      campaignId: a.assignment.campaignId,
    },
  });
  try {
    await rooms.createRoom({
      name: roomName(session.id),
      emptyTimeout: 60,
      departureTimeout: 5,
    });
    return await credential(session, "camera", true);
  } catch {
    await db.videoSession.update({
      where: { id: session.id },
      data: {
        state: "failed",
        endedAt: new Date(),
        expiresAt: videoExpiry(new Date()),
      },
    });
    throw new ServiceUnavailableException(
      "Не удалось подключиться к видеосерверу",
    );
  }
}
async function owned(ctx: Context, id: string) {
  const s = await db.videoSession.findFirst({
    where: { id, organizationId: ctx.org?.id, membershipId: ctx.member?.id },
  });
  if (ctx.role !== "employee" || !ctx.org || !ctx.member || !s)
    throw new NotFoundException();
  return s;
}
async function cameraTrack(s: VideoSession) {
  const p = await media()
    .rooms.getParticipant(roomName(s.id), "camera")
    .catch((error: { code?: string }) => {
      if (error.code === "not_found")
        throw new ConflictException("Камера отключена");
      throw new ServiceUnavailableException("Видеосервер временно недоступен");
    });
  const track = p.tracks.find(
    (t) =>
      t.source === TrackSource.CAMERA &&
      t.type === TrackType.VIDEO &&
      !t.muted &&
      t.mimeType.toLowerCase() === "video/vp8",
  );
  if (!track) throw new ConflictException("Камера пока не передаёт видео");
  return track;
}
async function updateFromEgress(s: VideoSession, info: EgressInfo) {
  let state: string;
  switch (info.status) {
    case EgressStatus.EGRESS_ACTIVE:
      state = s.state === "closing" ? "closing" : "recording";
      break;
    case EgressStatus.EGRESS_STARTING:
      return s.state;
    case EgressStatus.EGRESS_ENDING:
      state = "closing";
      break;
    case EgressStatus.EGRESS_COMPLETE:
      state = "processing";
      break;
    default:
      state = "failed";
  }
  const ended = state === "processing" || state === "failed";
  const end =
    info.endedAt > 0n ? new Date(Number(info.endedAt / 1000000n)) : new Date();
  if (state === "processing" && !(info.fileResults[0]?.size > 0n))
    state = "failed";
  if (ended) await closeRoom(s);
  if (s.state !== state || !s.egressId)
    await db.videoSession.updateMany({
      where: { id: s.id, state: s.state },
      data: {
        state,
        egressId: info.egressId,
        ...(ended ? { endedAt: end, expiresAt: videoExpiry(end) } : {}),
      },
    });
  return state;
}
async function findJob(s: VideoSession) {
  return (
    await media().recorder.listEgress(
      s.egressId ? { egressId: s.egressId } : { roomName: roomName(s.id) },
    )
  )[0];
}
export async function checkCamera(ctx: Context, id: string) {
  let s = await owned(ctx, id);
  if (!s.attemptId || !openStates.includes(s.state) || s.state === "closing")
    throw new ConflictException("Подключите камеру заново");
  await activeAttempt(ctx, s.attemptId);
  const track = await cameraTrack(s);
  if (
    s.state === "connecting" &&
    (
      await db.videoSession.updateMany({
        where: { id, state: "connecting" },
        data: { state: "starting" },
      })
    ).count
  ) {
    const info = await media().recorder.startTrackEgress(
      roomName(id),
      new DirectFileOutput({
        filepath: "/out/" + id + ".webm",
        disableManifest: true,
      }),
      track.sid,
    );
    await db.videoSession.updateMany({
      where: { id, state: { in: openStates } },
      data: { egressId: info.egressId },
    });
  }
  s = await db.videoSession.findUniqueOrThrow({ where: { id } });
  const info = await findJob(s);
  return { state: info ? await updateFromEgress(s, info) : s.state };
}
export async function requireRecording(
  ctx: Context,
  attemptId: string,
  id?: string,
) {
  if (!id) throw new ConflictException("Сначала подключите камеру");
  const s = await owned(ctx, id);
  if (
    s.attemptId !== attemptId ||
    (await checkCamera(ctx, id)).state !== "recording"
  )
    throw new ConflictException("Ожидаем начала видеозаписи");
}
async function closeRoom(s: VideoSession) {
  // Deleting the room stops publication, all viewers and native track egress.
  try {
    await media().rooms.deleteRoom(roomName(s.id));
  } catch (e) {
    if ((e as { code?: string }).code !== "not_found") throw e;
  }
}
export async function closeCamera(ctx: Context, id: string) {
  const s = await owned(ctx, id);
  if (openStates.includes(s.state)) {
    await db.videoSession.updateMany({
      where: { id, state: { in: openStates } },
      data: { state: "closing" },
    });
    await closeRoom(s);
  }
  return { closed: true };
}
export async function adminSessions(ctx: Context, campaignId: string) {
  requireAdmin(ctx);
  if (videoCampaign(ctx.org!.id) !== campaignId) return [];
  const rows = await db.videoSession.findMany({
    where: {
      organizationId: ctx.org!.id,
      campaignId,
      attemptId: { not: null },
      OR: [
        { state: "recording" },
        {
          state: { in: ["processing", "ready", "conversion_failed"] },
          expiresAt: { gt: new Date() },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      attempt: {
        select: {
          status: true,
          assignment: {
            select: {
              membership: { select: { user: { select: { name: true } } } },
              testVersion: { select: { test: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  return rows
    .filter(
      (s) => s.state !== "recording" || s.attempt?.status === "in_progress",
    )
    .map((s) => ({
      id: s.id,
      state: s.state,
      name: s.attempt!.assignment.membership.user.name,
      test: s.attempt!.assignment.testVersion.test.name,
      started: s.createdAt,
      ended: s.endedAt,
      expires: s.expiresAt,
    }));
}
async function forAdmin(ctx: Context, id: string) {
  requireAdmin(ctx);
  const s = await db.videoSession.findFirst({
    where: {
      id,
      organizationId: ctx.org!.id,
      campaignId: videoCampaign(ctx.org!.id)!,
      attemptId: { not: null },
    },
    include: { attempt: { select: { status: true, expiresAt: true } } },
  });
  if (!s) throw new NotFoundException();
  return s;
}
export async function watch(ctx: Context, id: string) {
  const s = await forAdmin(ctx, id);
  if (
    s.state !== "recording" ||
    s.attempt?.status !== "in_progress" ||
    (s.attempt.expiresAt && s.attempt.expiresAt <= new Date())
  )
    throw new ConflictException("Эфир завершён");
  await cameraTrack(s);
  await audit(ctx.org!.id, ctx.user.id, "video.watch", id);
  return credential(s, "viewer-" + crypto.randomUUID(), false);
}
export async function retryVideoConversion(ctx: Context, id: string) {
  const s = await forAdmin(ctx, id);
  if (!s.expiresAt || s.expiresAt <= new Date()) throw new NotFoundException();
  await db.videoSession.updateMany({
    where: {
      id,
      state: "conversion_failed",
      attemptId: { not: null },
      expiresAt: { gt: new Date() },
    },
    data: { state: "processing" },
  });
  return { ok: true };
}
export async function recordingFile(
  ctx: Context,
  id: string,
  disposition: "download" | "play" = "download",
) {
  const s = await forAdmin(ctx, id);
  if (s.state !== "ready" || !s.expiresAt || s.expiresAt <= new Date())
    throw new NotFoundException();
  const path = recordingPath(id, ".mp4");
  if (!(await stat(path).catch(() => null))?.isFile())
    throw new NotFoundException("Запись недоступна");
  await audit(ctx.org!.id, ctx.user.id, "video." + disposition, id);
  return path;
}

export async function reconcileVideos() {
  const now = new Date();
  // Erase local bytes even if video has subsequently been disabled for the campaign.
  const remove = await db.videoSession.findMany({
    where: {
      state: { notIn: openStates.concat("deleted") },
      OR: [{ expiresAt: { lte: now } }, { attemptId: null }],
    },
  });
  for (const s of remove) {
    try {
      await db.$transaction(async (tx) => {
        const removed = await tx.videoSession.updateMany({
          where: {
            id: s.id,
            state: { notIn: openStates.concat("deleted") },
            OR: [{ expiresAt: { lte: now } }, { attemptId: null }],
          },
          data: { state: "deleted" },
        });
        if (removed.count) await removeRecordingFiles(s.id);
      });
    } catch (error) {
      // A file still open on Windows can be retried on the next tick.
      console.error("Video retention", s.id, (error as Error).message);
    }
  }
  const sessions = await db.videoSession.findMany({
    where: { state: { in: openStates } },
    include: { attempt: { select: { status: true, expiresAt: true } } },
  });
  for (let i = 0; i < sessions.length; i += 8)
    await Promise.all(
      sessions.slice(i, i + 8).map(async (s) => {
        try {
          const stale = now.getTime() - s.createdAt.getTime() > 120000;
          if (
            s.state === "closing" ||
            !s.attempt ||
            s.attempt.status !== "in_progress" ||
            (s.attempt.expiresAt && s.attempt.expiresAt <= now) ||
            (stale && ["starting", "connecting"].includes(s.state))
          )
            await closeRoom(s);
          if (
            s.state === "connecting" &&
            !stale &&
            s.attempt?.status === "in_progress"
          )
            return;
          const info = await findJob(s);
          if (info) await updateFromEgress(s, info);
          else if (stale) {
            // LiveKit may have discarded the job history while the API was offline.
            // Close a possibly surviving publisher before handling an unverified file.
            await closeRoom(s);
            const file = await stat(recordingPath(s.id, ".webm")).catch(
              (e: NodeJS.ErrnoException) => {
                if (e.code === "ENOENT") return null;
                throw e;
              },
            );
            const end = file?.mtime ?? s.createdAt;
            await db.videoSession.updateMany({
              where: { id: s.id, state: s.state },
              data: {
                state: "failed",
                endedAt: end,
                expiresAt: videoExpiry(end),
              },
            });
          }
        } catch (e) {
          console.error(
            "Video session synchronization",
            s.id,
            (e as Error).message,
          );
        }
      }),
    );
}
export function startVideoMaintenance() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await reconcileVideos();
    } catch (e) {
      console.error("Video maintenance", (e as Error).message);
    } finally {
      busy = false;
    }
  };
  void tick();
  return setInterval(() => void tick(), 15000);
}
