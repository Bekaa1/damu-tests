import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory synthetic rows only. Every unstubbed DB/provider call throws.
const m = vi.hoisted(() => ({
  rows: new Map<string, any>(), members: new Map<string, any>(), org: {} as any,
  people: [] as any[], assignments: [] as any[], events: [] as string[], logs: [] as any[], artifacts: [] as any[],
  render: vi.fn(), layout: vi.fn(), policyIssues: [] as any[], fetch: vi.fn(),
  db: {} as any, tx: {} as any, fallbackQueue: vi.fn(), beforeTransaction: undefined as undefined | (() => void),
}));
vi.mock("../apps/api/src/db", () => ({ db: m.db, json: (x: any) => x, audit: async (...args: any[]) => { m.events.push("GLOBAL audit"); m.logs.push(args); } }));
vi.mock("../apps/api/src/auth", () => ({ auth: { api: { getSession: () => { throw Error("Unexpected auth service"); } } } }));
vi.mock("bullmq", () => ({ Queue: class { on() {} add = m.fallbackQueue; }, Worker: class { on() {} } }));
vi.mock("../apps/api/src/people", () => ({ getCampaign: async () => ({ id: "campaign", startsAt: new Date("2026-10-01"), endsAt: new Date("2026-11-01"), country: "KZ", name: "Synthetic campaign" }), listPeople: async () => m.people }));
vi.mock("../apps/api/src/competencies", () => ({ competencyEvidence: async () => null }));
vi.mock("../apps/api/src/cohort", () => ({ campaignRanks: async () => new Map() }));
vi.mock("../apps/api/src/norms", () => ({ normMetadata: () => null }));
vi.mock("../apps/api/src/report-layout", () => ({ professionalReportTemplate: (...args: any[]) => m.layout(...args), reportCss: "" }));
vi.mock("../apps/api/src/exports", () => ({ renderPdf: (...args: any[]) => m.render(...args) }));
vi.mock("../packages/core/report-policy", async original => ({ ...await original<any>(), reportContentIssues: () => m.policyIssues }));

import * as generatedReports from "../apps/api/src/generated-reports";
import { createGeneratedReport, generateReport, getGeneratedReport, listGeneratedReports, reportReview, saveReportReview } from "../apps/api/src/generated-reports";
import { makeFallbackAvailable, persistReportPdf } from "../apps/api/src/report-lifecycle";
import { dataReport } from "../packages/core/report-fallback";

