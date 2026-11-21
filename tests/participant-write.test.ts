import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fail closed: neither Prisma/auth nor the AWS SDK can reach a service here.
const mocks = vi.hoisted(() => {
  const unexpected = (name: string) => vi.fn<(...args: any[]) => Promise<any>>(async () => { throw Error(`Unstubbed ${name}`); });
  const model = (name: string) => Object.fromEntries(
    ["findFirst", "findUnique", "findMany", "create", "update", "updateMany", "deleteMany", "count"].map(method => [method, unexpected(`${name}.${method}`)]),
  );
  return {
    db: { membership: model("membership"), fileAsset: model("fileAsset"), testAssignment: model("testAssignment"), auditLog: model("auditLog"), $transaction: unexpected("transaction") },
    send: unexpected("S3.send"), config: vi.fn(), audit: unexpected("audit"),
  };
});
vi.mock("../apps/api/src/db", () => ({ db: mocks.db, audit: mocks.audit }));
vi.mock("../apps/api/src/auth", () => ({ auth: { api: { getSession: () => { throw Error("Auth forbidden"); } } } }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(public input: any) {} }
  return {
    S3Client: class { constructor(config: unknown) { mocks.config(config); } send = mocks.send; },
    HeadBucketCommand: class HeadBucketCommand extends Command {},
    CreateBucketCommand: class CreateBucketCommand extends Command {},
    PutObjectCommand: class PutObjectCommand extends Command {},
    DeleteObjectCommand: class DeleteObjectCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
  };
});
import { uploadAsset, removeStoredFiles } from "../apps/api/src/storage";
import type { Context } from "../apps/api/src/access";

const instant = new Date("2026-11-21T12:00:00Z");
const subject = (id = "member-a", userId = "user-z") => ({
  id, userId, organizationId: "org", role: "employee", status: "active", createdAt: instant,
  organization: { id: "org", purpose: "assessment", dataMode: "real", status: "active" },
  user: { id: userId, platformAdmin: false },
});
const ctx = { org: { id: "org", dataMode: "real" }, user: { id: "expert-user" }, member: { id: "expert-member" }, role: "expert" } as unknown as Context;
const input = { campaignId: "campaign", membershipId: "member-a", name: "synthetic.pdf", contentType: "application/pdf", base64: Buffer.from("synthetic bytes").toString("base64") };
function deferred<T = void>() {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = value => done(value as T | PromiseLike<T>); });
  return { promise, resolve };
}

