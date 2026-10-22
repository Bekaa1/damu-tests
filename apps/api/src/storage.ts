import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, audit } from "./db";
import { orgId, participant, requireRole, type Context } from "./access";
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: true,
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
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  const key = `${orgId(ctx)}/${d.membershipId}/${randomUUID()}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: d.contentType,
    }),
  );
  const file = await db.fileAsset.create({
    data: {
      organizationId: orgId(ctx),
      campaignId: d.campaignId,
      membershipId: d.membershipId,
      uploadedBy: ctx.user.id,
      name: d.name,
      contentType: d.contentType,
      size: bytes.length,
      storageKey: key,
    },
  });
  await audit(orgId(ctx), ctx.user.id, "file.uploaded", file.id);
  return { id: file.id, name: file.name };
}
export async function downloadAsset(ctx: Context, id: string) {
  requireRole(ctx, "admin", "expert");
  const file = await db.fileAsset.findFirst({
    where: { id, organizationId: orgId(ctx) },
  });
  if (!file) throw new NotFoundException();
  await participant(ctx, file.membershipId, file.campaignId);
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: file.storageKey }),
  );
  await audit(orgId(ctx), ctx.user.id, "file.downloaded", file.id);
  return {
    ...file,
    bytes: Buffer.from(await response.Body!.transformToByteArray()),
  };
}
