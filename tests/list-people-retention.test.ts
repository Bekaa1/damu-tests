import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Run the real listPeople, access helpers, expiry policy and score validity.
// Only Prisma/auth transports are modeled; no database or service is available.
const transport = vi.hoisted(() => {
  const forbidden = (name: string) => vi.fn<(...args: any[]) => Promise<any>>(async () => {
    throw Error(`Unmodeled transport: ${name}`);
  });
  return {
    db: {
      campaign: { findFirst: forbidden("campaign.findFirst") },
      membership: { findMany: forbidden("membership.findMany") },
      testAssignment: { findMany: forbidden("testAssignment.findMany") },
      finalReport: { findMany: forbidden("finalReport.findMany") },
      aiReport: { findMany: forbidden("aiReport.findMany") },
    },
    audit: forbidden("audit"),
    fetch: forbidden("fetch"),
  };
});
vi.mock("../apps/api/src/db", () => ({ db: transport.db, audit: transport.audit, json: (value: unknown) => value }));
vi.mock("../apps/api/src/auth", () => ({ auth: { api: { getSession: () => { throw Error("Auth service forbidden"); } } } }));
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor() { throw Error("Database service forbidden"); } } }));
import { listPeople } from "../apps/api/src/people";
import type { Context } from "../apps/api/src/access";

const instant = new Date("2027-02-28T10:15:30.123Z");
const registeredAt = new Date("2026-11-30T10:15:30.123Z");
const policies = [
  { purpose: "assessment", dataMode: "real" },
  { purpose: "pilot", dataMode: "real" },
  { purpose: "assessment", dataMode: "synthetic" },
];
function context(role = "admin", policy = policies[0]): Context {
  return {
    org: { id: "org", status: "active", ...policy },
    user: { id: `${role}-user`, demoOnly: false, platformAdmin: role === "superadmin" },
    member: { id: `${role}-member`, role },
    role,
  } as unknown as Context;
}
function member(id: string, overrides: Record<string, any> = {}): any {
  return {
    id, organizationId: "org", userId: `${id}-user`, role: "employee", status: "active",
    position: "Synthetic position", unit: "Synthetic unit", category: "Руководитель",
    profileRow: 55, block: "РФ", targetLevelModel: "В", consentAt: instant, consentVersion: "fixture",
    createdAt: new Date("2026-12-01T10:15:30.123Z"),
    user: {
      id: `${id}-user`, name: `Synthetic ${id}`, email: `${id}@example.test`, locale: "ru",
      mustChangePassword: false, platformAdmin: false, createdAt: new Date("2020-01-01T00:00:00Z"),
    },
    ...overrides,
  };
}
function assignment(membershipId: string, overrides: Record<string, any> = {}): any {
  return {
    id: `${membershipId}-assignment`, organizationId: "org", campaignId: "campaign", membershipId,
    expertId: "expert-member", assessorIds: [], testVersionId: "test-version",
    testVersion: { testId: "test", version: "holding-v1", test: { name: { ru: "Synthetic test" } }, _count: { questions: 14 } },
    attempts: [{
      id: `${membershipId}-attempt`, attemptNumber: 1, status: "completed", language: "ru", _count: { answers: 14 },
      results: [{
        id: `${membershipId}-result`, scoringKeyId: "scoring-key", createdAt: instant,
        result: { sum: 23, max: 28, privateMarker: `${membershipId}-stored-raw-score`, validity: { eligible: true } },
      }],
    }],
    ...overrides,
  };
}
function report(membershipId: string, overrides: Record<string, any> = {}): any {
  return {
    id: `${membershipId}-report`, membershipId, organizationId: "org", campaignId: "campaign", version: 2,
    status: "approved", matrixX: 3, matrixY: 4, conclusion: `${membershipId}-private-conclusion`, ...overrides,
  };
}

