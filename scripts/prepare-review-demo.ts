import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import {
  calculateScore,
  type QuestionInput,
  type ScoringConfig,
} from "../packages/core/scoring";
import { assessmentCompletion } from "../packages/core/result-validity";

// Synthetic fixtures live in a separate campaign and never enter the 65-person reference cohort.
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("This script is for the local demo database only");
const db = new PrismaClient(),
  organizationId = "demo-organization",
  campaignId = "review-demo-20261119";
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
try {
  await db.campaign.upsert({
    where: { id: campaignId },
    update: {},
    create: {
      id: campaignId,
      organizationId,
      name: "Демонстрация отчётов · вымышленные данные",
      description:
        "Пять вымышленных участников для технической проверки. Не включать в норму основной кампании.",
      endsAt: new Date("2027-02-01"),
    },
  });
  const versions = await db.testVersion.findMany({
    where: { version: "2.0-2026-10-26", status: "published" },
    include: {
      test: true,
      questions: {
        orderBy: { position: "asc" },
        include: { options: { orderBy: { position: "asc" } } },
      },
      keys: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (versions.length !== 6) throw Error("Expected the six current forms");
  const expert = await db.membership.findFirst({
    where: { organizationId, role: "expert" },
  });
  for (let n = 1; n <= 5; n++) {
    const id = `report-demo-${n}`,
      email = `report-demo${n}@assessflow.local`;
    const user = await db.user.upsert({
      where: { email },
      update: {},
      create: {
        id,
        email,
        name: `Демо участник ${n}`,
        emailVerified: true,
        mustChangePassword: false,
        accounts: {
          create: {
            accountId: id,
            providerId: "credential",
            password: await hashPassword(
              process.env.SEED_PASSWORD || "AssessFlow!2026",
            ),
          },
        },
      },
    });
    const member = await db.membership.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      update: {},
      create: {
        id,
        organizationId,
        userId: user.id,
        role: "employee",
        unit: "Демонстрационная группа",
        position: "Директор",
        category: "Руководитель",
      },
    });
    for (const v of versions) {
      const assignment = await db.testAssignment.upsert({
        where: {
          campaignId_membershipId_testVersionId: {
            campaignId,
            membershipId: member.id,
            testVersionId: v.id,
          },
        },
        update: {},
        create: {
          organizationId,
          campaignId,
          membershipId: member.id,
          testVersionId: v.id,
          expertId: expert?.id,
        },
      });
      if (
        await db.testAttempt.count({ where: { assignmentId: assignment.id } })
      )
        continue;
      const key = v.keys[0],
        config = key.config as ScoringConfig,
        questions = v.questions as unknown as QuestionInput[];
      const answers: Record<string, any> = {};
      for (const [i, q] of questions.entries()) {
        const item = config.items[q.id];
        if (q.type === "scale") {
          answers[q.id] = 2 + ((i + n) % 3);
          if (q.id.endsWith("-К1")) answers[q.id] = 2;
          if (q.id.endsWith("-К2")) answers[q.id] = 4;
          if (item.control && !q.id.endsWith("-К1") && !q.id.endsWith("-К2"))
            answers[q.id] = 2;
          if (
            v.testId === "personality" &&
            [15, 4, 6, 2, 12].some((x) => q.id === `personality-v2-${x}`)
          )
            answers[q.id] = 3;
        } else if (q.type === "ranking") {
          answers[q.id] = {
            top: q.options.slice(0, 3).map((o) => o.id),
            bottom: q.options.slice(-3).map((o) => o.id),
          };
        } else if (q.type === "sjt") {
          answers[q.id] = {
            most: item.most || q.options[(i + n) % q.options.length].id,
            least: item.least || q.options[(i + n + 1) % q.options.length].id,
          };
        } else {
          answers[q.id] =
            (i + n) % 5 === 0
              ? (q.options.find((o) => o.id !== item.correct)?.id ??
                Number(item.correct) + 1)
              : item.correct;
        }
      }
      const durations = Object.fromEntries(
        questions.map((q) => [
          q.id,
          v.testId === "situations"
            ? 90000
            : v.timeLimitSeconds
              ? 25000
              : 12000,
        ]),
      );
      let score = calculateScore(key.algorithm, config, questions, answers, {
        durations,
      });
      const ranking = questions.find((q) => q.type === "ranking");
      if (ranking && score.scales) {
        const order = Object.entries(score.scales).sort(
          (a, b) => b[1].mean - a[1].mean,
        );
        answers[ranking.id] = {
          top: order.slice(0, 3).map(([id]) => id),
          bottom: order.slice(-3).map(([id]) => id),
        };
        score = calculateScore(key.algorithm, config, questions, answers, {
          durations,
        });
      }
      if (score.reviewRequired)
        throw Error(
          `Synthetic ${v.testId} profile unexpectedly requires quality review`,
        );
      const validity = assessmentCompletion(
        questions,
        answers,
        config,
        key.algorithm === "scales",
      );
      if (!validity.eligible) throw Error("Incomplete synthetic response set");
      const elapsed = Object.values(durations).reduce((a, b) => a + b, 0),
        submittedAt = new Date(),
        startedAt = new Date(submittedAt.getTime() - elapsed);
      await db.$transaction(async (tx) => {
        const attempt = await tx.testAttempt.create({
          data: {
            organizationId,
            assignmentId: assignment.id,
            scoringKeyId: key.id,
            language: "ru",
            status: "completed",
            startedAt,
            timerStartedAt: startedAt,
            submittedAt,
            manuallySubmittedAt: submittedAt,
            expiresAt: v.timeLimitSeconds
              ? new Date(startedAt.getTime() + v.timeLimitSeconds * 1000)
              : null,
          },
        });
        await tx.userAnswer.createMany({
          data: questions.map((q, i) => ({
            organizationId,
            attemptId: attempt.id,
            questionId: q.id,
            value: json(answers[q.id]),
            durationMs: durations[q.id],
            answeredAt: new Date(
              startedAt.getTime() + (i + 1) * durations[q.id],
            ),
            receivedAt: submittedAt,
          })),
        });
        await tx.testResult.create({
          data: {
            organizationId,
            attemptId: attempt.id,
            scoringKeyId: key.id,
            result: json({
              ...score,
              validity,
              demo: true,
              sessionQuality: { departures: 0, awayMs: 0 },
            }),
            reason: "synthetic_review_fixture",
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId,
            actorId: null,
            action: "demo.completed_fixture",
            entityId: attempt.id,
            detail: json({
              synthetic: true,
              campaignId,
              submittedAt,
              validity,
            }),
          },
        });
      });
    }
    console.log(`Prepared ${email}: six complete synthetic attempts`);
  }
  console.log("Campaign:", campaignId);
} finally {
  await db.$disconnect();
}
