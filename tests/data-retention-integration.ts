/** Opt-in, synthetic-only PostgreSQL/S3 acceptance. No server or external AI.
 * Read the guards before running; it refuses defaults and non-loopback targets.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { participantDeletionDate } from "../packages/core/data-policy";

assert.equal(process.env.RUN_DATA_RETENTION_INTEGRATION, "1", "Explicit local integration opt-in required");
assert.notEqual(process.env.NODE_ENV, "production", "Never run against production");
const database = new URL(process.env.DATABASE_URL || "http://invalid");
const endpoint = new URL(process.env.S3_ENDPOINT || "http://invalid");
for (const target of [database, endpoint]) assert(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "Loopback services only");
assert(["postgres:", "postgresql:"].includes(database.protocol), "PostgreSQL test database required");
assert(["http:", "https:"].includes(endpoint.protocol), "HTTP loopback S3 required");
assert(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY, "Explicit test S3 credentials required before provider imports");
const databaseName = decodeURIComponent(database.pathname.slice(1));
assert(databaseName && databaseName === process.env.DATA_RETENTION_TEST_DATABASE, "Explicitly acknowledge the exact disposable database name");
assert(/^assessflow_(?:holding_[0-9]{8}(?:_[a-z0-9]+)*|retention_test(?:_[a-z0-9]+)*)$/.test(databaseName), "Disposable Holding/retention test database required");
assert(!database.hash && [...database.searchParams].every(([key,value])=>key==='schema' && value==='public') && database.searchParams.getAll('schema').length<=1, "Database routing overrides forbidden");
const bucket = process.env.S3_BUCKET || "";
assert(/^(test|qa)-[a-z0-9-]+$/.test(bucket), "Dedicated test-/qa- S3 bucket required");

// Import providers only AFTER all destination guards. No .env fallback.
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ||= randomUUID() + randomUUID();
const { PrismaClient } = await import("@prisma/client");
const { hashPassword } = await import("better-auth/crypto");
const { AccessGuard, participant, requireRole } = await import("../apps/api/src/access");
const { auth } = await import("../apps/api/src/auth");
const { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
const { eraseExpiredParticipant, eraseExpiredPilotParticipant } = await import("../apps/api/src/pilot-retention");
const { db: workerDb } = await import("../apps/api/src/db");
const db = new PrismaClient();
const id = `qa-data-retention-${randomUUID()}`, other = `${id}-other`, pilot = `${id}-pilot`;
const orgs = [id, other, pilot], createdAt = new Date("2026-11-30T10:15:30.123Z"), deadline = participantDeletionDate(createdAt);
const userId = (label: string) => `${id}-${label}`;
const expired = userId("expired"), shared = userId("shared"), key = `${id}/${expired}/synthetic-file`;
const s3 = new S3Client({ endpoint: endpoint.toString(), region: process.env.S3_REGION || "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY || "", secretAccessKey: process.env.S3_SECRET_KEY || "" } });
try {
  for (const organizationId of orgs) {
    await db.organization.create({ data: { id: organizationId, name: "Synthetic retention acceptance", slug: organizationId, purpose: organizationId === pilot ? "pilot" : "assessment", dataMode: organizationId === other ? "synthetic" : "real", matrixConfig: {} } });
    await db.campaign.create({ data: { id: organizationId, organizationId, name: "Synthetic campaign", endsAt: new Date("2027-12-31T00:00:00Z") } });
  }
  for (const label of ["expired", "shared", "fresh", "admin", "expert", "platform", "pilot"]) {
    const uid = userId(label), organizationId = label === "pilot" ? pilot : id;
    await db.user.create({ data: { id: uid, name: `Synthetic ${label}`, email: `${uid}@example.test`, platformAdmin: label === "platform",
      accounts: { create: { providerId: "credential", accountId: uid, password: "not-a-usable-credential" } },
      sessions: { create: { id: uid, token: uid, expiresAt: new Date("2027-12-31T00:00:00Z") } },
      memberships: { create: { id: uid, organizationId, role: ["admin", "expert"].includes(label) ? label : "employee", createdAt: label === "fresh" ? deadline : createdAt,
        consentAt: deadline, consentVersion: "fresh-consent-must-not-renew" } },
    } });
    if (label === "shared") await db.membership.create({ data: { id: `${uid}-other`, organizationId: other, userId: uid, createdAt: deadline } });
  }
  const demoId = userId("dedicated-demo"), demoPassword = randomUUID() + "!Aa1";
  const demo = await db.user.create({ data: { id: demoId, name: "Synthetic demo scope", email: `${demoId}@example.test`, demoOnly: true, platformAdmin: true, mustChangePassword: false,
    accounts: { create: { providerId: "credential", accountId: demoId, password: await hashPassword(demoPassword) } },
    memberships: { create: orgs.slice(0, 2).map(organizationId => ({ id: `${demoId}-${organizationId}`, organizationId, role: "expert" })) },
  } });
  const signedIn = await auth.api.signInEmail({ body: { email: demo.email, password: demoPassword }, headers: new Headers({ origin: "http://localhost:3000" }), asResponse: true });
  assert.equal(signedIn.status, 200, "Synthetic auth fixture must sign in");
  const cookie = signedIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert(cookie, "Synthetic auth fixture must receive session cookie");
  const guarded = async (organizationId: string) => {
    const request: any = { method: "GET", path: "/api/me", headers: { cookie, "x-organization-id": organizationId } };
    await new AccessGuard().canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any);
    return request.ctx;
  };
  await assert.rejects(guarded(id), /[Дд]емонстрационн/);
  const demoScope = await guarded(other);
  assert.equal(demoScope.role, "expert");
  assert.throws(() => requireRole(demoScope, "superadmin"));
  assert.throws(() => requireRole(demoScope, "admin"));
  assert.doesNotThrow(() => requireRole(demoScope, "expert"));
  await assert.rejects(participant({ org: await db.organization.findUniqueOrThrow({ where: { id } }), user: demo, role: "superadmin", member: null }, expired), /[Дд]емонстрационн/);
  assert.equal(await db.membership.count({ where: { userId: demoId } }), 2, "Isolation must not delete old memberships/history");
  console.log("PASS demo-only direct real-org header denied despite real membership and superadmin; synthetic scope allowed");

  await db.test.create({ data: { id, name: { ru: "Synthetic" }, description: {}, direction: "test", source: "synthetic", licenseStatus: "test", scientificBasis: "fixture" } });
  await db.testVersion.create({ data: { id, testId: id, version: "fixture", durationMinutes: 1, instructions: {}, limitations: {} } });
  await db.testAssignment.create({ data: { id: expired, organizationId: id, campaignId: id, membershipId: expired, testVersionId: id } });
  await db.testAttempt.create({ data: { id: expired, organizationId: id, assignmentId: expired, language: "ru", scoringKeyId: "synthetic-key",
    answers: { create: { questionId: "synthetic-question", value: "synthetic raw answer" } },
    results: { create: { scoringKeyId: "synthetic-key", result: { raw: 1 } } },
  } });
  await db.assessmentExercise.create({ data: { id, organizationId: id, type: "interview", name: {}, criteria: {} } });
  await db.expertObservation.create({ data: { id: expired, organizationId: id, campaignId: id, membershipId: expired, expertId: userId("expert"), exerciseId: id, criteriaSnapshot: {}, scores: {}, notes: "synthetic private observation", version: 1 } });
  await db.competencyModel.create({ data: { id, organizationId: id, version: 1, content: {}, authorId: userId("expert") } });
  await db.competencyConsensus.create({ data: { id: expired, organizationId: id, campaignId: id, membershipId: expired, modelId: id, version: 1, scores: {}, authorId: userId("expert") } });
  await db.finalReport.create({ data: { id: expired, organizationId: id, campaignId: id, membershipId: expired, authorId: userId("expert"), version: 1, content: {}, resultIds: [], observationIds: [] } });
  await db.aiReport.create({ data: { id: expired, organizationId: id, campaignId: id, membershipId: expired, model: "not-an-external-request", promptVersion: "fixture", inputHash: "fixture", resultIds: [] } });
  for (const label of ["direct", "team", "legacy"]) await db.generatedReport.create({ data: {
    id: `${expired}-${label}`, organizationId: id, campaignId: id, membershipId: label === "direct" ? expired : null, kind: label === "direct" ? "individual" : "team", language: "ru", status: "completed", generationMode: "data",
    participantIds: label === "team" ? [expired, userId("fresh")] : [], snapshot: label === "legacy" ? { asset: `${expired}-file` } : {},
    inputHash: "fixture", model: "", prompt: "", promptVersion: "fixture", providerConfig: {}, createdBy: userId("admin"),
    artifact: { create: { bytes: Buffer.from("synthetic local artifact"), sha256: "fixture" } },
  } });
  await db.generatedReport.create({ data: { id: `${id}-keep-report`, organizationId: id, campaignId: id, kind: "individual", language: "ru", membershipId: userId("fresh"), participantIds: [userId("fresh")], snapshot: {}, inputHash: "keep", model: "", prompt: "", promptVersion: "fixture", providerConfig: {}, createdBy: userId("admin") } });
  await db.frozenNorm.create({ data: { id: expired, organizationId: id, campaignId: id, excludedCount: 0, metrics: {}, sourceHash: "fixture", createdBy: userId("admin") } });
  await db.auditLog.createMany({ data: [
    { id: `${expired}-consent`, organizationId: id, actorId: expired, action: "consent.accepted", entityId: expired, detail: { email: `${expired}@example.test` } },
    { id: `${expired}-name`, organizationId: id, action: "fixture.name", detail: { name: "Synthetic expired" } },
    { id: `${expired}-filelog`, organizationId: id, action: "fixture.file", detail: { fileId: `${expired}-file` } },
    { id: `${id}-keep-audit`, organizationId: other, action: "fixture.other_tenant", detail: { userId: shared } },
  ] });
  await db.verification.create({ data: { identifier: `${expired}@example.test`, value: "synthetic", expiresAt: deadline } });
  try { await s3.send(new CreateBucketCommand({ Bucket: bucket })); } catch (error) {
    if (!["BucketAlreadyExists", "BucketAlreadyOwnedByYou"].includes((error as Error).name)) throw error;
  }
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "synthetic private file" }));
  await db.fileAsset.create({ data: { id: `${expired}-file`, organizationId: id, campaignId: id, membershipId: expired, uploadedBy: userId("expert"), name: "synthetic.txt", contentType: "text/plain", size: 22, storageKey: key } });

  assert.equal(await eraseExpiredParticipant(expired, new Date(+deadline - 1)), false);
  assert.equal(await eraseExpiredPilotParticipant(expired, deadline), false);
  assert.equal(await eraseExpiredParticipant(expired, deadline), true);
  assert.equal(await eraseExpiredParticipant(expired, deadline), false);
  for (const model of ["membership", "user", "account", "session", "verification", "testAssignment", "testAttempt", "userAnswer", "testResult", "expertObservation", "competencyConsensus", "finalReport", "aiReport", "generatedReport", "reportArtifact", "fileAsset"] as const) {
    const rows = await (db[model] as any).findMany();
    assert(!JSON.stringify(rows).includes(expired), `${model} retained synthetic expired participant`);
  }
  assert.equal(await db.auditLog.count({ where: { id: { startsWith: expired } } }), 0);
  assert.equal(await db.auditLog.count({ where: { organizationId: id, action: "participant.retention_erased" } }), 1);
  assert.equal(await db.frozenNorm.count({ where: { organizationId: id } }), 0);
  assert(await db.generatedReport.findUnique({ where: { id: `${id}-keep-report` } }));
  await assert.rejects(s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })), error => (error as any).$metadata?.httpStatusCode === 404);
  assert.equal(await eraseExpiredParticipant(shared, deadline), true);
  assert(await db.user.findUnique({ where: { id: shared } }));
  assert(await db.membership.findUnique({ where: { id: `${shared}-other` } }));
  assert(await db.session.findUnique({ where: { id: shared } }));
  assert(await db.auditLog.findUnique({ where: { id: `${id}-keep-audit` } }));
  for (const label of ["fresh", "admin", "expert", "platform"]) assert.equal(await eraseExpiredParticipant(userId(label), deadline), false);
  assert.equal(await eraseExpiredParticipant(userId("pilot"), deadline), true);
  console.log("PASS real/pilot calendar expiry; raw data, S3 files, snapshots/artifacts and audit PII erased; shared tenant, staff and fresh subjects preserved");
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
  for (const model of ["generatedReport", "finalReport", "aiReport", "expertObservation", "participantGroup", "competencyConsensus", "competencyModel", "frozenNorm", "fileAsset", "userAnswer", "testResult", "testAttempt", "testAssignment", "assessmentExercise", "auditLog"] as const)
    await (db[model] as any).deleteMany({ where: { organizationId: { in: orgs } } });
  await db.campaign.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.organization.deleteMany({ where: { id: { in: orgs } } });
  await db.user.deleteMany({ where: { id: { startsWith: `${id}-` } } });
  await db.verification.deleteMany({ where: { identifier: { startsWith: `${id}-` } } });
  await db.rateLimit.deleteMany({ where: { key: `login-account:${createHash("sha256").update(`${userId("dedicated-demo")}@example.test`).digest("hex")}` } });
  await db.testVersion.deleteMany({ where: { id } });
  await db.test.deleteMany({ where: { id } });
  await db.$disconnect(); await workerDb.$disconnect(); s3.destroy();
}
