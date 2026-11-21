import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Actual handlers, access policy, participant fence, audit helper and eraser.
// Only Prisma/auth/storage transports are modeled; no live service is usable.
const m = vi.hoisted(() => {
  const unexpected = (name: string) => vi.fn<(...args: any[]) => Promise<any>>(async () => { throw Error(`Unstubbed ${name}`); });
  const names = ["membership", "user", "testAssignment", "testAttempt", "testResult", "expertObservation", "assessmentExercise", "aiReport", "finalReport", "auditLog", "fileAsset", "generatedReport", "participantGroup", "competencyConsensus", "userAnswer", "frozenNorm", "verification"];
  const methods = ["findFirst", "findUnique", "findUniqueOrThrow", "findMany", "count", "create", "updateMany", "deleteMany", "delete"];
  return {
    names, methods,
    db: Object.fromEntries(names.map(name => [name, Object.fromEntries(methods.map(method => [method, unexpected(`${name}.${method}`)]))])) as Record<string, any>,
    transaction: unexpected("transaction"), storage: unexpected("storage"),
  };
});
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor() { return { ...m.db, $transaction: m.transaction }; } } }));
vi.mock("../apps/api/src/auth", () => ({ auth: { api: { getSession: () => { throw Error("Auth transport forbidden"); } } } }));
vi.mock("../apps/api/src/storage", () => ({ removeStoredFiles: m.storage }));
import { getReport, saveObservation, saveReport } from "../apps/api/src/assessment";
import { eraseParticipantData } from "../apps/api/src/pilot-retention";
import type { Context } from "../apps/api/src/access";