const ctx = (role = "admin") => ({ org: m.org, user: { id: "synthetic-actor", demoOnly: false }, member: { id: "synthetic-expert", role }, role }) as any;
function person(id: string) {
  return { id, name: `Synthetic ${id}`, role: "employee", position: "Synthetic position", unit: "Synthetic unit", category: "Synthetic", status: "completed", completed: 1, total: 1, user: { name: `Synthetic ${id}` },
    results: [{ testId: "verbal", testVersionId: "verbal-v1", version: "1", resultId: `result-${id}`, language: "ru", name: { ru: "Вербальный тест" }, score: { total: 5, maximum: 10 } }], observations: [], expert: null };
}
function addMembers(ids: string[]) {
  for (const id of ids) m.members.set(id, { id, organizationId: "org", userId: `user-${id}`, role: "employee", status: "active", createdAt: new Date(), user: { id: `user-${id}`, platformAdmin: false }, organization: m.org });
}
function report(ids = ["subject-1"], kind = "individual"): any {
  addMembers(ids);
  const value = { id: "report", organizationId: "org", campaignId: "campaign", membershipId: kind === "individual" ? ids[0] : null, participantIds: [...ids], kind, language: "ru", status: "pending", generationMode: "ai", readyAt: null, createdAt: new Date(), updatedAt: new Date(), createdBy: "synthetic-actor", snapshot: { organization: { name: "Synthetic organization", matrixConfig: {} }, campaign: { id: "campaign", name: "Synthetic campaign" }, people: ids.map(person) }, presentationEdits: {}, reviewIssues: [], content: null, assessmentCompletedAt: new Date() };
  m.rows.set(value.id, value); return value;
}
function failClosed(name: string, methods: Record<string, any>) { return new Proxy(methods, { get: (target, key: string) => key in target ? target[key] : () => { throw Error(`Unstubbed DB call ${name}.${key}`); } }); }
function client(inTx: boolean) {
  const prefix = inTx ? "TX" : "GLOBAL";
  const event = (name: string) => m.events.push(`${prefix} ${name}`);
  const matches = (r: any, where: any) => r && (!where?.id || typeof where.id !== "string" || r.id === where.id) && (!where?.organizationId || r.organizationId === where.organizationId);
  const project = (r: any, select?: any) => !r ? null : structuredClone(select ? Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, r[k]])) : r);
  const read = async ({ where, select }: any) => { event("report.read"); return project([...m.rows.values()].find(r => matches(r, where)) || null, select); };
  return failClosed(prefix, {
    membership: failClosed("membership", { findFirst: async ({ where }: any) => [...m.members.values()].find(r => matches(r, where)) || null, findMany: async ({ where }: any) => { event("members.read"); return [...m.members.values()].filter(r => (!where.id?.in || where.id.in.includes(r.id)) && (!where.organizationId || r.organizationId === where.organizationId)); }, findUnique: async ({ where }: any) => m.members.get(where.id) || null }),
    organization: failClosed("organization", { findUnique: async ({ where }: any) => where.id === m.org.id ? m.org : null }),
    campaign: failClosed("campaign", { findFirst: async ({ where }: any) => where.organizationId === "org" && where.id === "campaign" ? { id: "campaign", organizationId: "org" } : null }),
    generatedReport: failClosed("generatedReport", {
      findFirst: read, findUnique: read, findUniqueOrThrow: async (args: any) => { const r = await read(args); if (!r) throw Error("Report absent"); return r; },
      findMany: async ({ select }: any) => [...m.rows.values()].map(r => project(r, select)),
      create: async ({ data }: any) => { event("report.create"); const r = { ...data, id: "created-report", createdAt: new Date(), updatedAt: new Date(), status: "pending", readyAt: null }; m.rows.set(r.id, r); return r; },
      updateMany: async ({ where, data }: any) => { event("report.update"); const r = m.rows.get(where.id); if (!matches(r, where)) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
      update: async ({ where, data }: any) => { event("report.update"); const r = m.rows.get(where.id); if (!r) throw Error("Report absent"); Object.assign(r, data); return r; },
    }),
    reportArtifact: failClosed("reportArtifact", { create: async ({ data }: any) => { event("artifact.create"); m.artifacts.push(data); return data; } }),
    auditLog: failClosed("auditLog", { create: async ({ data }: any) => { event("audit"); m.logs.push(data); return data; } }),
    user: failClosed("user", { findMany: async () => [{ id: "synthetic-actor", name: "Synthetic actor" }] }),
    testAssignment: failClosed("testAssignment", { findMany: async () => m.assignments }),
    frozenNorm: failClosed("frozenNorm", { findFirst: async () => null }), scoringKey: failClosed("scoringKey", { findMany: async () => [] }),
    expertObservation: failClosed("expertObservation", { findMany: async () => [] }), finalReport: failClosed("finalReport", { findMany: async () => [] }),
    platformSettings: failClosed("platformSettings", { findUnique: async () => null }),
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => { const sql = strings.join("?"); const table = sql.match(/FROM (\w+)/)?.[1]; event(`lock.${table}:${values[0]}`); if (table === "users") return [...m.members.values()].some(r => r.userId === values[0]) ? [{ id: values[0] }] : []; if (table === "memberships") return m.members.has(values[0]) ? [{ id: values[0] }] : []; return m.rows.has(values[0]) ? [{ id: values[0] }] : []; },
    $queryRawUnsafe: async (sql: string, id: string) => { event(`lock.${sql.match(/FROM (\w+)/)?.[1]}:${id}`); return [{ id }]; },
  });
}
beforeEach(() => {
  vi.clearAllMocks(); m.rows.clear(); m.members.clear(); m.events = []; m.logs = []; m.artifacts = []; m.assignments = []; m.policyIssues = []; m.beforeTransaction = undefined;
  m.org = { id: "org", name: "Synthetic organization", matrixConfig: {}, status: "active", purpose: "assessment", dataMode: "synthetic" }; m.people = [person("subject-1")];
  Object.assign(m.db, client(false)); m.tx = client(true);
  m.db.$transaction = async (op: any) => { m.beforeTransaction?.(); m.events.push("TX.begin"); const result = await op(m.tx); m.events.push("TX.commit"); return result; };
  m.layout.mockReturnValue({ html: "<p>Synthetic PDF</p>", label: "Synthetic" }); m.render.mockResolvedValue(Buffer.from("%PDF synthetic"));
  vi.stubGlobal("fetch", (...args: any[]) => { m.fetch(...args); throw Error("Network forbidden"); });
});

