import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import { db } from "./db";

export const recordingPath = (id: string, suffix: ".webm" | ".mp4" | ".work") =>
  resolve(
    process.env.VIDEO_RECORDINGS_DIR || ".data/video-recordings",
    z.uuid().parse(id) + suffix,
  );

export async function removeRecordingFiles(id: string) {
  await Promise.all([
    rm(recordingPath(id, ".webm"), { force: true }),
    rm(recordingPath(id, ".mp4"), { force: true }),
    rm(recordingPath(id, ".work"), { force: true, recursive: true }),
  ]);
}

const run = promisify(execFile);
async function prepareRecording(id: string) {
  const workspace = recordingPath(id, ".work");
  const final = recordingPath(id, ".mp4");
  const temporary = join(workspace, randomUUID() + ".mp4");
  const aligned = join(workspace, randomUUID() + ".webm");
  const eligible = () => ({
    id,
    state: "processing",
    attemptId: { not: null },
    expiresAt: { gt: new Date() },
  });

  // Coordinate with retention or participant erasure. No database transaction
  // stays open during encoding, and partially written files are never served.
  const active = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM video_sessions WHERE id = ${id} FOR UPDATE`;
    if (!(await tx.videoSession.count({ where: eligible() }))) return false;
    await mkdir(workspace, { recursive: true });
    return true;
  });
  if (!active) return;
  try {
    const published = await stat(final).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
      return null;
    });
    if (!published?.size) {
      // Track egress can join between VP8 keyframes. Stream copy drops the
      // undecodable prefix while leaving the original evidence intact.
      await run(
        process.env.FFMPEG_PATH || "ffmpeg",
        [
          "-nostdin", "-hide_banner", "-loglevel", "error",
          "-i", recordingPath(id, ".webm"), "-map", "0:v:0", "-an",
          "-c:v", "copy", "-avoid_negative_ts", "make_zero", aligned,
        ],
        { windowsHide: true, maxBuffer: 256 * 1024 },
      );
      await run(
        process.env.FFMPEG_PATH || "ffmpeg",
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-xerror",
          "-threads",
          "1",
          "-i",
          aligned,
          "-map",
          "0:v:0",
          "-an",
          "-map_metadata",
          "-1",
          "-vf",
          "fps=15,pad=ceil(iw/2)*2:ceil(ih/2)*2",
          "-c:v",
          "libx264",
          "-threads",
          "1",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          temporary,
        ],
        { windowsHide: true, maxBuffer: 256 * 1024 },
      );
      if (!(await stat(temporary)).size) throw new Error("Empty MP4 recording");
    }
    await db.$transaction(async (tx) => {
      const claimed = await tx.videoSession.updateMany({
        where: eligible(),
        data: { state: "ready" },
      });
      if (claimed.count && !published?.size) await rename(temporary, final);
    });
  } finally {
    await Promise.all([
      rm(temporary, { force: true }),
      rm(aligned, { force: true }),
    ]);
  }
}

export function startVideoConversion() {
  const redis = new URL(process.env.REDIS_URL || "redis://localhost:56379");
  const connection = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    password: redis.password || undefined,
    maxRetriesPerRequest: null,
  };
  const name = "assessflow-recording-mp4";
  const queue = new Queue(name, { connection });
  const worker = new Worker<{ id: string }>(
    name,
    async (job) => {
      const { id } = job.data;
      try {
        await prepareRecording(id);
      } catch (err) {
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
          await db.videoSession.updateMany({
            where: { id, state: "processing" },
            data: { state: "conversion_failed" },
          });
        }
        throw err;
      }
    },
    {
      connection,
      concurrency: z.coerce.number().int().min(1).max(8)
        .parse(process.env.VIDEO_CONVERSION_CONCURRENCY ?? 1),
    },
  );
  worker.on("failed", (job, err) =>
    console.error("MP4 preparation", job?.id, err.message),
  );
  worker.on("error", (err) => console.error("MP4 worker", err.message));
  queue.on("error", (err) => console.error("MP4 queue", err.message));
  let busy = false;
  async function enqueue() {
    if (busy) return;
    busy = true;
    try {
      const pending = await db.videoSession.findMany({
        where: {
          state: "processing",
          attemptId: { not: null },
          expiresAt: { gt: new Date() },
        },
        orderBy: { endedAt: "asc" },
        select: { id: true },
      });
      if (pending.length)
        await queue.addBulk(
          pending.map(({ id }) => ({
            name: "convert",
            data: { id },
            opts: {
              jobId: id,
              attempts: 3,
              backoff: { type: "exponential", delay: 15000 },
              removeOnComplete: true,
              removeOnFail: true,
            },
          })),
        );
    } catch (err) {
      console.error("Scheduling MP4 recordings", (err as Error).message);
    } finally {
      busy = false;
    }
  }
  void enqueue();
  const timer = setInterval(() => void enqueue(), 5000);
  return async () => {
    clearInterval(timer);
    await worker.close();
    await queue.close();
  };
}
