ALTER TABLE "organizations"
  ALTER COLUMN "showPreliminary" SET DEFAULT true,
  ALTER COLUMN "showApproved" SET DEFAULT true;

UPDATE "organizations"
SET "showPreliminary" = true,
    "showApproved" = true;