const inaccessible = async (row: any) => {
  await expect(getGeneratedReport(ctx(), row.id)).rejects.toThrow();
  expect(await listGeneratedReports(ctx(), "campaign")).toEqual([]);
  expect(m.logs).toEqual([]);
};
describe("Saved report scope is complete, fresh and fail closed", () => {
  it("keeps an authorized individual n=1 visible without exposing its snapshot in the list", async () => {
    const row = report(); const list = await listGeneratedReports(ctx(), "campaign");
    expect(list[0].participantCount).toBe(1); expect(list[0]).not.toHaveProperty("snapshot"); expect((await getGeneratedReport(ctx(), row.id)).id).toBe(row.id);
  });
  it.each(["expired", "blocked", "foreign", "missing"])("hides and denies a %s subject even for an admin", async kind => {
    const row = report(); const member = m.members.get("subject-1");
    if (kind === "expired") member.createdAt = new Date("2000-01-01");
    if (kind === "blocked") member.status = "blocked";
    if (kind === "foreign") member.organizationId = "other-org";
    if (kind === "missing") m.members.delete(member.id);
    await inaccessible(row);
  });
  it("uses frozen people and the membership column, not just the declared array", async () => {
    const row = report(["a", "b", "c", "d", "e"], "team"); row.participantIds = ["a"];
    m.members.get("e").status = "blocked"; await inaccessible(row);
    m.members.get("e").status = "active"; row.membershipId = "extra-subject"; await inaccessible(row);
  });
  it("does not let duplicate frozen people or five declared IDs inflate a small team", async () => {
    const row = report(["a", "b", "c", "d", "e"], "team"); row.snapshot.people = [...row.snapshot.people.slice(0, 4), row.snapshot.people[0]]; await inaccessible(row);
  });
  it.each(["no-snapshot", "no-people", "bad-person", "bad-declared", "wrong-campaign", "individual-mismatch"])("denies malformed scope: %s", async kind => {
    const row: any = report();
    if (kind === "no-snapshot") delete row.snapshot;
    if (kind === "no-people") row.snapshot.people = [];
    if (kind === "bad-person") row.snapshot.people[0].id = 123;
    if (kind === "bad-declared") row.participantIds = [null];
    if (kind === "wrong-campaign") row.snapshot.campaign.id = "foreign-campaign";
    if (kind === "individual-mismatch") row.membershipId = "other";
    await inaccessible(row);
  });
  it("preserves expert assignments across every actual frozen subject", async () => {
    const row = report(["a", "b", "c", "d", "e"], "team"); row.participantIds = ["a"]; m.assignments = [{ membershipId: "a" }];
    await expect(getGeneratedReport(ctx("expert"), row.id)).rejects.toThrow(); expect(await listGeneratedReports(ctx("expert"), "campaign")).toEqual([]);
  });
  it("denies review payloads for expired sources before collecting editable text", async () => {
    const row = report(); row.status = "manual_review"; m.assignments = [{ membershipId: "subject-1" }]; m.members.get("subject-1").createdAt = new Date("2000-01-01");
    await expect(reportReview(ctx("expert"), row.id)).rejects.toThrow(); expect(m.logs).toEqual([]);
  });
  it("counts distinct frozen people and fences the whole sorted union without duplicates", async () => {
    const row = report(["e", "c", "a", "d", "b"], "team"); addMembers(["extra"]);
    row.participantIds = ["a", "a"]; row.membershipId = "extra"; row.snapshot.people.push(row.snapshot.people[0]);
    const list = await listGeneratedReports(ctx(), "campaign"); expect(list[0].participantCount).toBe(5); expect(list[0]).not.toHaveProperty("snapshot");
    await getGeneratedReport(ctx(), row.id);
    const locks = m.events.filter(e => e.includes("lock."));
    expect(locks).toEqual([
      ...["a", "b", "c", "d", "e", "extra"].map(id => `TX lock.users:user-${id}`),
      ...["a", "b", "c", "d", "e", "extra"].map(id => `TX lock.memberships:${id}`),
      "TX lock.organizations:org", "TX lock.generated_reports:report",
    ]);
  });
  it.each(["suspended", "orphaned"])("hides a report when its organization becomes %s", async kind => {
    const row = report(); if (kind === "suspended") m.org.status = "suspended"; else m.org.id = "different-org"; await inaccessible(row);
  });
  it("does not return existing PDF-ready reports from a newly restricted pilot", async () => { const row = report(); m.org.purpose = "pilot"; row.status = "completed"; row.readyAt = new Date(); await inaccessible(row); });
});

