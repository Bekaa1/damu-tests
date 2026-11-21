import { beforeEach, describe, expect, it, vi } from "vitest";
import { participantDeletionDate, participantDataExpired, externalAiAllowed } from "../packages/core/data-policy";
import { CONSENT_TEXT, CONSENT_VERSION } from "../packages/core/assessment-policy";
import { consentPolicy, hasCurrentConsent, PILOT_CONSENT_TEXT, PILOT_CONSENT_VERSION, pilotDataExpired } from "../packages/core/pilot";
import { clearExpiredParticipantCache } from "../packages/core/pilot-cache";

// No real database, auth, Redis or storage is permitted in this suite.
const fixture = vi.hoisted(() => {
  const methods = ["findUnique", "findUniqueOrThrow", "findFirst", "findMany", "count", "update", "updateMany", "delete", "deleteMany", "create"];
  const db: any = {};
  for (const name of ["membership", "organization", "user", "testAssignment", "testAttempt", "testResult", "generatedReport", "fileAsset", "aiReport", "finalReport", "expertObservation", "auditLog", "competencyConsensus", "participantGroup", "userAnswer", "frozenNorm", "verification", "session"])
    db[name] = Object.fromEntries(methods.map(method => [method, vi.fn(() => { throw Error(`Unstubbed database call: ${name}.${method}`); })]));
  db.$queryRaw = vi.fn();
  db.$transaction = vi.fn((work: any) => work(db));
  return { db, removeStoredFiles: vi.fn(), auth: vi.fn(), queueAdd: vi.fn(), workerHandlers: {} as Record<string, any> };
});
vi.mock("../apps/api/src/db", () => ({ db: fixture.db, audit: vi.fn(), json: (value: unknown) => value }));
vi.mock("../apps/api/src/storage", () => ({ removeStoredFiles: fixture.removeStoredFiles }));
vi.mock("../apps/api/src/auth", () => ({ auth: { api: { getSession: fixture.auth } } }));
vi.mock("bullmq", () => ({
  Queue: class { on() {} add = fixture.queueAdd; },
  Worker: class { constructor(_name: string, handler: any) { fixture.workerHandlers.generate = handler; } on() {} },
}));
import { AccessGuard, participant, requireRole } from "../apps/api/src/access";
import * as retention from "../apps/api/src/pilot-retention";
import { erasePersonalData } from "../apps/api/src/privacy";
import { generateAi, queueAi, startAiWorker } from "../apps/api/src/ai";

const old = "2026-11-30T10:15:30.123Z", now = new Date("2027-02-28T10:15:30.123Z");
const member = () => ({ id: "subject-member", organizationId: "org-real", userId: "subject-user", role: "employee", status: "active", createdAt: new Date(old), consentAt: now, consentVersion: CONSENT_VERSION,
  organization: { id: "org-real", purpose: "assessment", dataMode: "real", status: "active" }, user: { id: "subject-user", email: "fixture@example.test", name: "Synthetic Subject", platformAdmin: false } });

beforeEach(() => { vi.clearAllMocks(); fixture.removeStoredFiles.mockReset(); vi.useRealTimers(); });

