import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
const db = new PrismaClient();
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("local only");
await db.$transaction(async (tx) => {
  for (const t of JSON.parse(readFileSync("data/catalog.json", "utf8"))) {
    await tx.testVersion.updateMany({
      where: { testId: t.id, version: t.version },
      data: {
        timeLimitSeconds: t.timeLimitSeconds,
        durationMinutes: t.durationMinutes,
        instructions: t.instructions,
        delivery: t.delivery,
      },
    });
    if (t.timeLimitSeconds === null)
      await tx.testAttempt.updateMany({
        where: {
          status: "in_progress",
          assignment: { testVersion: { testId: t.id, version: t.version } },
        },
        data: { expiresAt: null, pausedAt: null },
      });
  }
});
console.log(
  "Synchronized local timing, instructions and training; existing answers preserved",
);
await db.$disconnect();
