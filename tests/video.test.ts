import { mkdtemp, mkdir, writeFile, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { recordingPath, removeRecordingFiles } from "../apps/api/src/video-mp4";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EgressClient, EgressStatus, RoomServiceClient } from "livekit-server-sdk";
import {
  adminSessions,
  reconcileVideos,
  recordingFile,
  requireRecording,
} from "../apps/api/src/video";
import type { Context } from "../apps/api/src/access";
import { videoExpiry } from "../packages/core/video-policy";
import { requiresCamera } from "../apps/api/src/video-scope";
import { db } from "../apps/api/src/db";

vi.mock("../apps/api/src/db", () => ({
  db: {
    videoSession: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
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
it("erases source, MP4 and interrupted conversion files together, preserving other sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "assessflow-mp4-"));
  vi.stubEnv("VIDEO_RECORDINGS_DIR", directory);
  const id = randomUUID();
  const other = randomUUID();
  try {
    await mkdir(recordingPath(id, ".work"));
    await Promise.all([
      writeFile(recordingPath(id, ".webm"), "capture"),
      writeFile(recordingPath(id, ".mp4"), "archive"),
      writeFile(
        join(recordingPath(id, ".work"), "unfinished.mp4"),
        "temporary",
      ),
      writeFile(recordingPath(other, ".mp4"), "another recording"),
    ]);
    await removeRecordingFiles(id);
    await removeRecordingFiles(id);
    expect(await readdir(directory)).toEqual([other + ".mp4"]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
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
      await expect(
        recordingFile(user(role), "id", "play"),
      ).rejects.toMatchObject({ status: 403 });
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

it("publishes completed native MP4 files only after all reported bytes are accessible", async () => {
  const directory = await mkdtemp(join(tmpdir(), "assessflow-native-"));
  vi.stubEnv("VIDEO_RECORDINGS_DIR", directory);
  vi.stubEnv("LIVEKIT_API_KEY", "test");
  vi.stubEnv("LIVEKIT_API_SECRET", "test-only-credential");
  vi.stubEnv("LIVEKIT_URL", "http://localhost:7880");
  vi.stubEnv("LIVEKIT_PUBLIC_URL", "ws://localhost:7880");
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const sessions = ids.map(id => ({
    id, egressId: id, state: "closing", createdAt: new Date(), attempt: { status: "completed" },
  }));
  const list = vi.spyOn(EgressClient.prototype, "listEgress")
    .mockImplementation(async (options?: string | { egressId?: string }) => {
      if (typeof options !== "object" || !options.egressId) throw new Error("Expected an egress ID");
      return [{
        egressId: options.egressId,
        status: EgressStatus.EGRESS_COMPLETE,
        endedAt: BigInt(Date.now()) * 1000000n,
        fileResults: [{ filename: "/out/live/" + options.egressId + ".mp4", size: 5n }],
      }] as never;
    });
  const close = vi.spyOn(RoomServiceClient.prototype, "deleteRoom").mockResolvedValue(undefined);
  try {
    await writeFile(recordingPath(ids[0], ".mp4"), "12345");
    await writeFile(recordingPath(ids[1], ".mp4"), "123");
    vi.mocked(db.videoSession.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce(sessions as never);
    await reconcileVideos();
    expect(db.videoSession.updateMany).toHaveBeenCalledTimes(1);
    expect(db.videoSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ids[0], state: "closing" },
      data: expect.objectContaining({ state: "ready", expiresAt: expect.any(Date) }),
    }));
  } finally {
    list.mockRestore(); close.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

it("recovers a finalized file after a late ENDING event and waits for incomplete files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "assessflow-egress-"));
  vi.stubEnv("VIDEO_RECORDINGS_DIR", directory);
  vi.stubEnv("LIVEKIT_API_KEY", "test");
  vi.stubEnv("LIVEKIT_API_SECRET", "test-only-credential");
  vi.stubEnv("LIVEKIT_URL", "http://localhost:7880");
  vi.stubEnv("LIVEKIT_PUBLIC_URL", "ws://localhost:7880");
  const [finished, partial, recent] = [randomUUID(), randomUUID(), randomUUID()];
  const end = new Date(Date.now() - 120_000);
  const list = vi.spyOn(EgressClient.prototype, "listEgress").mockResolvedValue([
    {
      status: EgressStatus.EGRESS_ENDING,
      endedAt: 0n,
      egressId: "test-job",
      fileResults: [{ size: 5n }],
    } as never,
  ]);
  const close = vi.spyOn(RoomServiceClient.prototype, "deleteRoom")
    .mockResolvedValue(undefined);
  try {
    await writeFile(recordingPath(finished, ".webm"), "12345");
    await writeFile(recordingPath(partial, ".webm"), "123");
    await writeFile(recordingPath(recent, ".webm"), "12345");
    for (const id of [finished, partial]) {
      await utimes(recordingPath(id, ".webm"), end, end);
    }
    const sessions = [finished, partial, recent].map((id) => ({
      id,
      egressId: id,
      state: "closing",
      createdAt: end,
      attempt: { status: "completed" },
    }));
    vi.mocked(db.videoSession.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(sessions as never);
    await reconcileVideos();
    expect(db.videoSession.updateMany).toHaveBeenCalledTimes(1);
    expect(db.videoSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: finished, state: "closing" },
      data: expect.objectContaining({ state: "processing", expiresAt: expect.any(Date) }),
    }));
  } finally {
    list.mockRestore();
    close.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