describe("participant data policy", () => {
  it.each([
    ["2026-11-30T10:15:30.123Z", "2027-02-28T10:15:30.123Z"],
    ["2027-11-30T10:15:30Z", "2028-02-29T10:15:30.000Z"],
    ["2026-01-31T10:15:30Z", "2026-04-30T10:15:30.000Z"],
    ["2026-12-31T23:59:59Z", "2027-03-31T23:59:59.000Z"],
    ["2028-02-29T10:15:30Z", "2028-05-29T10:15:30.000Z"],
    ["2026-11-30T12:15:30+02:00", "2027-02-28T10:15:30.000Z"],
  ])("uses UTC calendar months, not 90 days: %s", (input, expected) => {
    const date = new Date(input), original = date.toISOString();
    expect(participantDeletionDate(date).toISOString()).toBe(expected);
    expect(date.toISOString()).toBe(original);
  });
  it("rejects invalid dates", () => expect(() => participantDeletionDate("not-a-date")).toThrow());
  it.each([{ purpose: "assessment", dataMode: "real" }, { purpose: "pilot", dataMode: "real" }, { purpose: "assessment", dataMode: "synthetic" }])("expires exactly at registration deadline for %j", organization => {
    expect(participantDataExpired(member(), organization, new Date(+now - 1))).toBe(false);
    expect(participantDataExpired(member(), organization, now)).toBe(true);
    expect(pilotDataExpired(member(), { purpose: "assessment" }, now)).toBe(false);
  });
  it("does not renew for new consent, login or retake", () => {
    expect(participantDataExpired({ ...member(), consentAt: now, lastLoginAt: now, retakeAt: now } as any, member().organization, now)).toBe(true);
  });
  it.each(["admin", "expert", "superadmin"])("preserves %s staff", role => expect(participantDataExpired({ ...member(), role }, member().organization, now)).toBe(false));
  it("handles absent membership and organization safely", () => {
    expect(participantDataExpired(null, null, now)).toBe(false);
    expect(participantDataExpired(undefined, undefined, now)).toBe(false);
    expect(participantDataExpired(member(), null, now)).toBe(false);
  });
  it.each([null, undefined, {}, { purpose: "assessment", dataMode: "real" }, { purpose: "pilot" }, { purpose: "assessment", dataMode: "synthetic" }])("denies external AI for every organization: %j", organization => {
    vi.stubEnv("ALLOW_EXTERNAL_AI", "true");
    expect(externalAiAllowed(organization)).toBe(false);
    vi.unstubAllEnvs();
  });
  it("versions general consent without changing voluntary pilot rules", () => {
    expect(CONSENT_VERSION).not.toBe("2026-11-17");
    expect(CONSENT_TEXT.ru).toContain("3 календарных месяца");
    expect(CONSENT_TEXT.ru).toContain("регистрации в организации");
    expect(CONSENT_TEXT.ru).toContain("не продлевают");
    expect(CONSENT_TEXT.kk).toContain("3 күнтізбелік ай");
    expect(CONSENT_TEXT.ru).not.toMatch(/может выполняться внешним|до запроса на удаление/i);
    expect(CONSENT_TEXT.kk).not.toMatch(/сыртқы деректер өңдеу қызметі орындай алады|жою туралы өтінішке дейін/i);
    expect(consentPolicy({ purpose: "assessment" })).toEqual({ version: CONSENT_VERSION, text: CONSENT_TEXT });
    expect(consentPolicy({ purpose: "pilot" })).toEqual({ version: PILOT_CONSENT_VERSION, text: PILOT_CONSENT_TEXT });
    expect(PILOT_CONSENT_TEXT.ru).toContain("Участие в пилоте добровольное");
    expect(hasCurrentConsent({ consentAt: now, consentVersion: "2026-11-17" }, { purpose: "assessment" })).toBe(false);
  });
  it("clears real participant offline raw answers and events, preserving other campaigns", () => {
    const values = new Map([
      ["assessflow.offline-session", JSON.stringify({ session: { member: member(), organization: member().organization }, campaigns: [{ id: "expired-campaign" }] })],
      ["assessflow.cached.expired", JSON.stringify({ campaignId: "expired-campaign" })],
      ["assessflow.answers.expired", "synthetic raw answers"], ["assessflow.presence.expired", "synthetic events"],
      ["assessflow.cached.other", JSON.stringify({ campaignId: "other-campaign" })], ["assessflow.answers.other", "keep"],
    ]);
    clearExpiredParticipantCache({ get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: key => values.get(key) ?? null, removeItem: key => { values.delete(key); } }, now);
    expect([...values.keys()]).toEqual(["assessflow.cached.other", "assessflow.answers.other"]);
  });
});

