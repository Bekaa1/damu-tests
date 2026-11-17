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
for (const t of JSON.parse(readFileSync("data/catalog.json", "utf8"))) {
  await db.testVersion.updateMany({
    where: { testId: t.id, version: t.version },
    data: {
      timeLimitSeconds: t.timeLimitSeconds,
      durationMinutes: t.durationMinutes,
      instructions: t.instructions,
    },
  });
}
console.log("Synchronized local test timing and instructions");
await db.$disconnect();
