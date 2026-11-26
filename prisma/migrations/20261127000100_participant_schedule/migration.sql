CREATE TABLE "participant_schedules" (
    "membershipId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "acknowledgedAt" TIMESTAMP(3),
    PRIMARY KEY ("membershipId", "campaignId"),
    FOREIGN KEY ("membershipId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("campaignId", "organizationId") REFERENCES "campaigns"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