describe("API access and external AI enforcement", () => {
  it.each([false, true])("denies a direct real-org header for a demo-only user, including platform admin=%s", async platformAdmin => {
    const m = member();
    fixture.auth.mockResolvedValue({ user: { id: m.userId } });
    fixture.db.user.findUniqueOrThrow.mockResolvedValue({ ...m.user, demoOnly: true, platformAdmin });
    fixture.db.membership.findFirst.mockResolvedValue({ ...m, createdAt: now });
    fixture.db.organization.findUnique.mockResolvedValue(m.organization);
    vi.useFakeTimers(); vi.setSystemTime(now);
    const req = { method: "GET", path: "/api/me", headers: { "x-organization-id": m.organizationId } };
    await expect(new AccessGuard().canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any)).rejects.toThrow(/демонстрационн/i);
    expect(fixture.db.organization.findUnique).toHaveBeenCalledWith({ where: { id: m.organizationId } });
  });
  it("allows demo-only access only to a synthetic organization", async () => {
    const m = member(), organization = { ...m.organization, dataMode: "synthetic" };
    fixture.auth.mockResolvedValue({ user: { id: m.userId } });
    fixture.db.user.findUniqueOrThrow.mockResolvedValue({ ...m.user, demoOnly: true });
    fixture.db.membership.findFirst.mockResolvedValue({ ...m, createdAt: now });
    fixture.db.organization.findUnique.mockResolvedValue(organization);
    const req = { method: "GET", path: "/api/me", headers: { "x-organization-id": m.organizationId } };
    expect(await new AccessGuard().canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any)).toBe(true);
  });
  it("normalizes demo-only plus platformAdmin to the actual synthetic membership role", async () => {
    const m = member(), organization = { ...m.organization, dataMode: "synthetic" };
    fixture.auth.mockResolvedValue({ user: { id: m.userId } });
    fixture.db.user.findUniqueOrThrow.mockResolvedValue({ ...m.user, demoOnly: true, platformAdmin: true });
    fixture.db.membership.findFirst.mockResolvedValue({ ...m, role: "expert", createdAt: now });
    fixture.db.organization.findUnique.mockResolvedValue(organization);
    const req: any = { method: "GET", path: "/api/me", headers: { "x-organization-id": m.organizationId } };
    expect(await new AccessGuard().canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any)).toBe(true);
    expect(req.ctx.role).toBe("expert");
    expect(() => requireRole(req.ctx, "admin")).toThrow(/прав/);
    expect(() => requireRole(req.ctx, "superadmin")).toThrow(/прав/);
    expect(() => requireRole(req.ctx, "expert")).not.toThrow();
  });
  it.each(["admin", "superadmin"])("does not let a forged demo-only superadmin context bypass %s authorization", required => {
    const ctx = { user: { demoOnly: true, platformAdmin: true }, role: "superadmin", member: { role: "expert" } } as any;
    expect(() => requireRole(ctx, required)).toThrow(/прав/);
  });
  it("requires an actual synthetic membership even if demo-only platformAdmin is true", async () => {
    const m = member();
    fixture.auth.mockResolvedValue({ user: { id: m.userId } });
    fixture.db.user.findUniqueOrThrow.mockResolvedValue({ ...m.user, demoOnly: true, platformAdmin: true });
    fixture.db.membership.findFirst.mockResolvedValue(null);
    fixture.db.organization.findUnique.mockResolvedValue({ ...m.organization, dataMode: "synthetic" });
    const req = { method: "GET", path: "/api/me", headers: { "x-organization-id": m.organizationId } };
    await expect(new AccessGuard().canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any)).rejects.toThrow();
  });
  it("denies participant helper access from a demo-only caller into real scope", async () => {
    fixture.db.membership.findFirst.mockResolvedValue({ ...member(), createdAt: now });
    await expect(participant({ org: member().organization, role: "superadmin", user: { demoOnly: true } } as any, member().id)).rejects.toThrow(/демонстрационн/i);
  });
  it("denies expired participant reads by organization administrators", async () => {
    fixture.db.membership.findFirst.mockResolvedValue(member());
    vi.useFakeTimers(); vi.setSystemTime(now);
    await expect(participant({ org: member().organization, role: "admin" } as any, member().id)).rejects.toThrow(/Срок хранения/);
  });
  it("denies expired assessment users before accepting fresh consent", async () => {
    const m = member();
    fixture.auth.mockResolvedValue({ user: { id: m.userId } });
    fixture.db.user.findUniqueOrThrow.mockResolvedValue(m.user);
    fixture.db.membership.findFirst.mockResolvedValue(m);
    fixture.db.organization.findUnique.mockResolvedValue(m.organization);
    vi.useFakeTimers(); vi.setSystemTime(now);
    const req = { method: "GET", path: "/api/me/consent", headers: {} };
    await expect(new AccessGuard().canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any)).rejects.toThrow(/Срок хранения/);
  });
  it.each([false, true])("manual queue and regeneration deny before reading results (regenerate=%s)", async regenerate => {
    fixture.db.organization.findUnique.mockResolvedValue(member().organization);
    const outcome = await queueAi("org-real", "campaign", "subject-member", regenerate);
    expect(outcome).toMatchObject({ status: "disabled_by_policy", code: "external_ai_disabled" });
    expect(fixture.db.testAssignment.findMany).not.toHaveBeenCalled();
    expect(fixture.queueAdd).not.toHaveBeenCalled();
  });
  it.each([0, 2])("old queued/retry AI fails closed without any fetch (attempt=%s)", async attemptsMade => {
    const fetch = vi.fn(() => { throw Error("External requests forbidden in tests"); });
    vi.stubGlobal("fetch", fetch);
    fixture.db.aiReport.findUniqueOrThrow.mockResolvedValue({ id: "old-report", status: "pending", organizationId: "org-real" });
    fixture.db.aiReport.findUnique.mockResolvedValue({ id: "old-report", status: "pending", organizationId: "org-real" });
    fixture.db.aiReport.update.mockResolvedValue({});
    fixture.db.aiReport.updateMany.mockResolvedValue({ count: 1 });
    fixture.db.organization.findUnique.mockResolvedValue(member().organization);
    startAiWorker();
    await expect(fixture.workerHandlers.generate({ data: { reportId: "old-report" }, attemptsMade, opts: { attempts: 3 } })).resolves.toMatchObject({ status: "disabled_by_policy" });
    expect(fetch).not.toHaveBeenCalled();
    const writes = [...fixture.db.aiReport.update.mock.calls, ...fixture.db.aiReport.updateMany.mock.calls];
    expect(writes.some(([input]: [any]) => input.data.status === "disabled_by_policy" && /отключ/.test(input.data.error))).toBe(true);
    vi.unstubAllGlobals();
  });
});

