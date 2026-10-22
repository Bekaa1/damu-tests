ALTER TABLE "ai_reports" ADD COLUMN "prompt" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ai_reports" ADD COLUMN "providerConfig" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "platform_settings" ADD COLUMN "encryptedApiKey" TEXT;