describe("Download integration can keep artifact lookup and audit inside authorized access", () => {
  it("provides an authorized transaction callback after a fresh complete-subject check", async () => {
    const row = report(); const callback = vi.fn(async (tx: any, current: any) => {
      expect(tx).toBe(m.tx); expect(current.id).toBe(row.id);
      await tx.auditLog.create({ data: { organizationId: "org", actorId: "synthetic-actor", action: "generated_report.pdf_exported", entityId: row.id } });
      return Buffer.from("%PDF synthetic read");
    });
    const bytes = await (generatedReports as any).withGeneratedReportAccess(ctx(), row.id, callback);
    expect(bytes.toString()).toBe("%PDF synthetic read"); expect(callback).toHaveBeenCalledOnce(); expect(m.events).toContain("TX.commit");
  });
  it("never enters the artifact callback after expiration in a download preparation gap", async () => {
    const row = report(); await getGeneratedReport(ctx(), row.id); m.members.get("subject-1").status = "blocked";
    const callback = vi.fn(); await expect((generatedReports as any).withGeneratedReportAccess(ctx(), row.id, callback)).rejects.toThrow(); expect(callback).not.toHaveBeenCalled();
  });
  it("keeps both role and expert-assignment restrictions on the download callback", async () => {
    const row = report(); const callback = vi.fn();
    await expect((generatedReports as any).withGeneratedReportAccess(ctx("employee"), row.id, callback)).rejects.toThrow();
    await expect((generatedReports as any).withGeneratedReportAccess(ctx("expert"), row.id, callback)).rejects.toThrow(); expect(callback).not.toHaveBeenCalled();
  });
});

