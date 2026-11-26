ALTER TABLE memberships
  ADD COLUMN "videoConsentVersion" TEXT,
  ADD COLUMN "videoConsentAt" TIMESTAMP(3),
  ADD COLUMN "videoConsentLocale" TEXT;
CREATE TABLE video_sessions (
  id TEXT PRIMARY KEY,
  "attemptId" TEXT REFERENCES test_attempts(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'connecting',
  "egressId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3)
);
CREATE INDEX "video_sessions_organizationId_campaignId_createdAt_idx" ON video_sessions ("organizationId","campaignId","createdAt");
CREATE INDEX "video_sessions_attemptId_state_idx" ON video_sessions ("attemptId",state);
CREATE INDEX "video_sessions_state_expiresAt_idx" ON video_sessions (state,"expiresAt");