const now = new Date("2026-11-21T12:00:00Z");
const organization = { id: "org", purpose: "assessment", dataMode: "real", status: "active" };
const admin = { org: organization, user: { id: "admin-user" }, member: { id: "admin-member" }, role: "admin" } as unknown as Context;
const expert = { ...admin, user: { id: "expert-user" }, member: { id: "expert-member" }, role: "expert" } as unknown as Context;
const platform = { ...admin, user: { id: "platform-user", platformAdmin: true }, member: null, role: "superadmin" } as unknown as Context;
const observationInput = { campaignId: "campaign", membershipId: "subject", exerciseId: "exercise", scores: { "C2.1": 3 }, indicatorExamples: { "C2.1": "Synthetic behavior only." }, notes: "Synthetic regression observation only." };
const reportInput = {
  campaignId: "campaign", membershipId: "subject",
  content: { conclusion: "Synthetic regression conclusion only.", strengths: "Synthetic strengths.", development: "Synthetic development.", risks: "Synthetic risks.", recommendations: "Synthetic recommendations.", developmentPlan: [{ goal: "Synthetic goal", action: "Synthetic action", deadline: "Synthetic deadline", success: "Synthetic outcome" }] },
  matrixX: 2, matrixY: 3, matrixReason: "Synthetic matrix regression reason only.", approve: false,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function matches(row: any, where: any = {}): boolean {
  return Boolean(row) && Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === "OR") return value.some((branch: any) => matches(row, branch));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("in" in value) return value.in.includes(row[key]);
      if ("has" in value) return row[key]?.includes(value.has);
      return matches(row[key], value);
    }
    return row[key] === value;
  });
}
function project(row: any, args: any = {}): any {
  if (!row) return null;
  if (Array.isArray(row)) return row.map(item => project(item, args));
  if (args.select) return Object.fromEntries(Object.entries(args.select).filter(([, value]) => value).map(([key, value]) => [key, typeof value === "object" ? project(row[key], value) : structuredClone(row[key])]));
  const value = structuredClone(row);
  for (const relation of ["user", "organization"])
    if (!args.include?.[relation]) delete value[relation];
  for (const [key, include] of Object.entries(args.include ?? {}))
    if (include && typeof include === "object") value[key] = project(row[key], include);
  return value;
}
function harness() {
  const rows: Record<string, any[]> = Object.fromEntries(m.names.map(name => [name, []]));
  const subjectUser = { id: "subject-user", name: "Synthetic private person", email: "subject@example.test", locale: "ru", platformAdmin: false };
  const assessorUser = { id: "expert-user", name: "Historical assessor", platformAdmin: false };
  const authorUser = { id: "author-user", name: "Historical author" };
  const subject = { id: "subject", userId: subjectUser.id, organizationId: "org", role: "employee", status: "active", createdAt: now, user: subjectUser, organization };
  rows.membership.push(subject, { id: "expert-member", userId: assessorUser.id, organizationId: "org", role: "expert", status: "active", user: assessorUser, organization },
    // Tenant erasure may leave the globally shared account in another tenant.
    { ...subject, id: "shared-member", organizationId: "other-org" });
  rows.user.push(subjectUser, assessorUser, authorUser);
  rows.assessmentExercise.push({ id: "exercise", organizationId: "org", active: true, type: "interview", name: { ru: "Synthetic historical exercise" }, criteria: [{ id: "C2.1", competencyId: "C2", allowNotObserved: true, scale: [{ value: 3 }] }] });
  rows.testAssignment.push({ id: "assignment", organizationId: "org", campaignId: "campaign", membershipId: "subject", expertId: "expert-member", assessorIds: [], attempts: [{ id: "attempt", status: "completed", results: [{ id: "result-new" }] }] });
  rows.testAttempt.push({ id: "attempt", organizationId: "org", assignmentId: "assignment" });
  for (const [id, score] of [["result-old", 3], ["result-new", 4]] as const)
    rows.testResult.push({ id, organizationId: "org", attemptId: "attempt", result: { score, frozenModel: "legacy-four-role-model", scoringKeyVersion: 1 }, attempt: { assignment: { testVersion: { version: 1, test: { name: { ru: "Historical test" } } } } } });
  for (const [id, version] of [["observation-v1", 1], ["observation-v2", 2]] as const)
    rows.expertObservation.push({ id, organizationId: "org", campaignId: "campaign", membershipId: "subject", exerciseId: "exercise", expertId: "expert-member", version, createdAt: new Date(`2026-11-${19 + version}T10:00:00Z`), criteriaSnapshot: { type: "interview", historicalIndicator: "literal legacy indicator" }, scores: { legacy: version }, notes: "Synthetic saved observation." });
  rows.expertObservation.push({ id: "platform-observation", organizationId: "org", campaignId: "campaign", membershipId: "subject", expertId: "author-user", exerciseId: "other-exercise", version: 1, createdAt: new Date("2026-11-18T10:00:00Z"), criteriaSnapshot: { type: "case" }, scores: { legacy: null } });
  rows.aiReport.push({ id: "ai-old", organizationId: "org", campaignId: "campaign", membershipId: "subject", status: "completed", createdAt: now, content: "Synthetic frozen AI history, not a provider call." });
  rows.finalReport.push({ id: "legacy-report", organizationId: "org", campaignId: "campaign", membershipId: "subject", authorId: "author-user", version: 7, status: "approved", content: { conclusion: "Synthetic private frozen conclusion." }, resultIds: ["result-old"], observationIds: ["observation-v1", "platform-observation"], aiReportId: "ai-old", matrixX: 1, matrixY: 2 });
  const state = {
    rows, events: [] as string[], clients: [] as any[], held: false,
    initialStarted: deferred(), initialGate: undefined as ReturnType<typeof deferred> | undefined,
    authorStarted: deferred(), authorGate: undefined as ReturnType<typeof deferred> | undefined,
    auditStarted: deferred(), auditGate: undefined as ReturnType<typeof deferred> | undefined,
    beforeTransaction: undefined as (() => void) | undefined,
    eraseAfterCommit: false, failAudit: false, failCommit: false,
    committedWrite: undefined as { row: any; audits: any[] } | undefined,
  };
  let tail = Promise.resolve(), serial = 0;
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = tail, release = deferred(); tail = previous.then(() => release.promise);
    await previous;
    try { return await operation(); } finally { release.resolve(); }
  }
  function model(name: string, source: Record<string, any[]>, prefix: string) {
    return Object.fromEntries(m.methods.map(method => [method, vi.fn(async (args: any = {}) => {
      state.events.push(`${prefix}:${name}.${method}`);
      let selected = source[name].filter(row => matches(row, args.where));
      const order = args.orderBy && !Array.isArray(args.orderBy) ? Object.entries(args.orderBy)[0] : undefined;
      if (order) {
        const [key, direction] = order;
        selected = [...selected].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (direction === "desc" ? -1 : 1));
      }
      if (["findFirst", "findUnique", "findUniqueOrThrow", "findMany", "count"].includes(method)) {
        if (method === "count") return selected.length;
        const value = method === "findMany" ? selected.map(row => project(row, args)) : project(selected[0], args);
        if (method === "findUniqueOrThrow" && !value) throw Error(`${name} missing`);
        if (prefix === "root" && name === "membership" && method === "findFirst") {
          state.initialStarted.resolve(); if (state.initialGate) await state.initialGate.promise;
        }
        if (name === "user" && method === "findUnique" && args.where.id === "author-user") {
          state.authorStarted.resolve(); if (state.authorGate) await state.authorGate.promise;
        }
        return value;
      }
      if (method === "create") {
        if (name === "auditLog") {
          state.events.push(`${prefix}:audit:${args.data.action}`);
          if (state.failAudit && args.data.action !== "personal_data.erased") throw Error("Audit failed");
          if (args.data.action !== "personal_data.erased") {
            state.auditStarted.resolve(); if (state.auditGate) await state.auditGate.promise;
          }
        }
        const row = { id: `${name}-new-${++serial}`, ...structuredClone(args.data) };
        source[name].push(row); return structuredClone(row);
      }
      if (method === "updateMany") {
        for (const row of selected) Object.assign(row, structuredClone(args.data));
        return { count: selected.length };
      }
      if (method === "delete" || method === "deleteMany") {
        source[name] = source[name].filter(row => !selected.includes(row));
        return method === "deleteMany" ? { count: selected.length } : project(selected[0]);
      }
      throw Error(`Unhandled ${name}.${method}`);
    })]));
  }
  for (const name of m.names) {
    const root = model(name, rows, "root");
    for (const method of m.methods) m.db[name][method].mockImplementation(root[method]);
  }
  // PostgreSQL UPDATE must wait behind the reader/writer's participant locks.
  const updateMember = model("membership", rows, "root").updateMany;
  m.db.membership.updateMany.mockImplementation(async (args: any) => {
    state.events.push("erase:block-requested");
    return exclusive(async () => updateMember(args));
  });
  m.storage.mockImplementation(async () => { state.events.push("storage:empty"); });
  m.transaction.mockImplementation(async (operation: any) => {
    const value = await exclusive(async () => {
      state.beforeTransaction?.(); state.beforeTransaction = undefined;
      const pending = structuredClone(rows);
      const tx = Object.fromEntries(m.names.map(name => [name, model(name, pending, "tx")])) as any;
      tx.$queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: string[]) => {
        const table = strings.join("").includes("FROM users") ? "user" : "membership";
        state.events.push(`lock:${table}:${values[0]}`);
        return pending[table].some(row => row.id === values[0] && (table === "user" || row.organizationId === values[1])) ? [{ id: values[0] }] : [];
      });
      state.clients.push(tx); state.events.push("tx:begin"); state.held = true;
      try {
        const result = await operation(tx);
        if (state.failCommit) throw Error("Commit failed");
        for (const name of m.names) rows[name] = pending[name];
        const write = ["expertObservation", "finalReport"].flatMap(name => rows[name]).find(row => row.id.includes("-new-"));
        if (write && state.eraseAfterCommit) state.committedWrite = { row: structuredClone(write), audits: structuredClone(rows.auditLog) };
        state.events.push("tx:commit"); return result;
      } catch (error) { state.events.push("tx:rollback"); throw error; }
      finally { state.held = false; }
    });
    if (state.eraseAfterCommit && state.committedWrite) {
      state.eraseAfterCommit = false;
      state.events.push("erase:after-writer-commit");
      expect(await eraseParticipantData("org", "subject", now)).toBe(true);
      state.events.push("erase:committed");
    }
    return value;
  });
  return state;
}
let state: ReturnType<typeof harness>;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubGlobal("fetch", () => { throw Error("Network forbidden"); }); state = harness();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const viewingAudits = () => state.rows.auditLog.filter(row => row.action === "report.viewed");
const writeAudits = () => state.rows.auditLog.filter(row => ["observation.saved", "report.saved", "report.approved"].includes(row.action));
const subjectWrites = () => [...state.rows.expertObservation, ...state.rows.finalReport].filter(row => row.id.includes("-new-"));
async function erase() {
  state.events.push("erase:requested");
  const result = await eraseParticipantData("org", "subject", now);
  state.events.push("erase:committed"); return result;
}
async function flush() { for (let n = 0; n < 12; n++) await Promise.resolve(); }

