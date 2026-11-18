CREATE TABLE "frozen_norms" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"campaignId" TEXT NOT NULL UNIQUE,
 "expectedCount" INTEGER NOT NULL DEFAULT 65,"excludedCount" INTEGER NOT NULL,"metrics" JSONB NOT NULL,
 "sourceHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("campaignId","organizationId") REFERENCES "campaigns"("id","organizationId") ON DELETE CASCADE
);
CREATE FUNCTION preserve_frozen_norm() RETURNS trigger AS $$ BEGIN
 RAISE EXCEPTION 'A frozen norm cannot be updated';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER frozen_norm_no_update BEFORE UPDATE ON "frozen_norms" FOR EACH ROW EXECUTE FUNCTION preserve_frozen_norm();
CREATE TABLE "group_schemes" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "version" INTEGER NOT NULL,"status" TEXT NOT NULL DEFAULT 'draft',"content" JSONB NOT NULL,
 "authorId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId","version"),UNIQUE ("id","organizationId")
);
CREATE TABLE "participant_groups" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"campaignId" TEXT NOT NULL,"membershipId" TEXT NOT NULL,
 "schemeId" TEXT NOT NULL,"groupId" TEXT NOT NULL,"reason" TEXT NOT NULL,"consensusId" TEXT NOT NULL,"authorId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("campaignId","organizationId") REFERENCES "campaigns"("id","organizationId") ON DELETE CASCADE,
 FOREIGN KEY ("membershipId","organizationId") REFERENCES "memberships"("id","organizationId") ON DELETE CASCADE,
 FOREIGN KEY ("schemeId","organizationId") REFERENCES "group_schemes"("id","organizationId") ON DELETE CASCADE
);
CREATE INDEX participant_groups_lookup ON "participant_groups"("organizationId","campaignId","membershipId","createdAt");
CREATE TABLE "sjt_expert_keys" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
 "version" INTEGER NOT NULL,"status" TEXT NOT NULL DEFAULT 'draft',"payload" JSONB NOT NULL,
 "authorId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId","version")
);
