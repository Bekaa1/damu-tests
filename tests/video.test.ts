import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminSessions,
  recordingFile,
  requireRecording,
} from "../apps/api/src/video";
import type { Context } from "../apps/api/src/access";
import { videoExpiry } from "../packages/core/video-policy";
import { requiresCamera } from "../apps/api/src/video-scope";
import { db } from "../apps/api/src/db";

vi.mock("../apps/api/src/db", () => ({
  db: { videoSession: { findFirst: vi.fn(), findMany: vi.fn() } },
  audit: vi.fn(),
}));
function user(role: string, org = "fund"): Context {
  return {
    role,
    member: { id: "member", role, organizationId: org },
    org: { id: org },
    user: { id: "user" },
  } as Context;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it.each([
  ["2026-11-30T15:32:10.000Z", "2027-02-28T15:32:10.000Z"],
  ["2027-11-30T15:32:10.000Z", "2028-02-29T15:32:10.000Z"],
  ["2026-12-01T10:00:00.000Z", "2027-03-01T10:00:00.000Z"],
])("keeps a recording for three calendar months from %s", (end, expiry) => {
  expect(videoExpiry(new Date(end)).toISOString()).toBe(expiry);
});
describe("private video access", () => {
  it("requires the configured organisation and campaign", () => {
    vi.stubEnv("VIDEO_ORGANIZATION_ID", "fund");
    vi.stubEnv("VIDEO_CAMPAIGN_ID", "campaign");
    expect(requiresCamera("fund", "campaign")).toBe(true);
    expect(requiresCamera("fund", "pilot")).toBe(false);
    expect(requiresCamera("other", "campaign")).toBe(false);
  });
  it.each(["employee", "expert", "superadmin"])(
    "denies archived files and live listings to %s",
    async (role) => {
      vi.stubEnv("VIDEO_ORGANIZATION_ID", "fund");
      vi.stubEnv("VIDEO_CAMPAIGN_ID", "campaign");
      await expect(recordingFile(user(role), "id")).rejects.toMatchObject({
        status: 403,
      });
      await expect(adminSessions(user(role), "campaign")).rejects.toMatchObject(
        { status: 403 },
      );
      expect(db.videoSession.findFirst).not.toHaveBeenCalled();
    },
  );
  it("rejects expired files immediately, including before physical cleanup", async () => {
    vi.stubEnv("VIDEO_ORGANIZATION_ID", "fund");
    vi.stubEnv("VIDEO_CAMPAIGN_ID", "campaign");
    vi.mocked(db.videoSession.findFirst).mockResolvedValue({
      state: "ready",
      expiresAt: new Date(0),
    } as never);
    await expect(recordingFile(user("admin"), "id")).rejects.toMatchObject({
      status: 404,
    });
    expect(db.videoSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "id",
          organizationId: "fund",
          campaignId: "campaign",
          attemptId: { not: null },
        },
      }),
    );
    await expect(
      recordingFile(user("admin", "other"), "id"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("prevents starting a protected attempt without a verified recording", async () => {
    await expect(
      requireRecording(user("employee"), "attempt"),
    ).rejects.toMatchObject({ status: 409 });
  });
});
