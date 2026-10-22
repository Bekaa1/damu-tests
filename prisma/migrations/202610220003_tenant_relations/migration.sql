-- CreateIndex
CREATE UNIQUE INDEX "assessment_exercises_id_organizationId_key" ON "assessment_exercises"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "test_assignments" ADD CONSTRAINT "test_assignments_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_assignments" ADD CONSTRAINT "test_assignments_expertId_organizationId_fkey" FOREIGN KEY ("expertId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_campaignId_organizationId_fkey" FOREIGN KEY ("campaignId", "organizationId") REFERENCES "campaigns"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_exercises" ADD CONSTRAINT "assessment_exercises_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert_observations" ADD CONSTRAINT "expert_observations_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert_observations" ADD CONSTRAINT "expert_observations_campaignId_organizationId_fkey" FOREIGN KEY ("campaignId", "organizationId") REFERENCES "campaigns"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert_observations" ADD CONSTRAINT "expert_observations_exerciseId_organizationId_fkey" FOREIGN KEY ("exerciseId", "organizationId") REFERENCES "assessment_exercises"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_reports" ADD CONSTRAINT "final_reports_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_reports" ADD CONSTRAINT "final_reports_campaignId_organizationId_fkey" FOREIGN KEY ("campaignId", "organizationId") REFERENCES "campaigns"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "memberships"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_campaignId_organizationId_fkey" FOREIGN KEY ("campaignId", "organizationId") REFERENCES "campaigns"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

