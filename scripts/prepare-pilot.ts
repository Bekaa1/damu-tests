import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { defaultMatrix } from "../packages/core/contracts";

// Creates an empty, isolated workspace. No existing accounts, answers, norms or
// campaign assignments are copied. Platform owners already have access.
const args = new Set(process.argv.slice(2));
const option = (name: string) =>
  process.argv
    .find((arg) => arg.startsWith(name + "="))
    ?.slice(name.length + 1);
const local = ["localhost", "127.0.0.1"].includes(
  new URL(process.env.DATABASE_URL!).hostname,
);
if (!local && !args.has("--production"))
  throw Error("For a remote database pass --production explicitly");
const endsAt = new Date(option("--ends-at") || "2026-12-21T18:59:59.000Z");
if (!Number.isFinite(endsAt.getTime()) || endsAt <= new Date())
  throw Error("Provide a future --ends-at date");
const reference = option("--permission-reference");
if (args.has("--confirm-employer-permission") && !reference?.trim())
  throw Error(
    "Provide the source of the organizer's confirmation with --permission-reference",
  );
const db = new PrismaClient();
try {
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.organization.findUnique({
      where: { slug: "pilot" },
    });
    if (existing && existing.purpose !== "pilot")
      throw Error(
        "Slug pilot belongs to an assessment organization; refusing to change it",
      );
    const org =
      existing ||
      (await tx.organization.create({
        data: {
          id: "pilot-workspace",
          slug: "pilot",
          name: "Пилот",
          purpose: "pilot",
          matrixConfig: defaultMatrix,
          aiBudget: 0,
        },
      }));
    let campaign = await tx.campaign.findUnique({
      where: { id: "pilot-2026" },
    });
    if (campaign && campaign.organizationId !== org.id)
      throw Error("Campaign ID belongs to another organization");
    if (!campaign)
      campaign = await tx.campaign.create({
        data: {
          id: "pilot-2026",
          organizationId: org.id,
          name: "Пилот",
          endsAt,
          description:
            "Добровольная проверка инструментов. Данные изолированы от оценки Даму; индивидуальные результаты работодателю и руководству не передаются.",
        },
      });
    if (
      args.has("--confirm-employer-permission") &&
      !campaign.employerPermission
    ) {
      const permission = {
        employer:
          option("--employer") ||
          "Работодатель участников пилота (название не предоставлено)",
        reference: reference!,
        receivedAt: new Date().toISOString().slice(0, 10),
        recordedAt: new Date().toISOString(),
        recordedBy: "project-organizer-confirmation",
      };
      campaign = await tx.campaign.update({
        where: { id: campaign.id },
        data: { employerPermission: permission },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          action: "pilot.employer_permission_recorded",
          entityId: campaign.id,
          detail: {
            permission,
            source: "explicit_project_organizer_instruction",
            recordedVia: "prepare-pilot",
          },
        },
      });
    }
    if (!existing)
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          action: "pilot.workspace_created",
          entityId: campaign.id,
          detail: {
            purpose: "pilot",
            access: "platform_owners_only_until_team_members_added",
            existingDataCopied: false,
          },
        },
      });
    return {
      organizationId: org.id,
      campaignId: campaign.id,
      purpose: org.purpose,
      employerPermissionRecorded: Boolean(campaign.employerPermission),
      members: await tx.membership.count({ where: { organizationId: org.id } }),
    };
  });
  console.log(JSON.stringify(result));
} finally {
  await db.$disconnect();
}
