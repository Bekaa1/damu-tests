import "dotenv/config";
import { db, json } from "../apps/api/src/db";
import { assignRetakes } from "../apps/api/src/retakes";
// Local maintenance only. Does not delete attempts, scores or report artifacts.
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("This script is limited to the local database");
try {
  const user = await db.user.findUniqueOrThrow({
    where: { email: "employee@assessflow.local" },
  });
  if (!["Арман Ахметова", "Арман Ахметов"].includes(user.name))
    throw Error("Unexpected demo account name; no changes made");
  const memberships = await db.membership.findMany({
    where: { userId: user.id, role: "employee", status: "active" },
  });
  if (memberships.length !== 1) throw Error("Expected one demo membership");
  const member = memberships[0],
    organizationId = member.organizationId;
  const admin = await db.membership.findFirstOrThrow({
    where: { organizationId, role: "admin", status: "active" },
    include: { user: true, organization: true },
  });
  if (user.name !== "Арман Ахметов")
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { name: "Арман Ахметов" },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: admin.user.id,
          action: "employee.name_corrected",
          entityId: member.id,
          detail: json({
            previous: user.name,
            name: "Арман Ахметов",
            reason:
              "Исправление имени демонстрационной учётной записи по запросу владельца",
          }),
        },
      });
    });
  const campaigns = await db.campaign.findMany({
    where: { organizationId, status: "active", endsAt: { gt: new Date() } },
  });
  let created = 0;
  for (const campaign of campaigns) {
    const tasks = await db.testAssignment.findMany({
      where: {
        organizationId,
        campaignId: campaign.id,
        membershipId: member.id,
      },
      include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } },
    });
    const attempts = tasks
      .filter((a) => a.attempts[0]?.status === "completed")
      .map((a) => ({
        assignmentId: a.id,
        previousAttemptId: a.attempts[0].id,
      }));
    if (!attempts.length) continue;
    const result = await assignRetakes(
      {
        user: admin.user,
        member: admin,
        org: admin.organization,
        role: "admin",
      },
      member.id,
      {
        campaignId: campaign.id,
        attempts,
        reason:
          "Повторная локальная проверка демоаккаунта по запросу владельца",
      },
    );
    created += result.attempts.length;
  }
  console.log(JSON.stringify({ name: "Арман Ахметов", newAttempts: created }));
} finally {
  await db.$disconnect();
}
