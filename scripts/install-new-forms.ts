import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { Queue } from "bullmq";
import { calculateScore, verifyScoringConfig } from "../packages/core/scoring";
const db = new PrismaClient();
const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
if (
  catalog.length !== 6 ||
  catalog.some((x: any) => x.version !== "2.0-2026-10-26")
)
  throw Error("Expected six new forms");
const reset = process.argv.includes("--local-reset");
const replaceLegacy = process.argv.includes("--replace-legacy-assignments");
const organizationId = process.argv.find((arg) => arg.startsWith("--organization-id="))?.split("=").slice(1).join("=");
if (replaceLegacy && (!organizationId || reset))
  throw Error("Legacy replacement requires --organization-id and cannot be combined with --local-reset");
const legacyWhere = {
  organizationId,
  testVersionId: { in: catalog.map((m: any) => m.id + "-v1") },
};
if (process.argv.includes("--dry-run")) {
  if (!replaceLegacy) throw Error("Dry run requires --replace-legacy-assignments");
  await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  console.log(JSON.stringify({
    organizationId,
    legacyAssignments: await db.testAssignment.groupBy({ by: ["campaignId", "testVersionId"], where: legacyWhere, _count: true }),
    legacyAttempts: await db.testAttempt.count({ where: { assignment: legacyWhere } }),
    newAssignments: await db.testAssignment.count({ where: { organizationId, testVersionId: { in: catalog.map((m: any) => m.id + "-v2") } } }),
  }));
  await db.$disconnect();
  process.exit(0);
}
if (
  reset &&
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Reset is restricted to the local database");
if (reset) {
  const redis = new URL(process.env.REDIS_URL!);
  for (const name of ["assessflow-ai", "assessflow-reports"]) {
    const q = new Queue(name, {
      connection: { host: redis.hostname, port: Number(redis.port) },
    });
    await q.drain(true);
    await q.close();
  }
}
await db.$transaction(
  async (tx) => {
    const assignments = reset
      ? await tx.testAssignment.findMany({
          where: {
            testVersion: { testId: { in: catalog.map((x: any) => x.id) } },
          },
        })
      : [];
    const old = reset
      ? await tx.testVersion.findMany({
          where: { testId: { in: catalog.map((x: any) => x.id) } },
        })
      : [];
    if (reset) {
      const campaigns = [...new Set(assignments.map((a) => a.campaignId))];
      const attempts = await tx.testAttempt.findMany({
        where: { assignmentId: { in: assignments.map((a) => a.id) } },
        select: { id: true },
      });
      const ids = attempts.map((a) => a.id);
      await tx.generatedReport.deleteMany({
        where: { campaignId: { in: campaigns } },
      });
      await tx.aiReport.deleteMany({
        where: { campaignId: { in: campaigns } },
      });
      await tx.finalReport.deleteMany({
        where: { campaignId: { in: campaigns } },
      });
      await tx.expertObservation.deleteMany({where:{campaignId:{in:campaigns}}});
      await tx.testResult.deleteMany({ where: { attemptId: { in: ids } } });
      await tx.userAnswer.deleteMany({ where: { attemptId: { in: ids } } });
      await tx.testAttempt.deleteMany({ where: { id: { in: ids } } });
      await tx.testAssignment.deleteMany({
        where: { id: { in: assignments.map((a) => a.id) } },
      });
      await tx.answerOption.deleteMany({
        where: { question: { testVersionId: { in: old.map((v) => v.id) } } },
      });
      await tx.question.deleteMany({
        where: { testVersionId: { in: old.map((v) => v.id) } },
      });
      await tx.scoringKey.deleteMany({
        where: { testVersionId: { in: old.map((v) => v.id) } },
      });
      await tx.testVersion.deleteMany({
        where: { id: { in: old.map((v) => v.id) } },
      });
    }
    for (const m of catalog) {
      verifyScoringConfig(m.config, m.questions);
      const test = {
        name: m.name,
        description: m.description,
        direction: m.direction,
        source: m.source,
        licenseStatus: m.licenseStatus,
        scientificBasis: m.scientificBasis,
      };
      await tx.test.upsert({
        where: { id: m.id },
        update: test,
        create: { id: m.id, ...test },
      });
      const id = m.id + "-v2";
      const existing = await tx.testVersion.findUnique({ where: { id } });
      const sample = Object.fromEntries(
        m.questions.map((q: any) => {
          const k = m.config.items[q.id];
          return [
            q.id,
            k.correct ??
              (q.type === "sjt"
                ? { most: k.most, least: k.least }
                : q.type === "ranking"
                  ? {
                      top: q.options.slice(0, 3).map((x: any) => x.id),
                      bottom: q.options.slice(3, 6).map((x: any) => x.id),
                    }
                  : k.control === "К1"
                    ? 2
                    : k.control === "К2"
                      ? 4
                      : 3),
          ];
        }),
      );
      if(existing){await tx.scoringKey.update({where:{id:m.id+'-key-v2'},data:{controlExamples:[{name:'Контрольный пример формы',answers:sample,expected:calculateScore(m.algorithm,m.config,m.questions,sample)}]}});continue}
      await tx.testVersion.create({
        data: {
          id,
          testId: m.id,
          version: m.version,
          status: "published",
          durationMinutes: m.durationMinutes,
          timeLimitSeconds: m.timeLimitSeconds,
          delivery: m.delivery,
          instructions: m.instructions,
          limitations: m.limitations,
          translationStatus: "working_translation",
          questions: {
            create: m.questions.map((q: any, i: number) => ({
              id: q.id,
              position: i,
              type: q.type,
              text: q.text,
              content: q.content || {},
              imageUrl: q.imageUrl,
              options: {
                create: q.options.map((o: any, j: number) => ({
                  ...o,
                  position: j,
                })),
              },
            })),
          },
          keys: {
            create: {
              id: m.id + "-key-v2",
              version: "2.0-preliminary",
              algorithm: m.algorithm,
              config: m.config,
              source: m.source,
              controlExamples: [
                {
                  answers: sample,
                  expected: calculateScore(
                    m.algorithm,
                    m.config,
                    m.questions,
                    sample,
                  ),
                },
              ],
            },
          },
        },
      });
    }
    if (replaceLegacy) {
      await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
      const legacy = await tx.testAssignment.findMany({ where: legacyWhere });
      const targets = [...new Map(legacy.map((a) => [a.campaignId + ":" + a.membershipId, { campaignId: a.campaignId, membershipId: a.membershipId }])).values()];
      if (targets.length) {
        const mixed = await tx.testAssignment.count({ where: { organizationId, OR: targets, testVersionId: { in: catalog.map((m: any) => m.id + "-v2") } } });
        if (mixed) throw Error("Mixed old/new assignments require a separate migration; no data was changed");
        const attempts = await tx.testAttempt.findMany({ where: { organizationId, assignmentId: { in: legacy.map((a) => a.id) } }, select: { id: true } });
        const ids = attempts.map((a) => a.id);
        // Old test history is explicitly replaced. Accounts, settings, files and practical observations stay intact.
        await tx.generatedReport.deleteMany({ where: { organizationId, OR: [...targets, { kind: "team", campaignId: { in: [...new Set(targets.map((t) => t.campaignId))] } }] } });
        await tx.aiReport.deleteMany({ where: { organizationId, OR: targets } });
        await tx.finalReport.deleteMany({ where: { organizationId, OR: targets } });
        await tx.testResult.deleteMany({ where: { organizationId, attemptId: { in: ids } } });
        await tx.userAnswer.deleteMany({ where: { organizationId, attemptId: { in: ids } } });
        await tx.testAttempt.deleteMany({ where: { organizationId, id: { in: ids } } });
        for (const a of legacy)
          await tx.testAssignment.update({ where: { id: a.id }, data: { testVersionId: a.testVersionId.replace(/-v1$/, "-v2") } });
        for (const testVersionId of legacyWhere.testVersionId.in) {
          if (!await tx.testAssignment.count({ where: { testVersionId } }))
            await tx.testVersion.updateMany({ where: { id: testVersionId }, data: { status: "archived" } });
        }
        await tx.auditLog.create({ data: { organizationId, action: "catalog.legacy_assignments_replaced", detail: { assignments: legacy.length, attempts: ids.length, participants: targets.length } } });
        console.log("Replaced legacy assignments:", legacy.length, "participants:", targets.length);
      }
    }
    if (reset) {
      const targets = new Map<string, (typeof assignments)[number]>();
      for (const a of assignments)
        targets.set(a.campaignId + ":" + a.membershipId, a);
      for (const a of targets.values()) {
        for (const m of catalog)
          await tx.testAssignment.create({
            data: {
              organizationId: a.organizationId,
              campaignId: a.campaignId,
              membershipId: a.membershipId,
              expertId: a.expertId,
              testVersionId: m.id + "-v2",
            },
          });
      }
      console.log("Assigned new forms to", targets.size, "participants");
    }
    await tx.auditLog.create({
      data: {
        action: "catalog.new_forms_installed",
        detail: { version: "2.0-2026-10-26", localReset: reset },
      },
    });
  },
  { timeout: 120000 },
);
await db.$disconnect();
console.log("Six new forms installed");
