import "dotenv/config";
import { pathToFileURL } from "node:url";
import { HOLDING_MODEL_VERSION, HOLDING_COMPETENCIES, HOLDING_PROFILES } from "../packages/core/holding";
import { competencyModelSchema } from "../packages/core/competencies";

/** No DB import/connection until target and mode have passed this guard. */
export function parseHoldingImportArguments(args: string[], databaseUrl?: string) {
  let organizationId = "", apply = false, dry = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--org-id") organizationId = args[++i] ?? "";
    else if (args[i] === "--apply") apply = true;
    else if (args[i] === "--dry-run") dry = true;
    else throw new Error("Usage: npx tsx scripts/import-holding.ts --org-id <id> [--dry-run | --apply]");
  }
  if (!organizationId.trim() || organizationId.startsWith("--")) throw new Error("An explicit --org-id is required");
  if (apply && dry) throw new Error("Choose --apply or --dry-run, not both");
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const target = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(target.protocol)) throw new Error("Expected PostgreSQL");
  if ([...target.searchParams.keys()].some(key => key !== "schema")) throw new Error("Connection overrides are not allowed");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (apply && !local) throw new Error("Remote targets are dry-run only; apply is restricted to loopback");
  return { organizationId, dryRun: !apply, local };
}
export async function runHoldingImport(args: string[]) {
  const options = parseHoldingImportArguments(args, process.env.DATABASE_URL);
  const { db } = await import("../apps/api/src/db");
  try {
    const organization = await db.organization.findUnique({ where: { id: options.organizationId }, select: { id: true } });
    if (!organization) throw new Error("Organization not found; no data imported");
    const before = await db.competencyModel.findFirst({ where: { organizationId: organization.id }, orderBy: { version: "desc" } });
    const alreadyActive = (before?.content as any)?.holdingModelVersion === HOLDING_MODEL_VERSION;
    if (!options.dryRun) {
      const { activateHoldingModel } = await import("../apps/api/src/competencies");
      await activateHoldingModel(organization.id, "local-holding-import");
      const after = await db.competencyModel.findFirst({ where: { organizationId: organization.id }, orderBy: { version: "desc" } });
      if (!after || competencyModelSchema.parse(after.content).holdingModelVersion !== HOLDING_MODEL_VERSION)
        throw new Error("Holding model readback verification failed");
    }
    return {
      organizationId: organization.id, dryRun: options.dryRun, alreadyActive,
      holdingModelVersion: HOLDING_MODEL_VERSION,
      competencies: HOLDING_COMPETENCIES.length,
      indicators: HOLDING_COMPETENCIES.reduce((n,c) => n+c.indicators.length,0),
      profiles: HOLDING_PROFILES.length,
      action: alreadyActive ? "no-op" : options.dryRun ? "would_append_model_and_exercise_versions" : "appended_model_and_exercise_versions",
      participantRecordsCreated: 0, scoringKeysChanged: 0, historicalResultsChanged: 0,
    };
  } finally { await db.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHoldingImport(process.argv.slice(2)).then(result => console.log(JSON.stringify(result,null,2))).catch(error => {
    console.error(error instanceof Error ? error.message : "Holding import failed");
    process.exitCode = 1;
  });
}
