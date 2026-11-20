ALTER TABLE "organizations" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'assessment';
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_purpose_check" CHECK ("purpose" IN ('assessment', 'pilot'));
ALTER TABLE "campaigns" ADD COLUMN "employerPermission" JSONB;
