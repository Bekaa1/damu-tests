import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient(), id = "qa-install-" + Date.now();
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw Error("Local fixtures only");
const tests = ["verbal", "numerical", "logical", "personality", "motivation", "situations"];
const oldIds = tests.map(t => t + "-v1"), created: string[] = [];
function install(extra: string[] = []) {
  return execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/install-new-forms.ts", "--replace-legacy-assignments", "--organization-id=" + id, ...extra], { encoding: "utf8", stdio: "pipe" });
}
try {
  assert.equal(await db.testVersion.count({ where: { id: { in: oldIds } } }), 0, "This test requires a local database already using v2; existing v1 forms will not be touched");
  for (const org of [id, id + "-other"]) {
    await db.organization.create({ data: { id: org, name: "Installer QA", slug: org, matrixConfig: {} } });
    await db.user.create({ data: { id: org, email: org + "@assessflow.local", name: "Installer QA", memberships: { create: { id: org, organizationId: org, role: "employee" } } } });
    await db.campaign.create({ data: { id: org, organizationId: org, name: "Installer QA", endsAt: new Date(Date.now() + 86400000) } });
  }
  for (const testId of tests) {
    const testVersionId = testId + "-v1", scoringKeyId = id + "-" + testId;
    await db.testVersion.create({ data: { id: testVersionId, testId, version: id, status: "draft", durationMinutes: 1, instructions: {}, limitations: [] } });
    created.push(testVersionId);
    await db.scoringKey.create({ data: { id: scoringKeyId, testVersionId, version: "qa", algorithm: "correct", config: {}, source: "QA", controlExamples: [] } });
    for (const organizationId of [id, id + "-other"]) {
      const a = await db.testAssignment.create({ data: { organizationId, campaignId: organizationId, membershipId: organizationId, testVersionId } });
      const attempt = await db.testAttempt.create({ data: { organizationId, assignmentId: a.id, language: "ru", scoringKeyId, status: "completed", submittedAt: new Date() } });
      await db.testResult.create({ data: { organizationId, attemptId: attempt.id, scoringKeyId, result: { total: 1 } } });
    }
  }
  for (const kind of ["individual", "team"]) await db.generatedReport.create({ data: { organizationId: id, campaignId: id, membershipId: kind === "individual" ? id : null, kind, language: "ru", participantIds: [id], snapshot: {}, inputHash: id, model: "qa", prompt: "qa", promptVersion: "qa", providerConfig: {}, createdBy: id } });
  const plan = JSON.parse(install(["--dry-run"]));
  assert.equal(plan.legacyAttempts, 6);
  assert.equal(await db.testAttempt.count({ where: { organizationId: id } }), 6);
  install();
  assert.equal(await db.user.count({ where: { id } }), 1);
  assert.equal(await db.testAssignment.count({ where: { organizationId: id, testVersionId: { in: tests.map(t => t + "-v2") } } }), 6);
  assert.equal(await db.testAttempt.count({ where: { organizationId: id } }), 0);
  assert.equal(await db.generatedReport.count({ where: { organizationId: id } }), 0);
  assert.equal(await db.testAttempt.count({ where: { organizationId: id + "-other" } }), 6);
  const a = await db.testAssignment.findFirstOrThrow({ where: { organizationId: id, testVersionId: "verbal-v2" } });
  const fresh = await db.testAttempt.create({ data: { organizationId: id, assignmentId: a.id, language: "ru", scoringKeyId: "verbal-key-v2", status: "completed" } });
  install();
  assert(await db.testAttempt.findUnique({ where: { id: fresh.id } }));
  const conflicting = await db.testAssignment.create({ data: { organizationId: id, campaignId: id, membershipId: id, testVersionId: "verbal-v1" } });
  assert.throws(() => install(), /Mixed old\/new assignments/);
  assert(await db.testAssignment.findUnique({ where: { id: conflicting.id } }));
  assert(await db.testAttempt.findUnique({ where: { id: fresh.id } }));
  console.log("PASS: dry run is read-only; legacy history is replaced in the selected organization; accounts and another organization's results survive; rerun preserves new attempts; mixed versions roll back.");
} finally {
  const orgs = [id, id + "-other"];
  const assignments = await db.testAssignment.findMany({ where: { organizationId: { in: orgs } } });
  const attempts = await db.testAttempt.findMany({ where: { assignmentId: { in: assignments.map(a => a.id) } } });
  const ids = attempts.map(a => a.id);
  await db.generatedReport.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.testResult.deleteMany({ where: { attemptId: { in: ids } } });
  await db.userAnswer.deleteMany({ where: { attemptId: { in: ids } } });
  await db.testAttempt.deleteMany({ where: { id: { in: ids } } });
  await db.testAssignment.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.scoringKey.deleteMany({ where: { testVersionId: { in: created } } });
  await db.testVersion.deleteMany({ where: { id: { in: created } } });
  await db.campaign.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.user.deleteMany({ where: { id: { in: orgs } } });
  await db.organization.deleteMany({ where: { id: { in: orgs } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.$disconnect();
}