function harness() {
  const events: string[] = [];
  const members = new Map<string, any>([["member-a", subject()]]);
  const files = new Map<string, any>();
  const receipts = new Map<string, any>();
  const objects = new Set<string>();
  let held = false, tail = Promise.resolve(), txNumber = 0;
  const state = {
    events, members, files, objects, receipts,
    assignments: [{ organizationId: "org", membershipId: "member-a", campaignId: "campaign", expertId: "expert-member", assessorIds: ["expert-member"] }],
    failUpdate: false, failAudit: false, failCommit: 0, failDelete: false, failPut: false, failSettlement: false,
    readGate: undefined as undefined | ReturnType<typeof deferred>,
    readStarted: deferred(), expireSecond: false, expiry: deferred(), running: [] as Promise<any>[],
    afterCommit: undefined as undefined | ((number: number) => void),
    onLock: undefined as undefined | ((table: string, id: string) => void),
    putGate: undefined as undefined | ReturnType<typeof deferred>,
    putStarted: deferred(),
    transactionClients: [] as any[],
    get held() { return held; },
    async exclusive<T>(operation: () => Promise<T>): Promise<T> {
      const previous = tail, release = deferred();
      tail = previous.then(() => release.promise);
      await previous;
      held = true;
      try { return await operation(); } finally { held = false; release.resolve(); }
    },
    async eraseModel() {
      events.push("erase:requested");
      await state.exclusive(async () => {
        events.push("erase:block");
        const member = members.get("member-a");
        if (member) member.status = "blocked";
        events.push("erase:user-lock", "erase:membership-lock");
        await removeStoredFiles("org", "member-a");
        files.clear(); receipts.clear(); members.delete("member-a");
        events.push("erase:done");
      });
    },
  };
  const matches = (member: any, where: any) => (!where.organizationId || member.organizationId === where.organizationId)
    && (!where.id || (typeof where.id === "string" ? member.id === where.id : where.id.in.includes(member.id)));
  mocks.db.membership.findFirst.mockImplementation(async ({ where }: any) => [...members.values()].find(member => matches(member, where)) ?? null);
  const assigned = ({ where }: any) => state.assignments.filter(row =>
    row.organizationId === where.organizationId && row.membershipId === where.membershipId &&
    (!where.campaignId || row.campaignId === where.campaignId) &&
    (!where.OR || where.OR.some((part: any) => part.expertId ? row.expertId === part.expertId : row.assessorIds.includes(part.assessorIds.has))),
  ).length;
  mocks.db.testAssignment.count.mockImplementation(async query => assigned(query));
  mocks.db.fileAsset.findMany.mockImplementation(async ({ where }: any) => [...files.values()].filter(file => file.organizationId === where.organizationId && file.membershipId === where.membershipId));
  mocks.db.auditLog.count.mockImplementation(async ({ where }: any) => [...receipts.values()].filter(receipt => receipt.organizationId === where.organizationId && receipt.action === where.action && where.entityId.in.includes(receipt.entityId)).length);
  mocks.db.auditLog.updateMany.mockImplementation(async ({ where, data }: any) => {
    events.push("put:settled");
    if (state.failSettlement) throw Error("Settlement persistence failed");
    let count = 0;
    for (const [id, receipt] of receipts) if (Object.entries(where).every(([key, value]) => receipt[key] === value)) {
      receipts.set(id, { ...receipt, ...data }); count++;
    }
    return { count };
  });
  mocks.db.$transaction.mockImplementation(async (operation: any) => state.exclusive(async () => {
    const number = ++txNumber;
    events.push(`tx${number}:begin`);
    const pending = new Map(files);
    const pendingReceipts = new Map(receipts);
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: string[]) => {
        const table = strings.join("").includes("FROM users") ? "user" : "membership";
        const id = values[0];
        events.push(`lock:${table}:${id}`);
        state.onLock?.(table, id);
        return table === "user"
          ? ([...members.values()].some(member => member.userId === id) ? [{ id }] : [])
          : (members.get(id)?.organizationId === values[1] ? [{ id }] : []);
      }),
      membership: {
        findMany: vi.fn(async ({ where }: any) => { events.push("members:read"); return [...members.values()].filter(member => matches(member, where)).map(member => ({ ...member })); }),
        findUnique: vi.fn(async ({ where }: any) => { events.push(`member:read:${where.id}`); return members.get(where.id) ?? null; }),
      },
      testAssignment: { count: vi.fn(async (query: any) => { events.push(`tx${number}:assignment:check`); return assigned(query); }) },
      fileAsset: {
        create: vi.fn(async ({ data }: any) => { events.push("file:reserve"); const row = { id: `file-${number}`, ...data }; pending.set(row.id, row); return row; }),
        findFirst: vi.fn(async ({ where }: any) => {
          events.push("file:read");
          const row = [...pending.values()].find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
          state.readStarted.resolve();
          if (state.readGate) await state.readGate.promise;
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => { events.push("file:persist"); if (state.failUpdate) throw Error("Metadata persistence failed"); const row = pending.get(where.id); if (!row) throw Error("File missing"); const updated = { ...row, ...data }; pending.set(row.id, updated); return updated; }),
      },
      auditLog: {
        create: vi.fn(async ({ data }: any) => { events.push("audit:reserve"); const row = { id: `receipt-${number}`, ...data }; pendingReceipts.set(row.id, row); return row; }),
        update: vi.fn(async ({ where, data }: any) => { events.push("audit:persist"); if (state.failAudit) throw Error("Audit persistence failed"); const row = { ...pendingReceipts.get(where.id), ...data }; pendingReceipts.set(where.id, row); return row; }),
      },
    };
    state.transactionClients.push(tx);
    try {
      const running = operation(tx); state.running.push(running);
      const result = await (state.expireSecond && number === 2
        ? Promise.race([running, state.expiry.promise.then(() => { throw Error("Transaction expired"); })])
        : running);
      if (state.failCommit === number) throw Error("Commit failed");
      files.clear(); for (const [id, row] of pending) files.set(id, row);
      receipts.clear(); for (const [id, row] of pendingReceipts) receipts.set(id, row);
      events.push(`tx${number}:commit`);
      state.afterCommit?.(number);
      return result;
    } catch (error) { events.push(`tx${number}:rollback`); throw error; }
  }));
  mocks.send.mockImplementation(async (command: any, options?: any) => {
    const name = command.constructor.name;
    if (name === "HeadBucketCommand" || name === "CreateBucketCommand") { events.push("bucket:ready"); return {}; }
    if (name === "PutObjectCommand") {
      events.push("s3:put:start");
      expect(held, "PUT must retain the participant fence").toBe(true);
      expect([...files.values()].some(file => file.storageKey === command.input.Key), "PUT must already have a committed recovery reference").toBe(true);
      expect(options?.abortSignal, "S3 request must have a finite abort budget").toBeDefined();
      state.putStarted.resolve();
      if (state.putGate) await state.putGate.promise;
      objects.add(command.input.Key);
      events.push("s3:put:end");
      if (state.failPut) throw Error("PUT response lost");
      return {};
    }
    if (name === "DeleteObjectCommand") {
      events.push("s3:delete");
      if (state.failDelete) throw Error("S3 delete failed");
      objects.delete(command.input.Key); return {};
    }
    throw Error(`Unstubbed S3 command: ${name}`);
  });
  return state;
}
let state: ReturnType<typeof harness>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(instant);
  state = harness();
  vi.stubGlobal("fetch", () => { throw Error("Network forbidden"); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const fence = async () => (await import("../apps/api/src/participant-write")).withParticipantWriteFence;

describe("participant write fence", () => {
  it("locks sorted distinct users before sorted distinct memberships, rereads, then runs the transaction operation", async () => {
    state.members.set("member-b", subject("member-b", "user-a"));
    state.members.set("member-c", subject("member-c", "user-a"));
    const operation = vi.fn(async (tx: any) => { state.events.push("operation"); expect(tx).toBe(state.transactionClients[0]); return "saved"; });
    const result = await (await fence())("org", ["member-c", "member-a", "member-b", "member-a"], operation);
    expect(result).toBe("saved");
    expect(state.events.filter(event => event.startsWith("lock:"))).toEqual([
      "lock:user:user-a", "lock:user:user-z", "lock:membership:member-a", "lock:membership:member-b", "lock:membership:member-c",
    ]);
    expect(state.events.indexOf("operation")).toBeGreaterThan(state.events.indexOf("lock:membership:member-c"));
    expect(state.events.slice(state.events.indexOf("lock:membership:member-c") + 1, state.events.indexOf("operation")).some(event => /read/.test(event))).toBe(true);
    expect(mocks.db.$transaction.mock.calls[0][1]).toEqual(expect.objectContaining({ timeout: 120000, maxWait: 5000 }));
  });
  it.each(["blocked", "expired", "foreign", "missing", "reparented"])("rejects %s membership under the acquired lock", async change => {
    state.onLock = (table, id) => {
      if (table !== "membership" || id !== "member-a") return;
      const member = state.members.get(id);
      if (change === "blocked") member.status = "blocked";
      if (change === "expired") member.createdAt = new Date("2026-08-21T12:00:00Z");
      if (change === "foreign") member.organizationId = "other-org";
      if (change === "missing") state.members.delete(id);
      if (change === "reparented") member.userId = "unlocked-user";
    };
    const operation = vi.fn();
    await expect((await fence())("org", ["member-a"], operation)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
  });
  it("rechecks a platform-admin participant without applying employee retention to a protected account", async () => {
    const member = state.members.get("member-a"); member.user.platformAdmin = true; member.createdAt = new Date("2020-01-01Z");
    expect(await (await fence())("org", ["member-a"], async () => "ok")).toBe("ok");
  });
  it("rejects empty participant sets without starting an unfenced operation", async () => {
    const operation = vi.fn();
    await expect((await fence())("org", [], operation)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("coordinated upload", () => {
  it.each(["before-reservation", "before-put"])("denies expert revocation %s without a new upload or PUT", async boundary => {
    // An assignment in a different campaign must not rescue either stale fence.
    state.assignments.push({ ...state.assignments[0], campaignId: "another-campaign" });
    const revoke = () => { state.assignments[0].expertId = "replacement-expert"; state.assignments[0].assessorIds = ["replacement-expert"]; };
    if (boundary === "before-reservation") state.onLock = table => { if (table === "membership") revoke(); };
    else state.afterCommit = number => { if (number === 1) revoke(); };
    await expect(uploadAsset(ctx, input)).rejects.toThrow(/назначен/);
    expect(state.events).not.toContain("s3:put:start"); expect(state.objects.size).toBe(0);
    expect([...state.receipts.values()].some(receipt => receipt.action === "file.uploaded")).toBe(false);
    if (boundary === "before-reservation") {
      expect(state.files.size).toBe(0); expect(state.receipts.size).toBe(0);
      expect(state.events).not.toContain("file:reserve"); expect(state.events).not.toContain("put:settled");
    } else {
      // The separately committed recovery reservation remains indexed. Since no
      // PUT started, only its existing marker may safely become settled.
      expect(state.files.size).toBe(1); expect(state.receipts.size).toBe(1);
      expect([...state.receipts.values()][0].action).toBe("file.upload_put_settled");
      expect(state.events.filter(event => event === "put:settled")).toHaveLength(1);
      expect(state.events).not.toContain("s3:delete");
      await state.eraseModel(); expect(state.files.size).toBe(0);
    }
  });
  it("both upload fences require the same campaign rather than an unrelated assignment", async () => {
    state.assignments.push({ ...state.assignments[0], campaignId: "another-campaign" });
    state.onLock = table => { if (table === "membership") { state.assignments[0].expertId = "replacement-expert"; state.assignments[0].assessorIds = []; } };
    await expect(uploadAsset(ctx, input)).rejects.toThrow(/назначен/);
    expect(state.files.size).toBe(0); expect(state.events).not.toContain("s3:put:start");
  });
  it("allows an assessor-only expert at both fences and preserves platform bypass/admin denial", async () => {
    state.assignments[0].expertId = "another-expert";
    await expect(uploadAsset(ctx, input)).resolves.toMatchObject({ id: "file-1" });
    const checks = state.transactionClients.map(tx => tx.testAssignment.count.mock.calls);
    expect(checks.map(calls => calls.length)).toEqual([1, 1]);
    for (const calls of checks) expect(calls[0][0].where).toMatchObject({ organizationId: "org", membershipId: "member-a", campaignId: "campaign", OR: [{ expertId: "expert-member" }, { assessorIds: { has: "expert-member" } }] });
    state.assignments.length = 0;
    await expect(uploadAsset({ ...ctx, role: "superadmin", member: null, user: { id: "operator", platformAdmin: true, demoOnly: false } } as any, input)).resolves.toHaveProperty("id");
    await expect(uploadAsset({ ...ctx, role: "admin" } as any, input)).rejects.toThrow(/прав/);
  });
  it("commits recovery metadata before PUT and holds a fresh fence through PUT, final persistence and audit commit", async () => {
    state.assignments[0].assessorIds = []; // expertId-only remains sufficient.
    const result = await uploadAsset(ctx, input);
    expect(result).toEqual({ id: "file-1", name: "synthetic.pdf" });
    expect(state.events.indexOf("tx1:commit")).toBeLessThan(state.events.indexOf("s3:put:start"));
    expect(state.events.indexOf("s3:put:end")).toBeLessThan(state.events.indexOf("file:persist"));
    expect(state.events.indexOf("audit:persist")).toBeLessThan(state.events.indexOf("tx2:commit"));
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(state.objects.size).toBe(1); expect(state.files.size).toBe(1);
  });
  it.each(["failUpdate", "failAudit", "failCommit"] as const)("compensates %s failure while preserving a durable recovery reference", async failure => {
    if (failure === "failCommit") state.failCommit = 2; else state[failure] = true;
    await expect(uploadAsset(ctx, input)).rejects.toThrow();
    expect(state.events).toContain("s3:delete");
    expect(state.objects.size).toBe(0);
    expect(state.files.size).toBe(1);
    expect(state.events.indexOf("s3:delete")).toBeGreaterThan(state.events.indexOf("s3:put:end"));
  });
  it("surfaces failed compensation, keeps the exact object indexed, and lets retention retry cleanup", async () => {
    state.failUpdate = true; state.failDelete = true;
    await expect(uploadAsset(ctx, input)).rejects.toThrow(/cleanup|очист|retention|повтор/i);
    expect(state.objects.size).toBe(1); expect(state.files.size).toBe(1);
    expect([...state.files.values()][0].storageKey).toBe([...state.objects][0]);
    state.failDelete = false;
    await state.eraseModel();
    expect(state.objects.size).toBe(0); expect(state.files.size).toBe(0);
  });
  it("compensates an ambiguous PUT failure without losing the committed file reference", async () => {
    state.failPut = true;
    await expect(uploadAsset(ctx, input)).rejects.toThrow("PUT response lost");
    expect(state.objects.size).toBe(0); expect(state.files.size).toBe(1);
    // Model a server-side PUT completing even after our abort/delete returned.
    state.objects.add([...state.files.values()][0].storageKey);
    // Aborting a request or deleting once cannot prove the remote PUT is over.
    // Erasure must remain incomplete rather than remove its last recovery key.
    await expect(state.eraseModel()).rejects.toThrow(/pending|reconcil|не заверш/i);
    expect(state.files.size).toBe(1);
    expect(state.objects.size).toBe(1);
    expect(state.events).not.toContain("erase:done");
  });
  it("does not PUT if erasure wins the gap after preregistration", async () => {
    state.afterCommit = number => { if (number === 1) state.members.get("member-a").status = "blocked"; };
    await expect(uploadAsset(ctx, input)).rejects.toThrow();
    expect(state.events).not.toContain("s3:put:start"); expect(state.objects.size).toBe(0);
    await state.eraseModel();
    expect(state.files.size).toBe(0);
  });
  it("does not start a late PUT when an expired transaction callback resumes after erasure", async () => {
    state.readGate = deferred(); state.expireSecond = true;
    const upload = uploadAsset(ctx, input);
    const failure = expect(upload).rejects.toThrow("Transaction expired");
    await state.readStarted.promise;
    state.expiry.resolve();
    await failure;
    await state.eraseModel();
    state.readGate.resolve();
    await Promise.allSettled(state.running);
    expect(state.events).not.toContain("s3:put:start");
    expect(state.objects.size).toBe(0); expect(state.files.size).toBe(0);
  });
  it("keeps erasure fail-closed if durable PUT settlement itself fails", async () => {
    state.failSettlement = true;
    await expect(uploadAsset(ctx, input)).rejects.toThrow("Settlement persistence failed");
    await expect(state.eraseModel()).rejects.toThrow(/pending|reconcil/i);
    expect(state.files.size).toBe(1);
    expect([...state.receipts.values()][0].action).toBe("file.upload_pending");
  });
  it("serializes an already-started PUT before erasure so the last object write precedes cleanup", async () => {
    state.putGate = deferred();
    const upload = uploadAsset(ctx, input);
    await Promise.race([state.putStarted.promise, upload.then(() => { throw Error("PUT did not pause under the fence"); })]);
    const erasure = state.eraseModel();
    await Promise.resolve();
    expect(state.events).not.toContain("erase:block");
    state.putGate.resolve();
    await upload; await erasure;
    expect(state.events.indexOf("s3:put:end")).toBeLessThan(state.events.indexOf("erase:block"));
    expect(state.events.indexOf("tx2:commit")).toBeLessThan(state.events.indexOf("erase:block"));
    expect(state.objects.size).toBe(0); expect(state.files.size).toBe(0);
  });
  it.each(["blocked", "expired"])("refuses %s participants without S3 object writes", async condition => {
    const member = state.members.get("member-a");
    if (condition === "blocked") member.status = "blocked"; else member.createdAt = new Date("2026-08-21T12:00:00Z");
    await expect(uploadAsset(ctx, input)).rejects.toThrow();
    expect(state.events).not.toContain("s3:put:start");
  });
  it("preserves expert assignment restrictions", async () => {
    mocks.db.testAssignment.count.mockResolvedValue(0);
    await expect(uploadAsset(ctx, input)).rejects.toThrow(/назначен/i);
    expect(mocks.db.$transaction).not.toHaveBeenCalled(); expect(state.events).not.toContain("s3:put:start");
  });
});
