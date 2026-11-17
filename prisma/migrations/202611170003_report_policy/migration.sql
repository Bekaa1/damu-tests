ALTER TABLE "generated_reports" ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "generated_reports" ADD COLUMN "reviewIssues" JSONB NOT NULL DEFAULT '[]';
