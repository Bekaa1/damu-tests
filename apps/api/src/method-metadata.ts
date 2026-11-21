import { db, json } from "./db";
import {
  METHOD_PASSPORTS,
  CANONICAL_SJT_SOURCE,
  SJT_PASSPORT_REVISION,
  neutralMotivationText,
} from "../../../packages/core/method-passports";

export async function updateMethodMetadata() {
  const versions = await db.testVersion.findMany({
    where: {
      version: "2.0-2026-10-26",
      testId: { in: Object.keys(METHOD_PASSPORTS) },
    },
    include: { questions: true, test: true },
  });
  for (const version of versions) {
    // This clarification is for the canonical 14-case form, not the legacy draft.
    if (version.testId === "situations" && version.questions.length !== 14)
      continue;
    const delivery = {
      ...(version.delivery as object),
      questionCount: version.questions.length,
      passport: METHOD_PASSPORTS[version.testId],
      passportRevision: version.testId === "situations"
        ? SJT_PASSPORT_REVISION
        : "2026-11-19",
    };
    if (
      (version.delivery as any).passportRevision !== delivery.passportRevision
    ) {
      if (version.testId === "situations") {
        const instructions = {
          ...(version.instructions as Record<string, unknown>),
          kk: (version.instructions as any).kk.replaceAll(
            "«Ең аз ықтимал»", "«Ең ықтималдығы аз»",
          ),
        };
        // Compare-and-swap protects concurrent delivery edits. The source,
        // versioned passport and its metadata-only receipt commit together.
        await db.$transaction(async (tx) => {
          const changed = await tx.testVersion.updateMany({
            where: {
              id: version.id,
              testId: "situations",
              version: "2.0-2026-10-26",
              delivery: { equals: json(version.delivery) },
              instructions: { equals: json(version.instructions) },
            },
            data: {
              delivery: json(delivery),
              instructions: json(instructions),
              limitations: json(delivery.passport.validation),
            },
          });
          if (changed.count !== 1)
            throw Error("Canonical SJT metadata changed during startup; retry required");
          await tx.test.update({
            where: { id: version.testId },
            data: { source: CANONICAL_SJT_SOURCE },
          });
          await tx.auditLog.create({
            data: {
              organizationId: null,
              actorId: null,
              action: "test_version.client_metadata_updated",
              entityId: version.id,
              detail: json({
                revision: SJT_PASSPORT_REVISION,
                scope: "delivery_metadata_only",
                previous: {
                  revision: (version.delivery as any).passportRevision,
                  passport: (version.delivery as any).passport,
                  instructions: version.instructions,
                  source: version.test.source,
                },
                current: { passport: delivery.passport, instructions, source: CANONICAL_SJT_SOURCE },
              }),
            },
          });
        });
      } else {
        await db.testVersion.update({
          where: { id: version.id },
          data: {
            delivery: json(delivery),
            limitations: json(delivery.passport.validation),
          },
        });
      }
    }
    if (version.testId === "motivation")
      for (const question of version.questions) {
        const text = question.text as any;
        const neutral = neutralMotivationText(text.ru);
        if (neutral !== text.ru)
          await db.question.update({
            where: { id: question.id },
            data: { text: json({ ...text, ru: neutral }) },
          });
      }
  }
}
