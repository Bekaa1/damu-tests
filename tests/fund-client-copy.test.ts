import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_TEXT, CONSENT_VERSION } from "../packages/core/assessment-policy";
import { METHOD_PASSPORTS } from "../packages/core/method-passports";
import { consentPolicy, hasCurrentConsent } from "../packages/core/pilot";
import { participantDataExpired, participantDeletionDate } from "../packages/core/data-policy";

// Exercise the real startup updater, but forbid Prisma/provider connections.
const fixture = vi.hoisted(() => {
  const forbidden = () => vi.fn<(...args: any[]) => Promise<any>>(async () => { throw Error("Unstubbed metadata database call"); });
  return { db: {
    testVersion: { findMany: forbidden(), update: forbidden(), updateMany: forbidden() },
    test: { update: forbidden() }, question: { update: forbidden() },
    auditLog: { create: forbidden() }, $transaction: forbidden(),
  } };
});
vi.mock("../apps/api/src/db", () => ({ db: fixture.db, json: (value: unknown) => JSON.parse(JSON.stringify(value)) }));
import { updateMethodMetadata } from "../apps/api/src/method-metadata";

const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
const sjt = () => structuredClone(catalog.find((form: any) => form.id === "situations"));
const rights = "Авторская разработка исполнителя, права принадлежат исполнителю";
const source = "Авторская разработка исполнителя — Управленческие ситуации (14 кейсов)";
const deletionSentence = "Данные удаляются через 3 месяца после регистрации на платформе";
const previousRights = {
  ru: "Материалы предоставлены в документах заказчика от 26.10.2026. Публичная лицензия на эти тексты не заявлена; права на использование и распространение согласуются с правообладателем.",
  kk: "Материалдар тапсырыс берушінің 26.10.2026 құжаттарында берілген. Бұл мәтіндерге ашық лицензия жарияланбаған; пайдалану және тарату құқықтары құқық иесімен келісіледі.",
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

beforeEach(() => vi.clearAllMocks());

function metadataDatabase() {
  const form = sjt();
  // Model what is already persisted before this release, independently of the new catalog.
  form.delivery.passport.rights = previousRights;
  delete form.delivery.passport.rightsTranslationStatus;
  form.delivery.passportRevision = "2026-11-19";
  form.instructions.kk = form.instructions.kk.replaceAll("Ең ықтималдығы аз", "Ең аз ықтимал");
  let rows = [
    ...catalog.filter((entry: any) => entry.id !== "situations").map((entry: any) => ({
      id: `${entry.id}-v2`, testId: entry.id, version: entry.version,
      delivery: entry.delivery, instructions: entry.instructions, limitations: entry.limitations, questions: entry.questions,
    })),
    { id: "situations-v2", testId: "situations", version: "2.0-2026-10-26", delivery: form.delivery,
      instructions: form.instructions, limitations: form.limitations, questions: form.questions,
      translationStatus: "working_translation", approvedBy: null, approvedAt: null },
    { id: "situations-draft-16", testId: "situations", version: "draft-16", delivery: { passportRevision: "legacy" }, questions: [] },
  ];
  rows = structuredClone(rows);
  let tests: Record<string, any> = { situations: { id: "situations", source: "Документы заказчика от 26.10.2026 — Управленческие ситуации" } };
  let audits: any[] = [];
  const state = { failAudit: false, concurrentChange: false, get rows() { return rows; }, get tests() { return tests; }, get audits() { return audits; } };
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === "object") {
      if ("in" in value) return value.in.includes(row[key]);
      if ("equals" in value) return digest(row[key]) === digest(value.equals);
    }
    return row[key] === value;
  });
  fixture.db.testVersion.findMany.mockImplementation(async ({ where }: any) => structuredClone(rows.filter(row => matches(row, where)).map(row => ({ ...row, test: tests[row.testId] }))));
  fixture.db.testVersion.update.mockImplementation(async ({ where, data }: any) => {
    const row = rows.find(entry => matches(entry, where));
    if (!row) throw Error("Missing metadata row");
    Object.assign(row, structuredClone(data)); return structuredClone(row);
  });
  fixture.db.testVersion.updateMany.mockImplementation(async ({ where, data }: any) => {
    const selected = rows.filter(row => matches(row, where));
    selected.forEach(row => Object.assign(row, structuredClone(data)));
    return { count: selected.length };
  });
  fixture.db.test.update.mockImplementation(async ({ where, data }: any) => {
    Object.assign(tests[where.id], structuredClone(data)); return structuredClone(tests[where.id]);
  });
  fixture.db.question.update.mockImplementation(async () => { throw Error("This metadata change must not rewrite questions"); });
  fixture.db.auditLog.create.mockImplementation(async ({ data }: any) => {
    if (state.failAudit) throw Error("Metadata audit unavailable");
    const audit = { id: `audit-${audits.length + 1}`, ...structuredClone(data) }; audits.push(audit); return audit;
  });
  fixture.db.$transaction.mockImplementation(async (operation: any) => {
    // A separate writer commits after discovery, before our transaction starts.
    if (state.concurrentChange) {
      rows.find(row => row.id === "situations-v2")!.delivery.newerConcurrentMetadata = true;
      state.concurrentChange = false;
    }
    const before = structuredClone({ rows, tests, audits });
    try { return await operation(fixture.db); } catch (error) {
      ({ rows, tests, audits } = before); throw error;
    }
  });
  return state;
}

