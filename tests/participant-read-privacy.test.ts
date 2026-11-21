import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Execute the actual handlers, access checks, audit helper and participant fence.
// Only persistence/provider transports are modeled; no default service is usable.
const m = vi.hoisted(() => {
  const unexpected = (name: string) => vi.fn<(...args: any[]) => Promise<any>>(async () => { throw Error(`Unstubbed ${name}`); });
  const model = (name: string) => Object.fromEntries(
    ["findFirst", "findUnique", "findUniqueOrThrow", "findMany", "count", "create"].map(method => [method, unexpected(`${name}.${method}`)]),
  );
  return {
    db: Object.fromEntries(["membership", "user", "testAssignment", "finalReport", "expertObservation", "aiReport", "fileAsset", "generatedReport", "participantGroup", "competencyConsensus", "testAttempt", "auditLog"].map(name => [name, model(name)])) as Record<string, any>,
    transaction: unexpected("transaction"), send: unexpected("S3.send"),
  };
});
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor() { return { ...m.db, $transaction: m.transaction }; } } }));
vi.mock("../apps/api/src/auth", () => ({ auth: { api: { getSession: () => { throw Error("Auth transport forbidden"); } } } }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(public input: any) {} }
  return {
    S3Client: class { send = m.send; },
    HeadBucketCommand: class extends Command {}, CreateBucketCommand: class extends Command {},
    PutObjectCommand: class extends Command {}, DeleteObjectCommand: class extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
  };
});
import { participantDetails } from "../apps/api/src/assessment";
import { exportPersonalData } from "../apps/api/src/privacy";
import { downloadAsset } from "../apps/api/src/storage";
import type { Context } from "../apps/api/src/access";

