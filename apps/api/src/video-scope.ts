import { db } from "./db";
import { videoConsentVersion } from "../../../packages/core/video-policy";
import type { Membership } from "@prisma/client";

export function videoCampaign(org?: string | null) {
  return org && org === process.env.VIDEO_ORGANIZATION_ID
    ? process.env.VIDEO_CAMPAIGN_ID || null
    : null;
}
export function requiresCamera(org: string, campaign: string) {
  return videoCampaign(org) === campaign;
}
export async function needsVideoConsent(member: Membership | null) {
  if (
    !member ||
    member.role !== "employee" ||
    member.videoConsentVersion === videoConsentVersion
  )
    return false;
  const campaignId = videoCampaign(member.organizationId);
  return (
    !!campaignId &&
    !!(await db.testAssignment.findFirst({
      where: {
        campaignId,
        organizationId: member.organizationId,
        membershipId: member.id,
      },
      select: { id: true },
    }))
  );
}
