import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPETENCIES } from "../packages/core/competencies";
import { calculateScore } from "../packages/core/scoring";

// Only transports are modeled. Execute the complete handlers, real access,
// participant fence and eraser; default Prisma/auth/storage must never load.
const transport = vi.hoisted(() => ({ db: {} as any, removeStoredFiles: vi.fn(), queued: vi.fn() }));
vi.mock("../apps/api/src/db", () => ({
  db: transport.db, json: (value: any) => JSON.parse(JSON.stringify(value)),
  audit: (organizationId: string, actorId: string, action: string, entityId: string, detail?: any) =>
    transport.db.auditLog.create({ data: { organizationId, actorId, action, entityId, detail } }),
}));
vi.mock("../apps/api/src/auth", () => ({ auth: { api: { getSession: () => { throw Error("Auth transport forbidden"); } } } }));
vi.mock("../apps/api/src/storage", () => ({ removeStoredFiles: transport.removeStoredFiles }));
vi.mock("../apps/api/src/report-lifecycle", () => ({ queueCompletedAssessment: transport.queued }));
import { assignAssessors, saveConsensus } from "../apps/api/src/competencies";
import { recalculate } from "../apps/api/src/attempts";
import { eraseParticipantData } from "../apps/api/src/pilot-retention";

const now = new Date("2026-11-21T12:00:00Z");
const expert: any = { role: "expert", user: { id: "expert-user" }, member: { id: "expert-a" }, org: { id: "org", purpose: "assessment", dataMode: "real" } };
const admin: any = { ...expert, role: "admin", user: { id: "admin-user" } };
const operator: any = { ...expert, role: "superadmin", member: null, user: { id: "operator", platformAdmin: true, demoOnly: false } };
const consensusInput = () => ({
  campaignId: "campaign", modelId: "model", roleId: "holding-profile-55",
  ratings: DEFAULT_COMPETENCIES.competencies.map(c => ({
    competencyId: c.id, value: null, notObserved: true, evidenceIds: [], reason: "Synthetic source evidence was not observed.",
  })),
});
const orderedQuestions = [0, 1].map(position => ({
  id: `q${position + 1}`, position, type: "single" as const, text: { ru: "Synthetic", kk: "Synthetic" }, content: {},
  options: [0, 1].map(index => ({ id: `q${position + 1}-${index ? "b" : "a"}`, position: index, text: { ru: "Synthetic option", kk: "Synthetic option" } })),
}));
const keyConfig = { items: { q1: { correct: "q1-a" }, q2: { correct: "q2-b" } } };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === "OR") return value.some((part: any) => matches(row, part));
    if (key === "attemptId_scoringKeyId") return matches(row, value);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("in" in value) return value.in.includes(row[key]);
      if ("has" in value) return row[key]?.includes(value.has);
      return matches(row[key] ?? {}, value);
    }
    return row[key] === value;
  });
}
function project(row: any, select: any): any {
  return select ? Object.fromEntries(Object.entries(select).filter(([, value]) => value).map(([key, value]: [string, any]) =>
    [key, typeof value === "object" ? project(row[key], value.select) : row[key]])) : structuredClone(row);
}
function harness() {
  type Tables = Record<string, any[]>;
  const organization = { id: "org", purpose: "assessment", dataMode: "real", status: "active" };
  const member = (id: string, role = "employee") => ({
    id, organizationId: "org", userId: `${id}-user`, role, status: "active", createdAt: now, profileRow: role === "employee" ? 55 : null,
    organization, user: { id: `${id}-user`, email: `${id}@example.test`, name: `Synthetic ${id}`, platformAdmin: false },
  });
  const members = [member("subject"), member("expert-a", "expert"), member("expert-b", "expert")];
  const state = {
    tables: Object.fromEntries(["membership", "user", "testAssignment", "testAttempt", "testResult", "userAnswer", "scoringKey", "testVersion", "competencyModel", "competencyConsensus", "auditLog", "fileAsset", "expertObservation", "aiReport", "finalReport", "generatedReport", "participantGroup", "frozenNorm", "verification"].map(name => [name, []])) as Tables,
    events: [] as string[], queries: [] as { scope: string; model: string; method: string; query: any }[],
    failAction: "", held: false,
    onLock: undefined as undefined | ((tables: Tables, table: string) => void),
    afterCommit: undefined as undefined | (() => Promise<void>),
    createGate: undefined as undefined | ReturnType<typeof deferred>, created: deferred(),
  };
  Object.assign(state.tables, {
    membership: members, user: members.map(m => m.user),
    testAssignment: [{ id: "task", organizationId: "org", campaignId: "campaign", membershipId: "subject", expertId: "expert-a", assessorIds: ["expert-a"], testVersionId: "version" }],
    testAttempt: [{ id: "attempt", organizationId: "org", assignmentId: "task", status: "completed" }],
    testVersion: [{ id: "version", timeLimitSeconds: 60, questions: structuredClone(orderedQuestions).reverse().map(q => ({ ...q, options: q.options.reverse() })), testId: "synthetic", test: { direction: "synthetic", name: { ru: "Synthetic" } } }],
    userAnswer: [ { id: "answer-1", organizationId: "org", attemptId: "attempt", questionId: "q1", value: "q1-a", durationMs: 100 }, { id: "answer-2", organizationId: "org", attemptId: "attempt", questionId: "q2", value: "q2-b", durationMs: 200 } ],
    scoringKey: [{ id: "new-key", testVersionId: "version", algorithm: "cognitive", config: keyConfig }],
    testResult: [{ id: "historic-result", organizationId: "org", attemptId: "attempt", scoringKeyId: "old-key", result: { historic: true }, reason: "completed" }],
    competencyModel: [{ id: "model", organizationId: "org", content: DEFAULT_COMPETENCIES }],
  });
  let nextId = 0, txNumber = 0, tail = Promise.resolve();
  function client(getTables: () => Tables, scope: string): any {
    const db: any = {};
    function related(name: string, row: any, query: any) {
      const tables = getTables();
      const assignment = (a: any, include: any) => {
        const version = structuredClone(tables.testVersion.find(v => v.id === a.testVersionId));
        const questionQuery = include?.testVersion?.include?.questions;
        if (questionQuery?.orderBy?.position === "asc") version.questions.sort((a: any, b: any) => a.position - b.position);
        if (questionQuery?.include?.options?.orderBy?.position === "asc")
          version.questions.forEach((q: any) => q.options.sort((a: any, b: any) => a.position - b.position));
        return { ...a, testVersion: version };
      };
      if (name === "testAttempt") return { ...row,
        answers: tables.userAnswer.filter(a => a.attemptId === row.id),
        assignment: assignment(tables.testAssignment.find(a => a.id === row.assignmentId), query.include?.assignment?.include),
      };
      if (name === "testAssignment") return { ...assignment(row, query.include), attempts: [] };
      return row;
    }
    for (const name of Object.keys(state.tables)) {
      db[name] = {};
      for (const method of ["findFirst", "findUnique", "findMany", "count", "create", "upsert", "updateMany", "deleteMany", "delete"]) {
        db[name][method] = vi.fn(async (query: any = {}) => {
          state.queries.push({ scope, model: name, method, query });
          const tables = getTables();
          const found = tables[name].map(row => related(name, row, query)).filter(row => matches(row, query.where));
          if (query.orderBy?.version === "desc") found.sort((a, b) => b.version - a.version);
          if (["findFirst", "findUnique"].includes(method)) return found.length ? project(found[0], query.select) : null;
          if (method === "findMany") return found.map(row => project(row, query.select));
          if (method === "count") return found.length;
          state.events.push(`${scope}:${name}:${method}:${query.data?.action ?? ""}`);
          if (method === "create" || method === "upsert") {
            if (method === "upsert" && found.length) {
              expect(query.update, "recalculation must not rewrite a saved version").toEqual({});
              return structuredClone(found[0]);
            }
            const data = query.data ?? query.create;
            if (name === "auditLog" && data.action === state.failAction) throw Error("Synthetic receipt failure");
            const row = { id: `${name}-${++nextId}`, ...structuredClone(data) };
            tables[name].push(row);
            if (name === "competencyConsensus") { state.created.resolve(); if (state.createGate) await state.createGate.promise; }
            return structuredClone(row);
          }
          const ids = found.map(row => row.id);
          if (method === "updateMany") for (const row of tables[name]) if (ids.includes(row.id)) Object.assign(row, query.data);
          if (method === "deleteMany" || method === "delete") tables[name] = tables[name].filter(row => !ids.includes(row.id));
          return { count: found.length };
        });
      }
    }
    db.$queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: string[]) => {
      expect(state.held, "real fence/eraser lock must run in transaction").toBe(true);
      const table = strings.join("").includes("FROM users") ? "user" : "membership";
      state.events.push(`${scope}:lock:${table}`);
      state.onLock?.(getTables(), table);
      return getTables()[table].filter(row => row.id === values[0] && (table !== "membership" || row.organizationId === values[1])).map(row => ({ id: row.id }));
    });
    return db;
  }
  Object.assign(transport.db, client(() => state.tables, "root"));
  transport.db.$transaction = vi.fn(async (operation: any) => {
    const previous = tail, release = deferred(); tail = previous.then(() => release.promise); await previous;
    const scope = `tx${++txNumber}`, draft = structuredClone(state.tables);
    state.events.push(`${scope}:begin`); state.held = true;
    let result: any;
    try {
      result = await operation(client(() => draft, scope));
      state.tables = draft; state.events.push(`${scope}:commit`);
    } catch (failure) { state.events.push(`${scope}:rollback`); throw failure; }
    finally { state.held = false; release.resolve(); }
    const hook = state.afterCommit; state.afterCommit = undefined;
    if (hook) await hook();
    return result;
  });
  transport.removeStoredFiles.mockImplementation(async () => { state.events.push("storage:empty"); });
  transport.queued.mockResolvedValue(undefined);
  return state;
}
let state: ReturnType<typeof harness>;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); state = harness();
  vi.stubGlobal("fetch", () => { throw Error("Network forbidden"); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const receipts = (action: string) => state.tables.auditLog.filter(row => row.action === action);
const revoke = (tables: Record<string, any[]>) => { tables.testAssignment[0].expertId = "expert-b"; tables.testAssignment[0].assessorIds = ["expert-b"]; };

describe("Q-B3 complete consensus/recalculation handlers and erasure graph", () => {
  it("commits consensus receipt atomically, then actual erasure removes it even before handler return", async () => {
    state.afterCommit = async () => { expect(await eraseParticipantData("org", "subject")).toBe(true); state.events.push("erasure:committed"); };
    await saveConsensus(expert, "subject", consensusInput());
    expect(state.tables.competencyConsensus).toEqual([]);
    expect(receipts("competencies.consensus_saved")).toEqual([]);
    expect(state.events.findIndex(e => /tx1:auditLog:create:competencies.consensus_saved/.test(e))).toBeGreaterThan(-1);
    expect(state.events.indexOf("tx1:commit")).toBeLessThan(state.events.indexOf("erasure:committed"));
  });
  it("collects legacy consensus-ID-only audit references before deleting all subject versions", async () => {
    state.tables.competencyConsensus.push({ id: "legacy-consensus-output", organizationId: "org", campaignId: "campaign", membershipId: "subject", version: 1 });
    state.tables.auditLog.push({ id: "legacy-only-receipt", organizationId: "org", action: "competencies.consensus_saved", entityId: "legacy-consensus-output" }, { id: "unrelated-audit", organizationId: "org", action: "unrelated", entityId: "other-output" });
    await eraseParticipantData("org", "subject");
    expect(state.tables.auditLog.map(row => row.id)).not.toContain("legacy-only-receipt");
    expect(state.tables.auditLog.map(row => row.id)).toContain("unrelated-audit");
  });
  it.each(["consensus", "recalculation"])("rolls back %s primary output if its transaction receipt fails", async operation => {
    state.failAction = operation === "consensus" ? "competencies.consensus_saved" : "result.recalculated";
    const original = structuredClone(state.tables.testResult);
    await expect(operation === "consensus" ? saveConsensus(expert, "subject", consensusInput()) : recalculate(operator, "attempt", "new-key")).rejects.toThrow("Synthetic receipt failure");
    expect(state.tables.competencyConsensus).toEqual([]); expect(state.tables.testResult).toEqual(original);
  });
  it("appends consensus versions and preserves prior snapshots", async () => {
    state.tables.testAssignment[0].assessorIds = []; // expertId-only positive path.
    const first = await saveConsensus(expert, "subject", consensusInput());
    const frozen = structuredClone(first);
    const second = await saveConsensus(expert, "subject", consensusInput());
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(state.tables.competencyConsensus[0]).toEqual(frozen);
    expect(receipts("competencies.consensus_saved")).toHaveLength(2);
  });
  it("recalculates using fresh ordered questions/options, key and answers through the fence without rewriting versions", async () => {
    const historic = structuredClone(state.tables.testResult[0]), key = structuredClone(state.tables.scoringKey[0]);
    // Replace a previously discovered answer at lock acquisition. Only the fresh
    // transaction read can see q2's now-correct answer.
    state.tables.userAnswer[1].value = "q2-a";
    state.onLock = (tables, table) => { if (table === "membership") tables.userAnswer[1].value = "q2-b"; };
    const expected = calculateScore("cognitive", keyConfig, orderedQuestions, { q1: "q1-a", q2: "q2-b" }, { allowMissing: true, durations: { q1: 100, q2: 200 } });
    const created = await recalculate(operator, "attempt", "new-key");
    expect(created.result).toEqual(expected);
    expect(state.tables.testResult).toHaveLength(2); expect(state.tables.testResult[0]).toEqual(historic);
    expect(state.tables.scoringKey[0]).toEqual(key);
    expect(await recalculate(operator, "attempt", "new-key")).toEqual(created);
    expect(state.tables.testResult).toHaveLength(2);
    const read = state.queries.find(q => q.scope.startsWith("tx") && q.model === "testAttempt" && q.method === "findFirst");
    expect(read?.query.include.assignment.include.testVersion.include.questions).toMatchObject({ orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } });
    expect(state.queries.some(q => q.scope.startsWith("tx") && q.model === "scoringKey" && q.method === "findFirst")).toBe(true);
    expect(state.events).not.toContain("root:testResult:upsert:");
    expect(state.events).not.toContain("root:auditLog:create:result.recalculated");
  });
  it("commits recalculation receipt in the participant fence before actual erasure deletes the output graph", async () => {
    state.afterCommit = async () => { expect(await eraseParticipantData("org", "subject")).toBe(true); };
    await recalculate(operator, "attempt", "new-key");
    expect(state.tables.testResult).toEqual([]); expect(receipts("result.recalculated")).toEqual([]);
    expect(state.events).toContain("tx1:auditLog:create:result.recalculated");
  });
  it.each(["blocked", "incomplete", "changed-campaign", "changed-member"])("recalculation denies %s after discovery without output/receipt", async change => {
    state.onLock = (tables, table) => {
      if (table !== "membership") return;
      if (change === "blocked") tables.membership.find(row => row.id === "subject").status = "blocked";
      if (change === "incomplete") tables.testAttempt[0].status = "in_progress";
      if (change === "changed-campaign") tables.testAssignment[0].campaignId = "other-campaign";
      if (change === "changed-member") tables.testAssignment[0].membershipId = "expert-b";
    };
    await expect(recalculate(operator, "attempt", "new-key")).rejects.toThrow();
    expect(state.tables.testResult).toHaveLength(1); expect(receipts("result.recalculated")).toEqual([]);
  });
});

describe("Q-B4 fresh consensus authorization and serialized administrator revocation", () => {
  it("denies an expert revoked after discovery but before final participant locks", async () => {
    state.onLock = (tables, table) => { if (table === "user") revoke(tables); };
    await expect(saveConsensus(expert, "subject", consensusInput())).rejects.toThrow(/назначен/);
    expect(state.tables.competencyConsensus).toEqual([]); expect(receipts("competencies.consensus_saved")).toEqual([]);
  });
  it("cannot authorize from another campaign, but accepts a current assessor-only assignment", async () => {
    state.tables.testAssignment.push({ ...state.tables.testAssignment[0], id: "other-task", campaignId: "other-campaign" });
    state.onLock = (tables, table) => { if (table === "membership") revoke(tables); };
    await expect(saveConsensus(expert, "subject", consensusInput())).rejects.toThrow(/назначен/);
    state.onLock = undefined;
    state.tables.testAssignment[0].expertId = "expert-b"; state.tables.testAssignment[0].assessorIds = ["expert-a"];
    expect((await saveConsensus(expert, "subject", consensusInput())).version).toBe(1);
  });
  it("preserves the platform bypass and existing admin prohibition for consensus", async () => {
    revoke(state.tables);
    expect((await saveConsensus(operator, "subject", consensusInput())).version).toBe(1);
    await expect(saveConsensus(admin, "subject", consensusInput())).rejects.toThrow(/прав/);
  });
  it("assignment update and participant-bearing audit use the same locked transaction and are erased after commit", async () => {
    state.afterCommit = async () => { await eraseParticipantData("org", "subject"); };
    expect(await assignAssessors(admin, "subject", { campaignId: "campaign", expertIds: ["expert-b"] })).toEqual({ ok: true });
    expect(receipts("assessors.assigned")).toEqual([]);
    expect(state.events).toContain("tx1:lock:user"); expect(state.events).toContain("tx1:lock:membership");
    expect(state.events).toContain("tx1:testAssignment:updateMany:"); expect(state.events).toContain("tx1:auditLog:create:assessors.assigned");
    expect(state.events).not.toContain("root:testAssignment:updateMany:");
  });
  it("rolls back reassignment if its receipt cannot persist", async () => {
    state.failAction = "assessors.assigned";
    await expect(assignAssessors(admin, "subject", { campaignId: "campaign", expertIds: ["expert-b"] })).rejects.toThrow("Synthetic receipt failure");
    expect(state.tables.testAssignment[0].expertId).toBe("expert-a");
  });
  it("rechecks candidate experts inside the assignment transaction", async () => {
    state.onLock = (tables, table) => { if (table === "membership") tables.membership.find(row => row.id === "expert-b").status = "blocked"; };
    await expect(assignAssessors(admin, "subject", { campaignId: "campaign", expertIds: ["expert-b"] })).rejects.toThrow(/Эксперт недоступен/);
    expect(receipts("assessors.assigned")).toEqual([]); expect(state.tables.testAssignment[0].expertId).toBe("expert-a");
  });
  it("an active consensus fence orders admin revocation after the writer, then denies the revoked expert", async () => {
    state.createGate = deferred();
    const writer = saveConsensus(expert, "subject", consensusInput());
    await state.created.promise;
    const revocation = assignAssessors(admin, "subject", { campaignId: "campaign", expertIds: ["expert-b"] });
    await Promise.resolve(); await Promise.resolve();
    expect(state.tables.testAssignment[0].expertId).toBe("expert-a");
    expect(state.events.some(e => /testAssignment:updateMany/.test(e))).toBe(false);
    state.createGate.resolve(); await writer; await revocation;
    expect(state.events.indexOf("tx1:commit")).toBeLessThan(state.events.indexOf("tx2:testAssignment:updateMany:"));
    expect(state.tables.testAssignment[0].expertId).toBe("expert-b");
    await expect(saveConsensus(expert, "subject", consensusInput())).rejects.toThrow(/назначен/);
    expect(state.tables.competencyConsensus).toHaveLength(1);
  });
});
