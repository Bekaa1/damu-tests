-- Additive only: model activation appends JSON versions through the guarded importer.
-- Existing scoring keys/results/observations/reports and their literals are not rewritten.
ALTER TABLE "users" ADD COLUMN "demoOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "campaigns" ADD COLUMN "country" TEXT;
ALTER TABLE "organizations" ADD COLUMN "dataMode" TEXT NOT NULL DEFAULT 'real';
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_dataMode_check" CHECK ("dataMode" IN ('real','synthetic'));
ALTER TABLE "memberships" ADD COLUMN "profileRow" INTEGER,
  ADD COLUMN "targetLevelModel" TEXT NOT NULL DEFAULT 'В', ADD COLUMN "block" TEXT;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_profileRow_check" CHECK ("profileRow" IS NULL OR "profileRow" BETWEEN 1 AND 65),
  ADD CONSTRAINT "memberships_targetLevelModel_check" CHECK ("targetLevelModel" = 'В'),
  ADD CONSTRAINT "memberships_block_check" CHECK ("block" IS NULL OR "block" IN ('ГО','РФ'));
CREATE UNIQUE INDEX "competency_models_id_organizationId_key" ON "competency_models"("id", "organizationId");
-- Existing organization/campaign/membership FKs and scalar model FK were installed
-- by 202611170001_assessment_quality. Preserve their names and NO ACTION updates.
-- Only add the missing tenant-composite model FK; reject cross-tenant historical
-- references rather than silently repairing/deleting them.
ALTER TABLE "competency_consensus" ADD CONSTRAINT "competency_consensus_modelId_organizationId_fkey" FOREIGN KEY ("modelId", "organizationId") REFERENCES "competency_models"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
