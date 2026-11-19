import { db, json } from "./db";
import {
  METHOD_PASSPORTS,
  neutralMotivationText,
} from "../../../packages/core/method-passports";

export async function updateMethodMetadata() {
  const versions = await db.testVersion.findMany({
    where: {
      version: "2.0-2026-10-26",
      testId: { in: Object.keys(METHOD_PASSPORTS) },
    },
    include: { questions: true },
  });
  for (const version of versions) {
    const delivery = {
      ...(version.delivery as object),
      questionCount: version.questions.length,
      passport: METHOD_PASSPORTS[version.testId],
      passportRevision: "2026-11-19",
    };
    if (
      (version.delivery as any).passportRevision !== delivery.passportRevision
    )
      await db.testVersion.update({
        where: { id: version.id },
        data: {
          delivery: json(delivery),
          limitations: json(delivery.passport.validation),
        },
      });
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