// Apply the actual query's predicates and nested select, not an eligibility stub.
// In particular platformAdmin is unavailable unless the real handler selects it.
function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (value === undefined) return true; // Prisma omits optional filters.
    if (key === "OR") return value.some((branch: any) => matches(row, branch));
    if (value && typeof value === "object") {
      if ("in" in value) return value.in.includes(row[key]);
      if ("has" in value) return row[key]?.includes(value.has);
      throw Error(`Unmodeled predicate: ${key}`);
    }
    return row[key] === value;
  });
}
const relations = new Set(["user", "testVersion", "attempts", "results", "test", "_count"]);
function project(row: any, args: any = {}): any {
  if (row == null) return row;
  if (Array.isArray(row)) return row.map(item => project(item, args));
  if (args === true) return structuredClone(row);
  if (args.select) return Object.fromEntries(Object.entries(args.select).filter(([, value]) => value).map(([key, value]) => [
    key, value === true ? structuredClone(row[key]) : project(row[key], value),
  ]));
  const result = Object.fromEntries(Object.entries(row).filter(([key]) => !relations.has(key)).map(([key, value]) => [key, structuredClone(value)]));
  for (const [key, value] of Object.entries(args.include ?? {})) result[key] = project(row[key], value);
  return result;
}
function harness() {
  const state = {
    members: [member("expired", { createdAt: registeredAt }), member("fresh")],
    assignments: [assignment("expired"), assignment("fresh")],
    reports: [report("expired"), report("fresh")],
    ai: ["expired", "fresh"].map(membershipId => ({ membershipId, organizationId: "org", campaignId: "campaign", status: "completed", createdAt: instant })),
    campaigns: [
      { id: "campaign", organizationId: "org", createdAt: new Date("2027-02-01T00:00:00Z") },
      { id: "older-campaign", organizationId: "org", createdAt: new Date("2027-01-01T00:00:00Z") },
      { id: "foreign-campaign", organizationId: "foreign", createdAt: instant },
    ],
  };
  transport.db.campaign.findFirst.mockImplementation(async (args: any) => state.campaigns
    .filter(row => matches(row, args.where)).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null);
  transport.db.membership.findMany.mockImplementation(async (args: any) => state.members
    .filter(row => matches(row, args.where)).sort((a, b) => +a.createdAt - +b.createdAt).map(row => project(row, args)));
  transport.db.testAssignment.findMany.mockImplementation(async (args: any) => state.assignments
    .filter(row => matches(row, args.where)).map(row => project(row, args)));
  transport.db.finalReport.findMany.mockImplementation(async (args: any) => state.reports
    .filter(row => matches(row, args.where)).sort((a, b) => b.version - a.version).map(row => project(row, args)));
  transport.db.aiReport.findMany.mockImplementation(async (args: any) => state.ai
    .filter(row => matches(row, args.where)).sort((a, b) => +b.createdAt - +a.createdAt).map(row => project(row, args)));
  return state;
}
let state: ReturnType<typeof harness>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(instant);
  vi.stubGlobal("fetch", transport.fetch);
  state = harness();
});
afterEach(() => {
  expect(transport.audit).not.toHaveBeenCalled();
  expect(transport.fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe.each(["admin", "expert"])("listPeople target eligibility for authorized %s", role => {
  it.each(policies)("omits expired-but-stored identity and raw results for $purpose/$dataMode without erasing rows", async policy => {
    // Deliberately retain every row, as when S3 deletion fails or a PUT is unresolved.
    // This is not a simulation or invocation of physical erasure.
    const before = structuredClone(state);
    const people = await listPeople(context(role, policy), "campaign");
    expect.soft(people.map(person => person.id)).toEqual(["fresh"]);
    const wire = JSON.stringify(people);
    for (const secret of ["Synthetic expired", "expired@example.test", "expired-stored-raw-score", "expired-result", "expired-report"])
      expect.soft(wire).not.toContain(secret);
    expect(people.find(person => person.id === "fresh")?.results[0].score).toEqual(state.assignments[1].attempts[0].results[0].result);
    expect(state, "eligibility must not delete or replace stored personal data with zeros").toEqual(before);
  });
  it.each(["blocked", "inactive"])("excludes %s targets, including protected users and staff", async status => {
    state.members = [member("fresh"), ...["employee", "admin", "expert"].map(targetRole => member(`hidden-${targetRole}`, { role: targetRole, status }))];
    const protectedTarget = member("protected", { createdAt: registeredAt, status });
    protectedTarget.user.platformAdmin = true;
    state.members.push(protectedTarget);
    state.assignments = state.members.map(person => assignment(person.id));
    const people = await listPeople(context(role), "campaign");
    expect(people.map(person => person.id)).toEqual(["fresh"]);
    expect(JSON.stringify(people)).not.toMatch(/hidden-|protected/);
  });
  it("preserves the active protected-platform account exception without returning the internal flag", async () => {
    state.members[0].user.platformAdmin = true;
    const people = await listPeople(context(role), "campaign");
    expect(people.map(person => person.id)).toEqual(["expired", "fresh"]);
    expect(people[0].results[0].score).toEqual(state.assignments[0].attempts[0].results[0].result);
    for (const person of people) {
      expect(Object.keys(person.user).sort()).toEqual(["id", "name", "email", "locale", "mustChangePassword"].sort());
      expect(person.user).not.toHaveProperty("platformAdmin");
    }
  });
});

it("uses the real clamped three-calendar-month boundary, not user age or fresh consent/activity", async () => {
  vi.setSystemTime(new Date(+instant - 1));
  expect((await listPeople(context(), "campaign")).map(person => person.id)).toEqual(["expired", "fresh"]);
  vi.setSystemTime(instant);
  expect((await listPeople(context(), "campaign")).map(person => person.id)).toEqual(["fresh"]);
});
it("keeps the full fresh-person DTO, actual score and report projection unchanged", async () => {
  const people = await listPeople(context(), "campaign");
  const fresh = state.members[1];
  const { user, ...membership } = fresh;
  expect(people.find(person => person.id === "fresh")).toEqual({
    ...membership,
    user: { id: user.id, name: user.name, email: user.email, locale: user.locale, mustChangePassword: user.mustChangePassword },
    total: 1, completed: 1, progress: 100, status: "completed", expertId: "expert-member",
    report: { id: "fresh-report", status: "approved", matrixX: 3, matrixY: 4, version: 2 }, aiStatus: "completed",
    results: [{
      resultId: "fresh-result", testId: "test", testVersionId: "test-version", version: "holding-v1",
      scoringKeyId: "scoring-key", language: "ru", name: { ru: "Synthetic test" },
      score: state.assignments[1].attempts[0].results[0].result,
    }],
  });
});
it("preserves active staff and unassigned tenant members for an admin without importing foreign/campaign payloads", async () => {
  state.members = [member("old-admin", { role: "admin", createdAt: registeredAt }), member("old-expert", { role: "expert", createdAt: registeredAt }), member("fresh"), member("unassigned"), member("foreign", { organizationId: "foreign" })];
  state.assignments.push(assignment("fresh", { campaignId: "older-campaign", attempts: [] }), assignment("foreign", { organizationId: "foreign" }));
  state.reports.push(report("fresh", { campaignId: "older-campaign", id: "wrong-campaign-report", version: 99 }));
  state.ai.push({ membershipId: "fresh", organizationId: "org", campaignId: "older-campaign", status: "failed", createdAt: new Date(+instant + 1) });
  const people = await listPeople(context(), "campaign");
  expect(people.map(person => person.id)).toEqual(["old-admin", "old-expert", "fresh", "unassigned"]);
  expect(people.filter(person => person.role !== "employee").map(person => person.status)).toEqual(["unassigned", "unassigned"]);
  expect(people.find(person => person.id === "fresh")).toMatchObject({ total: 1, completed: 1, aiStatus: "completed", report: { id: "fresh-report" } });
  expect(people.find(person => person.id === "unassigned")).toMatchObject({ total: 0, completed: 0, status: "unassigned", results: [] });
  expect(JSON.stringify(people)).not.toMatch(/foreign|wrong-campaign/);
});
it("preserves tenant/campaign-specific primary-expert and assessor scopes, with no protected-target bypass", async () => {
  state.members = ["primary", "assessor", "other-expert", "other-campaign", "protected-unassigned"].map(id => member(id));
  state.members.push(member("foreign", { organizationId: "foreign" }));
  state.members.find(person => person.id === "protected-unassigned")!.user.platformAdmin = true;
  state.assignments = [
    assignment("primary"), assignment("assessor", { expertId: "someone-else", assessorIds: ["expert-member"] }),
    assignment("other-expert", { expertId: "someone-else" }), assignment("other-campaign", { campaignId: "older-campaign" }),
    assignment("protected-unassigned", { expertId: "someone-else" }), assignment("foreign", { organizationId: "foreign" }),
  ];
  const people = await listPeople(context("expert"), "campaign");
  expect(people.map(person => person.id)).toEqual(["primary", "assessor"]);
  expect(people.map(person => person.results[0].score)).toEqual(state.assignments.slice(0, 2).map(task => task.attempts[0].results[0].result));
  expect(transport.db.testAssignment.findMany).toHaveBeenCalledWith({
    where: { organizationId: "org", campaignId: "campaign", OR: [{ expertId: "expert-member" }, { assessorIds: { has: "expert-member" } }] },
    select: { membershipId: true },
  });
});
it("does not broaden an expert with no assignments to the whole tenant", async () => {
  state.assignments = state.assignments.map(task => ({ ...task, expertId: "someone-else" }));
  expect(await listPeople(context("expert"), "campaign")).toEqual([]);
});
it("keeps implicit campaign selection tenant-local and latest", async () => {
  state.assignments.push(assignment("fresh", { campaignId: "older-campaign", attempts: [] }));
  const people = await listPeople(context());
  expect(people.map(person => person.id)).toEqual(["fresh"]);
  expect(people[0]).toMatchObject({ total: 1, completed: 1, report: { id: "fresh-report" } });
  expect(transport.db.campaign.findFirst).toHaveBeenCalledWith({ where: { organizationId: "org" }, orderBy: { createdAt: "desc" } });
});
it("rejects a foreign campaign before loading any target memberships", async () => {
  await expect(listPeople(context(), "foreign-campaign")).rejects.toThrow("Кампания не найдена");
  expect(transport.db.membership.findMany).not.toHaveBeenCalled();
});
it("preserves an authorized superadmin's selected-tenant scope but not expired targets", async () => {
  state.members.push(member("foreign", { organizationId: "foreign" }));
  expect((await listPeople(context("superadmin"), "campaign")).map(person => person.id)).toEqual(["fresh"]);
});
it("still denies an employee caller before any database reads", async () => {
  await expect(listPeople(context("employee"), "campaign")).rejects.toThrow("Недостаточно прав");
  expect(transport.db.campaign.findFirst).not.toHaveBeenCalled();
  expect(transport.db.membership.findMany).not.toHaveBeenCalled();
});