describe("Fund-facing canonical SJT copy", () => {
  it("states the contractor's exact SJT rights without inventing approval", () => {
    expect(METHOD_PASSPORTS.situations.rights.ru).toBe(rights);
    expect(sjt().delivery.passport.rights.ru).toBe(rights);
    expect(sjt().source).toBe(source);
    expect(METHOD_PASSPORTS.situations.validation.ru).toContain("проверяется отдельно");
  });

  it("explicitly keeps source-language fallback when no authored KK rights translation was supplied", () => {
    expect(METHOD_PASSPORTS.situations.rights.kk).toBe(rights);
    expect(METHOD_PASSPORTS.situations).toHaveProperty("rightsTranslationStatus", "source_language_fallback");
    expect(sjt().delivery.passport).toEqual(METHOD_PASSPORTS.situations);
  });

  it("uses the same existing Kazakh LEAST label in canonical instructions, test and training", () => {
    expect(sjt().questions).toHaveLength(14);
    expect(sjt().instructions.kk).toContain("«Ең ықтималдығы аз» —");
    expect(sjt().instructions.kk).not.toContain("Ең аз ықтимал");
    // No runner change is needed: both existing rendered headings are already canonical.
    const runner = readFileSync("apps/web/components/test-runner.tsx", "utf8");
    expect(runner.match(/t\("Наименее вероятно", "Ең ықтималдығы аз"\)/g)).toHaveLength(2);
  });

  it("preserves every non-target instrument, case, option ID, key, practice and draft literal", () => {
    // Frozen from clean parent baseline 1b95ae5 before any implementation changes.
    const protectedCatalog = structuredClone(catalog);
    const form = protectedCatalog.find((entry: any) => entry.id === "situations");
    delete form.source; delete form.instructions.kk; delete form.delivery.passport.rights;
    delete form.delivery.passport.rightsTranslationStatus; delete form.delivery.passportRevision;
    expect(digest(protectedCatalog)).toBe("28dfe3d59d36ff51507bd27d0d03041cad0cc3a3c787c68da4950402b3f9e557");
    expect(digest(Object.fromEntries(Object.entries(METHOD_PASSPORTS).filter(([id]) => id !== "situations")))).toBe("6011c3386c4278e9bc0989f64556e3609c6d446727062a98f7f9da3f07b8467a");
    const draft = readFileSync("data/review/sjt-16-draft.json", "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(draft).digest("hex")).toBe("c75aff021d60fa1264ce1a4806e0f195845db9e5928359ce1b054d146f9d5b65");
  });
});

describe("startup persisted delivery metadata", () => {
  it("upgrades the already-saved canonical SJT passport/source/instructions once and audits only metadata", async () => {
    const state = metadataDatabase();
    const before = structuredClone(state.rows);
    await updateMethodMetadata();
    const current = state.rows.find(row => row.id === "situations-v2")!;
    expect(current.delivery.passport.rights.ru).toBe(rights);
    expect(current.delivery.passportRevision).not.toBe("2026-11-19");
    expect(current.delivery.passportRevision).toBe(sjt().delivery.passportRevision);
    expect(current.instructions.kk).toContain("«Ең ықтималдығы аз» —");
    expect(state.tests.situations.source).toBe(source);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ action: "test_version.client_metadata_updated", entityId: "situations-v2", organizationId: null, actorId: null });
    expect(state.audits[0].detail.previous.passport.rights).toEqual(previousRights);
    expect(state.audits[0].detail.revision).toBe(current.delivery.passportRevision);
    expect(current.questions).toEqual(before.find(row => row.id === current.id)!.questions);
    expect(current.delivery.practice).toEqual(before.find(row => row.id === current.id)!.delivery.practice);
    expect(current.translationStatus).toBe("working_translation");
    expect(current.approvedBy).toBeNull(); expect(current.approvedAt).toBeNull();
    expect(state.rows.filter(row => row.id !== current.id)).toEqual(before.filter(row => row.id !== current.id));
    for (const call of [...fixture.db.testVersion.update.mock.calls, ...fixture.db.testVersion.updateMany.mock.calls])
      expect(Object.keys((call[0] as any).data).sort()).toEqual(["delivery", "instructions", "limitations"]);
    expect(fixture.db.question.update).not.toHaveBeenCalled();
    const saved = structuredClone({ rows: state.rows, tests: state.tests, audits: state.audits });
    await updateMethodMetadata();
    expect({ rows: state.rows, tests: state.tests, audits: state.audits }).toEqual(saved);
    expect(fixture.db.testVersion.update.mock.calls.length + fixture.db.testVersion.updateMany.mock.calls.length).toBe(1);
  });

  it("rolls back source and passport if their audit cannot be saved", async () => {
    const state = metadataDatabase(); state.failAudit = true;
    const before = structuredClone({ rows: state.rows, tests: state.tests, audits: state.audits });
    await expect(updateMethodMetadata()).rejects.toThrow("Metadata audit unavailable");
    expect({ rows: state.rows, tests: state.tests, audits: state.audits }).toEqual(before);
  });

  it("refuses successful startup with stale metadata instead of overwriting a concurrent edit", async () => {
    const state = metadataDatabase(); state.concurrentChange = true;
    await expect(updateMethodMetadata()).rejects.toThrow("Canonical SJT metadata changed during startup; retry required");
    const current = state.rows.find(row => row.id === "situations-v2")!;
    expect(current.delivery.newerConcurrentMetadata).toBe(true);
    expect(current.delivery.passportRevision).toBe("2026-11-19");
    expect(state.audits).toHaveLength(0);
    expect(state.tests.situations.source).toContain("Документы заказчика");
  });
});