const instant = new Date("2026-11-21T12:00:00Z");
const admin = { org: { id: "org", dataMode: "real" }, user: { id: "admin-user" }, member: { id: "admin-member" }, role: "admin" } as unknown as Context;
const expert = { ...admin, role: "expert", member: { id: "expert-member" } } as unknown as Context;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function project(row: any, args: any): any {
  if (!row) return null;
  const source = structuredClone(row);
  if (args?.select) return Object.fromEntries(Object.entries(args.select).filter(([, value]) => value).map(([key, value]) => [key,
    typeof value === "object" ? (Array.isArray(source[key]) ? source[key].map((item: any) => project(item, value)) : project(source[key], value)) : source[key],
  ]));
  const { user, organization, ...base } = source;
  if (args?.include?.user) (base as any).user = project(user, args.include.user === true ? {} : args.include.user);
  if (args?.include?.organization) (base as any).organization = organization;
  return base;
}
function harness() {
  const events: string[] = [];
  const organization = { id: "org", purpose: "assessment", dataMode: "real", status: "active" };
  const user = { id: "subject-user", name: "Synthetic private person", email: "synthetic@example.test", locale: "ru", platformAdmin: false, createdAt: instant };
  const member: any = { id: "subject", organizationId: "org", userId: user.id, role: "employee", status: "active", createdAt: instant, user, organization };
  const file = { id: "file", organizationId: "org", campaignId: "campaign", membershipId: "subject", storageKey: "org/subject/synthetic", name: "synthetic.pdf", contentType: "application/pdf", size: 15 };
  const state = {
    events, member: member as any, file: file as any, user,
    audits: [{ organizationId: "org", action: "results.viewed", entityId: "subject" }] as any[],
    initialStarted: deferred(), initialGate: undefined as ReturnType<typeof deferred> | undefined,
    bodyStarted: deferred(), bodyGate: undefined as ReturnType<typeof deferred> | undefined,
    beforeUserLock: undefined as (() => void) | undefined,
    expertAssigned: true, failAudit: false, failCommit: false, held: false,
    transactionClients: [] as any[],
    eraseNow() {
      if (state.held) throw Error("Model erasure must acquire the same users/membership locks");
      state.member = null; state.file = null; state.audits = [];
      // A shared user's account can survive tenant-scoped erasure.
      events.push("erase:committed");
    },
    async erase() {
      events.push("erase:requested");
      await exclusive(async () => { state.eraseNow(); });
    },
  };
  let tail = Promise.resolve();
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = tail, release = deferred();
    tail = previous.then(() => release.promise);
    await previous;
    try { return await operation(); } finally { release.resolve(); }
  }
  const matches = (row: any, where: any = {}) => row
    && ["organizationId", "membershipId", "campaignId"].every(key => !where[key] || row[key] === where[key])
    && (!where.id || (typeof where.id === "string" ? row.id === where.id : where.id.in.includes(row.id)));
  m.db.membership.findFirst.mockImplementation(async (args: any) => {
    events.push("global:initial-member");
    const snapshot = matches(state.member, args.where) ? project(state.member, args) : null;
    state.initialStarted.resolve();
    if (state.initialGate) await state.initialGate.promise;
    return snapshot;
  });
  m.db.testAssignment.count.mockImplementation(async () => state.expertAssigned ? 1 : 0);
  m.db.fileAsset.findFirst.mockImplementation(async (args: any) => { events.push("global:initial-file"); return matches(state.file, args.where) ? project(state.file, args) : null; });
  m.db.user.findUniqueOrThrow.mockImplementation(async (args: any) => { events.push("global:user"); return project(user, args); });
  for (const name of ["testAssignment", "finalReport", "expertObservation", "aiReport", "fileAsset", "generatedReport", "participantGroup", "competencyConsensus", "testAttempt", "auditLog"])
    m.db[name].findMany.mockImplementation(async () => { events.push(`global:${name}`); return []; });
  m.db.auditLog.create.mockImplementation(async ({ data }: any) => {
    events.push("global:audit"); state.audits.push({ ...data, afterErasure: !state.member }); return data;
  });
  m.transaction.mockImplementation(async (operation: any) => {
    const pending: any[] = [];
    let locked = false;
    const tx: any = {
      membership: {
        findMany: vi.fn(async (args: any) => matches(state.member, args.where) ? [project(state.member, args)] : []),
        findUnique: vi.fn(async (args: any) => matches(state.member, args.where) ? project(state.member, args) : null),
        findUniqueOrThrow: vi.fn(async (args: any) => { events.push("tx:member"); if (!matches(state.member, args.where)) throw Error("Member missing"); return project(state.member, args); }),
      },
      user: { findUniqueOrThrow: vi.fn(async (args: any) => { events.push("tx:user"); return project(user, args); }) },
      testAssignment: { count: vi.fn(async () => state.expertAssigned ? 1 : 0) },
      fileAsset: { findFirst: vi.fn(async (args: any) => { events.push("tx:file"); return matches(state.file, args.where) ? structuredClone(state.file) : null; }) },
      auditLog: { create: vi.fn(async ({ data }: any) => { events.push("tx:audit"); if (state.failAudit) throw Error("Audit failed"); pending.push(data); return data; }) },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: string[]) => {
        const table = strings.join("").includes("FROM users") ? "user" : "membership";
        if (!locked) {
          state.beforeUserLock?.();
          state.held = true; locked = true;
        }
        events.push(`lock:${table}:${values[0]}`);
        return table === "user" ? [{ id: user.id }] : matches(state.member, { id: values[0], organizationId: values[1] }) ? [{ id: values[0] }] : [];
      }),
    };
    for (const name of ["testAssignment", "finalReport", "expertObservation", "aiReport", "fileAsset", "generatedReport", "participantGroup", "competencyConsensus", "testAttempt", "auditLog"])
      tx[name] = { ...tx[name], findMany: vi.fn(async () => { events.push(`tx:${name}`); return []; }) };
    state.transactionClients.push(tx);
    return exclusive(async () => {
      events.push("tx:begin");
      try {
        const result = await operation(tx);
        if (state.failCommit) throw Error("Commit failed");
        state.audits.push(...pending); events.push("tx:commit"); return result;
      } finally { state.held = false; }
    });
  });
  m.send.mockImplementation(async (command: any) => {
    if (command.constructor.name !== "GetObjectCommand") throw Error("Unstubbed provider command");
    events.push("s3:get");
    // Fixture response only: no claim about a provider's read/delete consistency.
    return { Body: { transformToByteArray: async () => {
      events.push("s3:body:start"); state.bodyStarted.resolve();
      if (state.bodyGate) await state.bodyGate.promise;
      events.push("s3:body:end"); return Buffer.from("synthetic bytes");
    } } };
  });
  return state;
}
let state: ReturnType<typeof harness>;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(instant);
  vi.stubGlobal("fetch", () => { throw Error("Network forbidden"); });
  state = harness();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const readers = [
  { name: "participant details", run: (ctx = admin) => participantDetails(ctx, "subject", "campaign"), action: "results.viewed", entityId: "subject" },
  { name: "personal-data export", run: (ctx = admin) => exportPersonalData(ctx, "subject"), action: "personal_data.exported", entityId: "subject" },
  { name: "file download", run: (ctx = admin) => downloadAsset(ctx, "file"), action: "file.downloaded", entityId: "file" },
];
describe.each(readers)("$name final disclosure boundary", reader => {
  it("rejects a stale authorized subject erased before final authorization, without recreating an audit or returning private data", async () => {
    state.initialGate = deferred();
    const reading = reader.run().then(value => ({ value }), error => ({ error }));
    await state.initialStarted.promise;
    state.eraseNow();
    state.initialGate.resolve();
    const outcome = await reading;
    expect.soft(state.events).toContain("erase:committed");
    expect.soft(state.audits, "no audit identifier may be resurrected after erasure").toEqual([]);
    expect.soft(outcome, "an erased subject must not yield a private payload").toHaveProperty("error");
    expect.soft(state.events).not.toContain("s3:get");
  });
  it("rereads eligibility after users then membership locks when erasure wins after fence discovery", async () => {
    state.beforeUserLock = () => state.eraseNow();
    await expect(reader.run()).rejects.toThrow();
    expect(state.audits).toHaveLength(0); expect(state.events).not.toContain("s3:get");
  });
  it.each(["blocked", "expired", "foreign", "reparented"])("fails closed for a %s subject at final lock acquisition", async condition => {
    state.beforeUserLock = () => {
      if (condition === "blocked") state.member.status = "blocked";
      if (condition === "expired") state.member.createdAt = new Date("2026-08-21T12:00:00Z");
      if (condition === "foreign") state.member.organizationId = "other-org";
      if (condition === "reparented") state.member.userId = "unlocked-user";
    };
    await expect(reader.run()).rejects.toThrow();
    expect(state.events).not.toContain("tx:audit"); expect(state.events).not.toContain("s3:get");
  });
  it("returns an authorized payload and commits its receipt only through the supplied transaction", async () => {
    const result: any = await reader.run();
    if (reader.name === "file download") expect(result.bytes.toString()).toBe("synthetic bytes");
    else expect((result.user ?? result.member.user).name).toBe("Synthetic private person");
    expect(state.events.filter(event => event.startsWith("lock:"))).toEqual(["lock:user:subject-user", "lock:membership:subject"]);
    expect(state.events.filter(event => event.startsWith("global:"))).toEqual(reader.name === "file download" ? ["global:initial-file", "global:initial-member"] : ["global:initial-member"]);
    expect(state.audits.at(-1)).toEqual(expect.objectContaining({ organizationId: "org", actorId: "admin-user", action: reader.action, entityId: reader.entityId }));
    expect(state.events.indexOf("tx:audit")).toBeLessThan(state.events.indexOf("tx:commit"));
  });
  it.each(["failAudit", "failCommit"] as const)("does not return a payload on %s", async failure => {
    state[failure] = true;
    await expect(reader.run()).rejects.toThrow(failure === "failAudit" ? "Audit failed" : "Commit failed");
    expect(state.audits).toHaveLength(1);
  });
  it("preserves tenant, role and demo authorization before opening the final fence", async () => {
    await expect(reader.run({ ...admin, org: { id: "foreign-org" } } as any)).rejects.toThrow();
    await expect(reader.run({ ...admin, role: "employee" } as any)).rejects.toThrow();
    await expect(reader.run({ ...admin, user: { id: "demo", demoOnly: true } } as any)).rejects.toThrow();
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
describe("campaign-specific expert authorization", () => {
  it.each([readers[0], readers[2]])("$name retains expert assignment checks under the final fence", async reader => {
    state.beforeUserLock = () => { state.expertAssigned = false; };
    await expect(reader.run(expert)).rejects.toThrow(/назначен/i);
    expect(state.events).not.toContain("tx:audit"); expect(state.events).not.toContain("s3:get");
    expect(state.transactionClients[0].testAssignment.count).toHaveBeenCalledWith({ where: {
      organizationId: "org", membershipId: "subject", campaignId: "campaign",
      OR: [{ expertId: "expert-member" }, { assessorIds: { has: "expert-member" } }],
    } });
  });
  it.each([readers[0], readers[2]])("$name still works for an assigned expert", async reader => {
    await expect(reader.run(expert)).resolves.toBeDefined();
  });
});
describe("download body preparation", () => {
  it.each(["campaignId", "membershipId"])("rejects a file whose %s changed since initial authorization", async field => {
    state.beforeUserLock = () => { state.file[field] = "different-scope"; };
    await expect(downloadAsset(admin, "file")).rejects.toThrow();
    expect(state.events).not.toContain("s3:get"); expect(state.events).not.toContain("tx:audit");
  });
  it("does not audit or return bytes if consuming the body fails", async () => {
    m.send.mockResolvedValue({ Body: { transformToByteArray: async () => { throw Error("Body read failed"); } } });
    await expect(downloadAsset(admin, "file")).rejects.toThrow("Body read failed");
    expect(state.audits).toHaveLength(1); expect(state.events).not.toContain("tx:audit");
  });
  it("bounds the complete body preparation and never appends a receipt when a timed-out provider later resumes", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    state.bodyGate = deferred();
    const reading = downloadAsset(admin, "file").then(value => ({ value }), error => ({ error }));
    await state.bodyStarted.promise;
    controller.abort();
    const outcome = await Promise.race([reading, new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 30))]);
    // Always release the modeled late transport, even on RED, to avoid leaked work.
    state.bodyGate.resolve(); await reading;
    expect(outcome).toHaveProperty("error");
    expect(timeout).toHaveBeenCalledWith(20000);
    expect(state.events).not.toContain("tx:audit"); expect(state.audits).toHaveLength(1);
  });
  it("keeps erasure waiting through the complete body read and audit commit", async () => {
    state.bodyGate = deferred();
    const reading = downloadAsset(admin, "file");
    await state.bodyStarted.promise;
    const erasure = state.erase();
    await Promise.resolve();
    expect.soft(state.held, "the body must be consumed before releasing the participant fence").toBe(true);
    expect.soft(state.events).not.toContain("erase:committed");
    state.bodyGate.resolve();
    expect((await reading).bytes.toString()).toBe("synthetic bytes");
    await erasure;
    expect(state.events.indexOf("s3:body:end")).toBeLessThan(state.events.indexOf("tx:audit"));
    expect(state.events.indexOf("tx:commit")).toBeLessThan(state.events.indexOf("erase:committed"));
    expect(state.audits).toEqual([]);
    expect(m.send.mock.calls[0][1]?.abortSignal).toBeDefined();
  });
});