function prepareErasure(shared = false) {
  const m = member();
  fixture.db.membership.findUnique.mockResolvedValue(m);
  fixture.db.membership.findFirst.mockResolvedValue(m);
  fixture.db.membership.update.mockResolvedValue({ ...m, status: "blocked" });
  fixture.db.membership.updateMany.mockResolvedValue({ count: 1 });
  fixture.db.membership.count.mockResolvedValue(shared ? 1 : 0);
  fixture.db.user.findUniqueOrThrow.mockResolvedValue(m.user);
  fixture.db.user.delete.mockResolvedValue({});
  fixture.db.membership.delete.mockResolvedValue({});
  fixture.db.$queryRaw.mockResolvedValue([]);
  fixture.removeStoredFiles.mockResolvedValue(undefined);
  for (const name of ["testAssignment", "testAttempt", "testResult", "generatedReport", "fileAsset", "aiReport", "finalReport", "expertObservation", "auditLog", "competencyConsensus", "participantGroup", "userAnswer", "frozenNorm", "verification", "session"]) {
    fixture.db[name].findMany.mockResolvedValue([]);
    fixture.db[name].deleteMany.mockResolvedValue({ count: 0 });
    fixture.db[name].updateMany.mockResolvedValue({ count: 0 });
  }
  fixture.db.auditLog.create.mockResolvedValue({});
  return m;
}