describe("plain three-month assessment consent", () => {
  it("uses the exact requested Russian deletion sentence without UTC/month-clamping detail", () => {
    expect(CONSENT_TEXT.ru.split(/\.\s+/)).toContain(deletionSentence);
    expect(CONSENT_TEXT.ru).not.toMatch(/UTC|календарных|последний день|соответствующего числа|регистрации в организации/);
    expect(CONSENT_TEXT.kk).not.toMatch(/UTC|соңғы күні|тиісті күн/);
    expect(CONSENT_TEXT.ru).toContain("не продлевают");
    expect(CONSENT_TEXT.kk).toContain("ұзартпайды");
  });

  it("requires fresh acceptance after changing consent text, never silently upgrades an old record", () => {
    const organization = { purpose: "assessment" };
    expect(CONSENT_VERSION).not.toBe("assessment-2026-11-21-retention");
    const member = { consentAt: new Date("2026-11-21T10:00:00Z"), consentVersion: "assessment-2026-11-21-retention" };
    expect(hasCurrentConsent(member, organization)).toBe(false);
    expect(consentPolicy(organization)).toEqual({ version: CONSENT_VERSION, text: CONSENT_TEXT });
    expect(hasCurrentConsent({ ...member, consentVersion: CONSENT_VERSION }, organization)).toBe(true);
    expect(hasCurrentConsent({ consentVersion: CONSENT_VERSION }, organization)).toBe(false);
    expect(member.consentVersion).toBe("assessment-2026-11-21-retention");
  });

  it("keeps calendar expiry anchored to registration, unaffected by login/re-consent/retake", () => {
    const createdAt = new Date("2026-11-30T10:15:30.123Z"), deadline = new Date("2027-02-28T10:15:30.123Z");
    expect(participantDeletionDate(createdAt)).toEqual(deadline);
    const member = { role: "employee", createdAt, consentVersion: CONSENT_VERSION, consentAt: deadline, lastLoginAt: deadline, retakeAt: deadline };
    expect(participantDataExpired(member, { purpose: "assessment" }, new Date("2027-02-28T10:15:30.122Z"))).toBe(false);
    expect(participantDataExpired(member, { purpose: "assessment" }, deadline)).toBe(true);
  });
});
