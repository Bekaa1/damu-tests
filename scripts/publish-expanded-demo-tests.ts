import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
const targetTests = catalog.filter((test: any) =>
  ["verbal", "numerical", "situations"].includes(test.id),
);
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

if (process.env.DEMO_MODE !== "true") {
  throw new Error("Expanded test versions may only be published in DEMO_MODE.");
}

try {
  const user = await db.user.findUnique({
    where: { email: "employee@assessflow.local" },
    include: { memberships: true },
  });
  const membership = user?.memberships.find(
    (item) =>
      item.organizationId === "demo-organization" && item.role === "employee",
  );
  const campaign = await db.campaign.findUnique({
    where: { id: "demo-campaign" },
  });
  if (!membership || !campaign || campaign.organizationId !== membership.organizationId)
    throw new Error("Demo employee or campaign was not found.");

  for (const test of targetTests) {
    await db.test.update({
      where: { id: test.id },
      data: {
        name: json(test.name),
        description: json(test.description),
        direction: test.direction,
        source: test.source,
        licenseStatus: test.licenseStatus,
        scientificBasis: test.scientificBasis,
      },
    });

    const versionId = `${test.id}-v2`;
    let version = await db.testVersion.findUnique({
      where: { id: versionId },
      include: { questions: { include: { options: true } }, keys: true },
    });

    if (!version) {
      const idMap = new Map<string, string>();
      for (const question of test.questions) {
        idMap.set(question.id, `${question.id}-v2`);
        for (const option of question.options ?? [])
          idMap.set(option.id, `${option.id}-v2`);
      }
      const remap = (value: any): any => {
        if (typeof value === "string") return idMap.get(value) ?? value;
        if (Array.isArray(value)) return value.map(remap);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
              idMap.get(key) ?? key,
              remap(child),
            ]),
          );
        return value;
      };

      version = await db.testVersion.create({
        data: {
          id: versionId,
          testId: test.id,
          version: "2.0-demo-expanded",
          status: "published",
          durationMinutes: test.durationMinutes,
          instructions: json(test.instructions),
          limitations: json(test.limitations),
          approvedBy: "DEMO_ONLY",
          translationStatus: "draft",
          questions: {
            create: test.questions.map((question: any, position: number) => ({
              id: idMap.get(question.id),
              position,
              type: question.type,
              text: json(question.text),
              imageUrl: question.imageUrl,
              options: {
                create: (question.options ?? []).map(
                  (option: any, optionPosition: number) => ({
                    id: idMap.get(option.id),
                    position: optionPosition,
                    text: json(option.text),
                    imageUrl: option.imageUrl,
                  }),
                ),
              },
            })),
          },
          keys: {
            create: {
              id: `${test.id}-key-v2`,
              version: "2.0-preliminary",
              algorithm: test.algorithm,
              config: json(remap(test.config)),
              source: test.source,
              controlExamples: json(remap(test.controlExamples)),
            },
          },
        },
        include: { questions: true, keys: true },
      });
    } else if (
      version.questions.length !== test.questions.length ||
      version.keys.length !== 1
    ) {
      throw new Error(`Existing ${versionId} does not match the expanded catalog.`);
    }

    const priorAssignment = await db.testAssignment.findFirst({
      where: {
        organizationId: membership.organizationId,
        campaignId: campaign.id,
        membershipId: membership.id,
        testVersion: { testId: test.id },
      },
      orderBy: { createdAt: "desc" },
    });
    await db.testAssignment.upsert({
      where: {
        campaignId_membershipId_testVersionId: {
          campaignId: campaign.id,
          membershipId: membership.id,
          testVersionId: versionId,
        },
      },
      update: { expertId: priorAssignment?.expertId ?? null },
      create: {
        organizationId: membership.organizationId,
        campaignId: campaign.id,
        membershipId: membership.id,
        testVersionId: versionId,
        expertId: priorAssignment?.expertId ?? null,
      },
    });
    console.log(`${test.id}: ${version.questions.length} questions assigned to ${user!.email}`);
  }
} finally {
  await db.$disconnect();
}