describe("generalized erasure execution", () => {
  it("erases real assessment participants with S3 first and identifier-free receipt", async () => {
    const m = prepareErasure();
    expect(await retention.eraseExpiredParticipant(m.id, now)).toBe(true);
    expect(fixture.removeStoredFiles).toHaveBeenCalledWith(m.organizationId, m.id);
    expect(fixture.removeStoredFiles.mock.invocationCallOrder[0]).toBeLessThan(fixture.db.membership.delete.mock.invocationCallOrder[0]);
    expect(fixture.db.auditLog.create).toHaveBeenCalledWith({ data: { organizationId: m.organizationId, action: "participant.retention_erased", detail: { deletedParticipants: 1, policy: "three_calendar_months_from_registration" } } });
  });
  it("blocks and preserves all DB evidence on storage failure, then retries", async () => {
    const m = prepareErasure();
    fixture.removeStoredFiles.mockRejectedValueOnce(Error("Synthetic storage outage"));
    await expect(retention.eraseExpiredParticipant(m.id, now)).rejects.toThrow("Synthetic storage outage");
    expect(fixture.db.membership.updateMany.mock.calls.some(([arg]: [any]) => arg.data.status === "blocked")).toBe(true);
    expect(fixture.db.membership.delete).not.toHaveBeenCalled();
    expect(fixture.db.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(await retention.eraseExpiredParticipant(m.id, now)).toBe(true);
  });
  it("keeps shared user auth and verification records for other organizations", async () => {
    const m = prepareErasure(true);
    expect(await retention.eraseExpiredParticipant(m.id, now)).toBe(true);
    expect(fixture.db.user.delete).not.toHaveBeenCalled();
    expect(fixture.db.session.deleteMany).not.toHaveBeenCalled();
    expect(fixture.db.verification.deleteMany).not.toHaveBeenCalled();
    for (const name of ["testAssignment", "testAttempt", "testResult", "generatedReport", "fileAsset", "aiReport", "finalReport", "expertObservation", "competencyConsensus", "participantGroup", "userAnswer", "frozenNorm"])
      for (const [input] of fixture.db[name].deleteMany.mock.calls) expect(input.where.organizationId).toBe(m.organizationId);
  });
  it.each(["admin", "expert", "platform-admin"])("does not erase protected %s", async role => {
    const m = prepareErasure();
    if (role === "platform-admin") m.user.platformAdmin = true; else m.role = role;
    expect(await retention.eraseExpiredParticipant(m.id, now)).toBe(false);
    expect(fixture.removeStoredFiles).not.toHaveBeenCalled();
  });
  it("removes legacy report snapshots, file references and PII audits in this tenant", async () => {
    const m = prepareErasure();
    fixture.db.fileAsset.findMany.mockResolvedValue([{ id: "private-file", storageKey: "org-real/subject-member/key", name: "synthetic.txt" }]);
    fixture.db.generatedReport.findMany.mockResolvedValue([{ id: "legacy-team", campaignId: "old-campaign", membershipId: null, participantIds: [], snapshot: { participants: [{ id: m.id }] } }]);
    fixture.db.auditLog.findMany.mockResolvedValue([{ id: "name-only", organizationId: m.organizationId, detail: { name: m.user.name } }, { id: "file-only", organizationId: m.organizationId, detail: { asset: "private-file" } }, { id: "unrelated", organizationId: m.organizationId, detail: { name: "Other Fixture" } }]);
    expect(await retention.eraseExpiredParticipant(m.id, now)).toBe(true);
    expect(fixture.db.generatedReport.deleteMany).toHaveBeenCalledWith({ where: { organizationId: m.organizationId, id: { in: ["legacy-team"] } } });
    expect(fixture.db.auditLog.deleteMany.mock.calls.some(([input]: [any]) => JSON.stringify(input.where.id) === JSON.stringify({ in: ["name-only", "file-only"] }))).toBe(true);
  });
  it("removes same-tenant final/AI reports that reference erased results or files, not just direct ownership", async () => {
    const m = prepareErasure();
    fixture.db.fileAsset.findMany.mockResolvedValue([{ id: "private-file", storageKey: "org-real/subject-member/key" }]);
    fixture.db.aiReport.findMany.mockResolvedValue([{ id: "linked-ai", campaignId: "campaign", membershipId: "other-subject", resultIds: ["private-result"] }]);
    fixture.db.testResult.findMany.mockResolvedValue([{ id: "private-result" }]);
    fixture.db.finalReport.findMany.mockResolvedValue([{ id: "linked-final", campaignId: "campaign", membershipId: "other-subject", aiReportId: "linked-ai", content: { asset: "private-file" } }]);
    expect(await retention.eraseExpiredParticipant(m.id, now)).toBe(true);
    expect(fixture.db.aiReport.findMany).toHaveBeenCalledWith({ where: { organizationId: m.organizationId } });
    expect(fixture.db.finalReport.findMany).toHaveBeenCalledWith({ where: { organizationId: m.organizationId } });
    expect(fixture.db.aiReport.deleteMany).toHaveBeenCalledWith({ where: { organizationId: m.organizationId, id: { in: ["linked-ai"] } } });
    expect(fixture.db.finalReport.deleteMany).toHaveBeenCalledWith({ where: { organizationId: m.organizationId, id: { in: ["linked-final"] } } });
  });
  it("manual erasure shares complete erasure and does not revoke another tenant's session", async () => {
    const m = prepareErasure(true);
    // Administrative reads are valid before expiry.
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
    expect(await erasePersonalData({ org: m.organization, role: "admin", user: { id: "admin-user" } } as any, m.id, { confirmEmail: m.user.email })).toEqual({ ok: true });
    expect(fixture.db.session.deleteMany).not.toHaveBeenCalled();
    expect(fixture.db.competencyConsensus.deleteMany).toHaveBeenCalled();
    expect(fixture.db.participantGroup.deleteMany).toHaveBeenCalled();
  });
  it("pilot erasure wrapper stays pilot-only", async () => {
    const m = prepareErasure();
    expect(await retention.eraseExpiredPilotParticipant(m.id, now)).toBe(false);
    expect(fixture.removeStoredFiles).not.toHaveBeenCalled();
  });
  it("does not let a failed first batch starve later expired participants", async () => {
    prepareErasure();
    const batch = Array.from({ length: 500 }, (_, i) => ({ id: `candidate-${i}`, createdAt: new Date(old) }));
    fixture.db.membership.findMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);
    fixture.db.membership.findUnique.mockResolvedValue(null);
    await retention.sweepParticipantRetention(now);
    expect(fixture.db.membership.findMany).toHaveBeenCalledTimes(2);
    expect(fixture.db.membership.findMany.mock.calls[1][0].where.OR).toEqual([
      { createdAt: { gt: new Date(old) } }, { createdAt: new Date(old), id: { gt: "candidate-499" } },
    ]);
  });
  it("general sweep scopes every employee regardless of organization purpose", async () => {
    prepareErasure(); fixture.db.membership.findMany.mockResolvedValue([]);
    expect(await retention.sweepParticipantRetention(now)).toEqual({ deleted: 0, failed: 0 });
    const filter = fixture.db.membership.findMany.mock.calls[0][0].where;
    expect(filter.role).toBe("employee"); expect(filter.user.platformAdmin).toBe(false);
    expect(filter.organization?.purpose).toBeUndefined();
  });
});