// Q-B2: the legacy route is independent of generated-report and details reads.
describe("legacy getReport final disclosure", () => {
  it("rejects after actual erasure wins initial discovery, without private payload or resurrected receipt", async () => {
    state.initialGate = deferred();
    const reading = getReport(admin, "legacy-report").then(value => ({ value }), error => ({ error }));
    await state.initialStarted.promise;
    expect(await erase()).toBe(true);
    state.initialGate.resolve(); const outcome = await reading;
    expect.soft(outcome).toHaveProperty("error");
    expect.soft(viewingAudits()).toEqual([]);
    expect(state.rows.membership.some(row => row.id === "subject")).toBe(false);
    expect(state.rows.finalReport).toEqual([]);
  });
  it("keeps erasure waiting through author payload preparation and receipt commit when the reader wins", async () => {
    state.authorGate = deferred();
    const reading = getReport(admin, "legacy-report");
    await state.authorStarted.promise;
    // Record the reader's ownership BEFORE erasure can acquire a lock itself.
    const readerHeldFence = state.held;
    const erasing = erase(); await flush();
    expect.soft(readerHeldFence).toBe(true);
    expect.soft(state.events).not.toContain("erase:committed");
    // On RED, make the unsafe schedule deterministic: erase fully before the
    // unfenced author read resumes, exactly as the reviewed reachable trace.
    if (!readerHeldFence) await erasing;
    state.authorGate.resolve();
    expect((await reading).member.user.name).toBe("Synthetic private person");
    expect(await erasing).toBe(true);
    expect.soft(viewingAudits()).toEqual([]);
    expect(state.events.indexOf("tx:audit:report.viewed")).toBeGreaterThanOrEqual(0);
    expect(state.events.indexOf("tx:audit:report.viewed")).toBeLessThan(state.events.indexOf("tx:commit"));
    expect(state.events.indexOf("tx:commit")).toBeLessThan(state.events.indexOf("erase:committed"));
    expect(viewingAudits()).toEqual([]);
  });
  it("uses discovery-only scope and returns the exact historical sources and original author fields through tx", async () => {
    const result = await getReport(admin, "legacy-report");
    expect(result.report.version).toBe(7);
    expect(result.report.content).toEqual({ conclusion: "Synthetic private frozen conclusion." });
    expect(result.results.map(row => row.id)).toEqual(["result-old"]);
    expect(result.results[0].result).toEqual({ score: 3, frozenModel: "legacy-four-role-model", scoringKeyVersion: 1 });
    expect(result.observations.map(row => [row.id, row.expertName, row.scores])).toEqual([
      ["observation-v1", "Historical assessor", { legacy: 1 }], ["platform-observation", "Historical author", { legacy: null }],
    ]);
    expect(result.ai?.id).toBe("ai-old"); expect(result.author).toEqual({ name: "Historical author" });
    expect(m.db.finalReport.findFirst).toHaveBeenCalledWith({ where: { id: "legacy-report", organizationId: "org" }, select: { membershipId: true, campaignId: true } });
    expect(state.clients[0].finalReport.findFirst).toHaveBeenCalledWith({ where: { id: "legacy-report", organizationId: "org", membershipId: "subject", campaignId: "campaign" } });
    expect(state.events.filter(event => event.startsWith("root:"))).toEqual(["root:finalReport.findFirst", "root:membership.findFirst"]);
    expect(viewingAudits()).toHaveLength(1);
  });
  it.each(["campaignId", "membershipId", "organizationId"])("rejects a report whose %s changed after scope discovery", async field => {
    state.beforeTransaction = () => { state.rows.finalReport[0][field] = "different-scope"; };
    await expect(getReport(admin, "legacy-report")).rejects.toThrow();
    expect(viewingAudits()).toEqual([]);
  });
  it.each(["failAudit", "failCommit"] as const)("does not disclose on %s", async failure => {
    state[failure] = true;
    await expect(getReport(admin, "legacy-report")).rejects.toThrow(failure === "failAudit" ? "Audit failed" : "Commit failed");
    expect(viewingAudits()).toEqual([]);
  });
  it("denies a revoked same-campaign expert even if another campaign still assigns that expert", async () => {
    state.beforeTransaction = revokeAssignment;
    await expect(getReport(expert, "legacy-report")).rejects.toThrow(/назначен/i);
    expect(viewingAudits()).toEqual([]); expectFreshAssignmentPredicate();
  });
  it.each([admin, expert, platform])("preserves authorized $role report access", async ctx => {
    await expect(getReport(ctx, "legacy-report")).resolves.toHaveProperty("report.id", "legacy-report");
  });
  it.each(["employee", "foreign-org", "demo"])("preserves %s denial before final disclosure", async condition => {
    const ctx: any = condition === "employee" ? { ...admin, role: "employee" }
      : condition === "foreign-org" ? { ...admin, org: { id: "foreign-org" } }
      : { ...platform, user: { ...platform.user, demoOnly: true } };
    await expect(getReport(ctx, "legacy-report")).rejects.toThrow();
    expect(viewingAudits()).toEqual([]); expect(m.transaction).not.toHaveBeenCalled();
  });
});
function revokeAssignment() {
  state.events.push("assignment:revoked-before-final-fence");
  state.rows.testAssignment[0].expertId = "replacement"; state.rows.testAssignment[0].assessorIds = ["replacement"];
  state.rows.testAssignment.push({ ...state.rows.testAssignment[0], id: "other-campaign-task", campaignId: "other-campaign", expertId: "expert-member" });
}
function expectFreshAssignmentPredicate() {
  expect(state.clients[0].testAssignment.count).toHaveBeenCalledWith({ where: {
    organizationId: "org", membershipId: "subject", campaignId: "campaign",
    OR: [{ expertId: "expert-member" }, { assessorIds: { has: "expert-member" } }],
  } });
}
const writers = [
  { name: "observation", action: "observation.saved", run: (ctx = expert) => saveObservation(ctx, observationInput) },
  { name: "final report", action: "report.saved", run: (ctx = expert) => saveReport(ctx, reportInput) },
  { name: "approved final report", action: "report.approved", run: (ctx = expert) => saveReport(ctx, { ...reportInput, approve: true }) },
];
describe.each(writers)("$name atomic expert writer", writer => {
  it("commits the primary row and its receipt together, so actual erasure immediately after commit removes both", async () => {
    state.eraseAfterCommit = true;
    const saved = await writer.run();
    expect.soft(state.committedWrite?.audits).toEqual([expect.objectContaining({ organizationId: "org", actorId: "expert-user", action: writer.action, entityId: saved.id })]);
    expect.soft(subjectWrites()).toEqual([]); expect.soft(writeAudits()).toEqual([]);
    expect(state.events).not.toContain(`root:audit:${writer.action}`);
    expect(state.events.indexOf(`tx:audit:${writer.action}`)).toBeLessThan(state.events.indexOf("tx:commit"));
    expect(state.events.indexOf("tx:commit")).toBeLessThan(state.events.indexOf("erase:after-writer-commit"));
  });
  it("retains the participant lock while receipt persistence is pending", async () => {
    state.auditGate = deferred();
    const writing = writer.run(); await state.auditStarted.promise;
    const writerHeldFence = state.held;
    const erasing = erase(); await flush();
    expect.soft(writerHeldFence).toBe(true); expect.soft(state.events).not.toContain("erase:committed");
    if (!writerHeldFence) await erasing;
    state.auditGate.resolve(); await writing; await erasing;
    expect(writeAudits()).toEqual([]); expect(subjectWrites()).toEqual([]);
  });
  it.each(["failAudit", "failCommit"] as const)("rejects and rolls back both primary and receipt on %s", async failure => {
    state[failure] = true;
    await expect(writer.run()).rejects.toThrow(failure === "failAudit" ? "Audit failed" : "Commit failed");
    expect(subjectWrites()).toEqual([]); expect(writeAudits()).toEqual([]);
  });
  it("denies campaign authorization revoked between discovery and final fence, with no write or receipt", async () => {
    state.beforeTransaction = revokeAssignment;
    await expect(writer.run()).rejects.toThrow(/назначен/i);
    expect(subjectWrites()).toEqual([]); expect(writeAudits()).toEqual([]); expectFreshAssignmentPredicate();
  });
  it.each(["expertId", "assessorIds"])("allows a currently assigned expert through %s and keeps append-only history", async assignment => {
    if (assignment === "assessorIds") { state.rows.testAssignment[0].expertId = "another-expert"; state.rows.testAssignment[0].assessorIds = ["expert-member"]; }
    const original = structuredClone({ reports: state.rows.finalReport, observations: state.rows.expertObservation, results: state.rows.testResult });
    const saved: any = await writer.run();
    expectFreshAssignmentPredicate();
    expect(state.events.filter(event => event.startsWith("lock:"))).toEqual(["lock:user:subject-user", "lock:membership:subject"]);
    expect(writeAudits()).toEqual([expect.objectContaining({ action: writer.action, entityId: saved.id })]);
    expect(state.rows.testResult).toEqual(original.results);
    expect(state.rows.finalReport.filter(row => row.id === "legacy-report")).toEqual(original.reports);
    expect(state.rows.expertObservation.filter(row => !row.id.includes("-new-"))).toEqual(original.observations);
    if (writer.name === "observation") {
      expect(saved.version).toBe(3); expect(saved.scores).toEqual({ "C2.1": 3 });
      expect(saved.criteriaSnapshot.criteria).toEqual(state.rows.assessmentExercise[0].criteria);
    } else {
      expect(saved.version).toBe(8); expect(saved.authorId).toBe("expert-user");
      expect(saved.resultIds).toEqual(["result-new"]);
      expect(saved.observationIds).toEqual(["observation-v2", "platform-observation"]);
      expect(saved.status).toBe(writer.name === "approved final report" ? "approved" : "draft");
    }
  });
  it("keeps the existing platform bypass without requiring an expert membership", async () => {
    state.rows.testAssignment[0].expertId = "someone-else";
    await expect(writer.run(platform)).resolves.toBeDefined();
    expect(state.clients[0].testAssignment.count).not.toHaveBeenCalled();
  });
  it("preserves ordinary admin denial for expert-only mutations", async () => {
    await expect(writer.run(admin)).rejects.toThrow(/прав/i);
    expect(subjectWrites()).toEqual([]); expect(m.transaction).not.toHaveBeenCalled();
  });
});
describe("final-report frozen source lease", () => {
  it("uses current transaction-bound attempts for approval rather than the pre-fence completed snapshot", async () => {
    state.beforeTransaction = () => { state.rows.testAssignment[0].attempts[0].status = "started"; };
    await expect(saveReport(expert, { ...reportInput, approve: true })).rejects.toThrow(/завершить/i);
    expect(subjectWrites()).toEqual([]); expect(writeAudits()).toEqual([]);
  });
  it("freezes only the results, observations and AI discovered inside the final participant lease", async () => {
    state.beforeTransaction = () => {
      state.rows.testAssignment[0].attempts[0].results = [{ id: "result-fresh" }];
      state.rows.expertObservation = [];
      state.rows.aiReport = [];
    };
    const saved = await saveReport(expert, reportInput);
    expect(saved.resultIds).toEqual(["result-fresh"]); expect(saved.observationIds).toEqual([]); expect(saved.aiReportId).toBeUndefined();
    expect(m.db.testAssignment.findMany).not.toHaveBeenCalled();
    expect(m.db.expertObservation.findMany).not.toHaveBeenCalled(); expect(m.db.aiReport.findFirst).not.toHaveBeenCalled();
    expect(state.clients[0].testAssignment.findMany).toHaveBeenCalled();
  });
});