describe("Report writes share the erasure fence", () => {
  it("persists a new snapshot and its request audit using the subject transaction before org locks", async () => {
    addMembers(["subject-1"]); await createGeneratedReport(ctx(), { campaignId: "campaign", membershipId: "subject-1", kind: "individual", language: "ru" });
    const write = m.events.indexOf("TX report.create"), user = m.events.indexOf("TX lock.users:user-subject-1"), member = m.events.indexOf("TX lock.memberships:subject-1"), org = m.events.indexOf("TX lock.organizations:org");
    expect(user).toBeGreaterThan(-1); expect(member).toBeGreaterThan(user); expect(org).toBeGreaterThan(member); expect(write).toBeGreaterThan(org);
    expect(m.logs.some(l => l.action === "generated_report.requested")).toBe(true); expect(m.events.filter(e => e.startsWith("GLOBAL ") && /audit|create|update/.test(e))).toEqual([]);
  });
  it("rejects a four-person team before persisting a snapshot or request audit", async () => {
    m.people = ["a", "b", "c", "d"].map(person); addMembers(["a", "b", "c", "d"]);
    await expect(createGeneratedReport(ctx(), { campaignId: "campaign", kind: "team", language: "ru" })).rejects.toThrow(); expect(m.rows.size).toBe(0); expect(m.logs).toEqual([]);
  });
  it("does not save a captured snapshot when erasure wins before the final fence", async () => {
    addMembers(["subject-1"]); m.beforeTransaction = () => m.members.clear();
    await expect(createGeneratedReport(ctx(), { campaignId: "campaign", membershipId: "subject-1", kind: "individual", language: "ru" })).rejects.toThrow(); expect(m.rows.size).toBe(0); expect(m.logs).toEqual([]);
  });
  it("locks users and members before the report row and saves artifact, content and availability audit on that tx", async () => {
    const row = report(); await persistReportPdf(row.id, dataReport(row.snapshot, "ru"), "data");
    expect(m.artifacts).toHaveLength(1); const member = m.events.indexOf("TX lock.memberships:subject-1"), lock = m.events.indexOf("TX lock.generated_reports:report");
    expect(member).toBeGreaterThan(-1); expect(lock).toBeGreaterThan(member); expect(m.events.indexOf("TX artifact.create")).toBeGreaterThan(lock);
    expect(m.events.filter(e => e.startsWith("GLOBAL ") && /audit|create|update/.test(e))).toEqual([]);
  });
  it("locks current organization policy after the members but before the report and artifact writes", async () => {
    const row = report(); await persistReportPdf(row.id, dataReport(row.snapshot, "ru"), "data");
    const member = m.events.indexOf("TX lock.memberships:subject-1"), org = m.events.indexOf("TX lock.organizations:org"), reportLock = m.events.indexOf("TX lock.generated_reports:report");
    expect(org).toBeGreaterThan(member); expect(reportLock).toBeGreaterThan(org); expect(m.events.indexOf("TX artifact.create")).toBeGreaterThan(reportLock);
  });
  it("accepts JSONB object-key reordering without treating unchanged frozen data as a new scope", async () => {
    const row = report();
    m.render.mockImplementation(async () => {
      row.snapshot = Object.fromEntries(Object.entries(row.snapshot).reverse());
      return Buffer.from("%PDF unchanged snapshot");
    });
    await persistReportPdf(row.id, dataReport(row.snapshot, "ru"), "data");
    expect(m.artifacts).toHaveLength(1);
  });
  it("cannot publish bytes or an audit after erasure wins during rendering", async () => {
    const row = report(); m.render.mockImplementation(async () => { m.members.clear(); m.rows.clear(); return Buffer.from("%PDF stale"); });
    await expect(persistReportPdf(row.id, dataReport(row.snapshot, "ru"), "data")).rejects.toThrow(); expect(m.artifacts).toEqual([]); expect(m.logs).toEqual([]);
  });
  it("does not render or save an old queued fallback with expired or omitted subjects", async () => {
    const row = report(["a", "b", "c", "d", "e"], "team"); row.participantIds = ["a"]; m.members.get("e").createdAt = new Date("2000-01-01");
    await expect(makeFallbackAvailable(row.id)).rejects.toThrow(); expect(m.layout).not.toHaveBeenCalled(); expect(m.render).not.toHaveBeenCalled(); expect(m.logs).toEqual([]); expect(m.artifacts).toEqual([]);
  });
  it("does not resurrect review content/audits when erasure wins the manual-review hold gap", async () => {
    const row = report(); m.policyIssues = [{ code: "synthetic-review", path: "summary", text: "Synthetic source" }]; m.beforeTransaction = () => { m.members.clear(); m.rows.clear(); };
    await expect(persistReportPdf(row.id, dataReport(row.snapshot, "ru"), "data")).rejects.toThrow(); expect(m.logs).toEqual([]); expect(m.rows.size).toBe(0);
  });
  it("does not claim an expert edit after its subject is erased in the read/claim gap", async () => {
    const row = report(); row.status = "manual_review"; m.assignments = [{ membershipId: "subject-1" }]; let txs = 0;
    m.beforeTransaction = () => { if (++txs === 2) { m.members.clear(); m.rows.clear(); } };
    // On the unfenced implementation the audit hook reproduces the same gap.
    m.render.mockImplementation(async () => { throw Error("Must not render an erased edit"); });
    await expect(saveReportReview(ctx("expert"), row.id, { updatedAt: row.updatedAt.toISOString(), content: dataReport(row.snapshot, "ru"), presentationEdits: {} })).rejects.toThrow();
    expect(m.events.filter(e => e === "GLOBAL report.update")).toEqual([]); expect(m.logs.every(l => l.action !== "generated_report.reviewed")).toBe(true);
  });
  it.each(["expired", "blocked", "pilot", "suspended"])("rechecks %s policy after rendering but before persisting bytes/content", async kind => {
    const row = report(); m.render.mockImplementation(async () => {
      if (kind === "expired") m.members.get("subject-1").createdAt = new Date("2000-01-01");
      if (kind === "blocked") m.members.get("subject-1").status = "blocked";
      if (kind === "pilot") m.org.purpose = "pilot";
      if (kind === "suspended") m.org.status = "suspended";
      return Buffer.from("%PDF stale policy");
    });
    await expect(persistReportPdf(row.id, dataReport(row.snapshot, "ru"), "data")).rejects.toThrow(); expect(m.artifacts).toEqual([]); expect(m.logs).toEqual([]); expect(row.content).toBeNull();
  });
  it("stores valid manual-review content and its audit on the subject transaction without rendering", async () => {
    const row = report(); m.policyIssues = [{ code: "synthetic-review", path: "summary", text: "Synthetic source" }];
    await persistReportPdf(row.id, dataReport(row.snapshot, "ru"), "data");
    expect(row.status).toBe("manual_review"); expect(m.logs[0].action).toBe("generated_report.review_required"); expect(m.render).not.toHaveBeenCalled();
    expect(m.events.filter(e => e.startsWith("GLOBAL ") && /audit|create|update/.test(e))).toEqual([]);
  });
  it("does not append reviewed source text after erasure wins following successful PDF persistence", async () => {
    const row = report(); row.status = "manual_review"; m.assignments = [{ membershipId: "subject-1" }]; let txs = 0;
    m.beforeTransaction = () => { if (++txs === 4) { m.members.clear(); m.rows.clear(); m.logs = []; m.artifacts = []; } };
    await expect(saveReportReview(ctx("expert"), row.id, { updatedAt: row.updatedAt.toISOString(), content: dataReport(row.snapshot, "ru"), presentationEdits: {} })).rejects.toThrow();
    expect(m.rows.size).toBe(0); expect(m.logs).toEqual([]); expect(m.artifacts).toEqual([]);
  });
  it("keeps current-policy external-AI-off jobs on the local PDF path", async () => {
    const row = report(); await generateReport(row.id);
    expect(m.render).toHaveBeenCalledOnce(); expect(row.status).toBe("completed"); expect(row.generationMode).toBe("data"); expect(m.fetch).not.toHaveBeenCalled(); expect(m.artifacts).toHaveLength(1);
  });
  it("drops an old provider job with an expired frozen subject before settings, fallback or network", async () => {
    const row = report(); m.members.get("subject-1").status = "blocked"; await generateReport(row.id);
    expect(m.layout).not.toHaveBeenCalled(); expect(m.render).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled(); expect(m.logs).toEqual([]); expect(m.artifacts).toEqual([]);
  });
});
