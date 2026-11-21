import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { orgId, participant, requireRole, type Context } from "./access";
import { withParticipantWriteFence } from "./participant-write";
// One bounded request, not an SDK retry sequence outliving the DB fence.
const storageRequestTimeoutMs = 20000;
const pendingUploadAction = "file.upload_pending";
const settledUploadAction = "file.upload_put_settled";
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: true,
  maxAttempts: 1,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "",
    secretAccessKey: process.env.S3_SECRET_KEY || "",
  },
});
const bucket = process.env.S3_BUCKET || "assessflow";
export async function removeStoredFiles(
  organizationId: string,
  membershipId: string,
) {
  const files = await db.fileAsset.findMany({
    where: { organizationId, membershipId },
  });
  // A crashed/timed-out PUT may still complete remotely. Never erase its last
  // durable key based on an HTTP abort or a successful compensating DELETE.
  // The eraser retains its participant block and rolls back reference deletion.
  if (files.length && await db.auditLog.count({ where: {
    organizationId, action: pendingUploadAction, entityId: { in: files.map(file => file.id) },
  } })) throw Error("Pending storage upload requires reconciliation before erasure");
  for (const file of files)
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: file.storageKey }),
    );
}
export async function uploadAsset(ctx: Context, input: unknown) {
  requireRole(ctx, "expert");
  const d = z
    .object({
      campaignId: z.string(),
      membershipId: z.string(),
      name: z.string().min(1).max(180),
      contentType: z.enum([
        "application/pdf",
        "image/png",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ]),
      base64: z.string().max(11 * 1024 * 1024),
    })
    .parse(input);
  await participant(ctx, d.membershipId, d.campaignId);
  const bytes = Buffer.from(d.base64, "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024)
    throw new BadRequestException(
      "Размер файла должен быть от 1 байта до 8 МБ",
    );
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), {
      abortSignal: AbortSignal.timeout(storageRequestTimeoutMs),
    });
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }), {
      abortSignal: AbortSignal.timeout(storageRequestTimeoutMs),
    });
  }
  const organizationId = orgId(ctx);
  const key = `${organizationId}/${d.membershipId}/${randomUUID()}`;
  // Commit the recovery index BEFORE sending any object bytes. A reference
  // created inside the PUT transaction would disappear on rollback; creating
  // it with the global client while holding FOR UPDATE would self-block its FK.
  const { file: reserved, receipt } = await withParticipantWriteFence(organizationId, [d.membershipId], async tx => {
    if (ctx.role === "expert" && !await tx.testAssignment.count({ where: {
      organizationId, membershipId: d.membershipId, campaignId: d.campaignId,
      OR: [{ expertId: ctx.member!.id }, { assessorIds: { has: ctx.member!.id } }],
    } })) throw new ForbiddenException("Участник не назначен вам");
    const file = await tx.fileAsset.create({ data: {
      organizationId,
      campaignId: d.campaignId,
      membershipId: d.membershipId,
      uploadedBy: ctx.user.id,
      name: d.name,
      contentType: d.contentType,
      size: bytes.length,
      storageKey: key,
    } });
    const receipt = await tx.auditLog.create({ data: {
      organizationId, actorId: ctx.user.id, action: pendingUploadAction, entityId: file.id,
    } });
    return { file, receipt };
  });
  const settlePut = async () => {
    // This existing, FK-free audit row is intentionally updated outside the
    // interactive transaction: a later rollback must not erase the durable
    // proof that no PUT can still be in flight. It never creates a reference.
    const settled = await db.auditLog.updateMany({
      where: { id: receipt.id, organizationId, entityId: reserved.id, action: pendingUploadAction },
      data: { action: settledUploadAction },
    });
    if (settled.count !== 1) throw Error("Upload settlement could not be persisted; reconciliation required");
  };
  let putAttempted = false, compensationAttempted = false, uploadCancelled = false;
  const compensate = async (failure: unknown): Promise<never> => {
    compensationAttempted = true;
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(storageRequestTimeoutMs),
      });
    } catch (cleanupFailure) {
      // Never claim successful cleanup. The separately committed FileAsset
      // survives rollback and is discoverable by removeStoredFiles/retention.
      throw new AggregateError([failure, cleanupFailure],
        "Upload cleanup failed; indexed file retained for retention retry");
    }
    // Keep even successfully compensated reservations indexed: a failed PUT
    // response/abort is not proof that the remote service cannot finish later.
    throw failure;
  };
  let file;
  try {
    file = await withParticipantWriteFence(organizationId, [d.membershipId], async tx => {
      // Erasure can win between reservation commit and this fresh fence.
      if (ctx.role === "expert" && !await tx.testAssignment.count({ where: {
        organizationId, membershipId: d.membershipId, campaignId: d.campaignId,
        OR: [{ expertId: ctx.member!.id }, { assessorIds: { has: ctx.member!.id } }],
      } })) throw new ForbiddenException("Участник не назначен вам");
      const existing = await tx.fileAsset.findFirst({ where: {
        id: reserved.id, organizationId, membershipId: d.membershipId, storageKey: key,
      } });
      if (!existing) throw new NotFoundException("Файл недоступен");
      // Prisma can reject an expired interactive transaction before its async
      // callback has unwound. Never let a resumed callback start a new PUT
      // after the outer catch has declared this reservation never-started.
      if (uploadCancelled) throw Error("Upload transaction is no longer active");
      try {
        putAttempted = true;
        await client.send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: bytes, ContentType: d.contentType,
        }), { abortSignal: AbortSignal.timeout(storageRequestTimeoutMs) });
        // Only a successful PUT acknowledgement settles this ledger. An abort,
        // thrown response or successful compensation does not settle it.
        await settlePut();
        const persisted = await tx.fileAsset.update({
          where: { id: reserved.id, organizationId, membershipId: d.membershipId, storageKey: key },
          data: { size: bytes.length },
        });
        // The upload receipt must not be appended after erasure has committed.
        await tx.auditLog.update({ where: { id: receipt.id }, data: { action: "file.uploaded" } });
        return persisted;
      } catch (failure) { return compensate(failure); }
    });
  } catch (failure) {
    uploadCancelled = true;
    // A transaction COMMIT can fail after the callback succeeded. No further
    // PUT is started, and its recovery reference was committed separately.
    if (putAttempted && !compensationAttempted) return compensate(failure);
    if (!putAttempted) {
      // Erasure won the reservation gap; no request was sent, so this pending
      // marker can safely be settled and the existing eraser can retry.
      try { await settlePut(); }
      catch (settlementFailure) {
        throw new AggregateError([failure, settlementFailure], "Upload did not start; reconciliation required");
      }
    }
    throw failure;
  }
  return { id: file.id, name: file.name };
}
export async function downloadAsset(ctx: Context, id: string) {
  requireRole(ctx, "admin", "expert");
  const organizationId = orgId(ctx);
  // Discover authorization scope only; never return this pre-fence snapshot.
  const discovered = await db.fileAsset.findFirst({
    where: { id, organizationId },
    select: { membershipId: true, campaignId: true },
  });
  if (!discovered) throw new NotFoundException();
  await participant(ctx, discovered.membershipId, discovered.campaignId);
  return withParticipantWriteFence(organizationId, [discovered.membershipId], async tx => {
    const file = await tx.fileAsset.findFirst({ where: {
      id, organizationId, membershipId: discovered.membershipId, campaignId: discovered.campaignId,
    } });
    if (!file) throw new NotFoundException("Файл недоступен");
    if (ctx.role === "expert" && !await tx.testAssignment.count({ where: {
      organizationId, membershipId: file.membershipId, campaignId: file.campaignId,
      OR: [{ expertId: ctx.member!.id }, { assessorIds: { has: ctx.member!.id } }],
    } })) throw new ForbiddenException("Участник не назначен вам");
    const abortSignal = AbortSignal.timeout(storageRequestTimeoutMs);
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("File download preparation timed out"));
      abortSignal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      // Bound GET plus body consumption, not just response headers. A late
      // provider continuation can only finish reading: it cannot append audits.
      const bytes = await Promise.race([
        (async () => {
          const response = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: file.storageKey }),
            { abortSignal },
          );
          abortSignal.throwIfAborted();
          return Buffer.from(await response.Body!.transformToByteArray());
        })(),
        aborted,
      ]);
      await tx.auditLog.create({ data: {
        organizationId, actorId: ctx.user.id, action: "file.downloaded", entityId: file.id,
      } });
      return { ...file, bytes };
    } finally {
      abortSignal.removeEventListener("abort", onAbort);
    }
  });
}
