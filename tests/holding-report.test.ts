import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { customerReportTemplate } from "../apps/api/src/customer-report";
import { individualTemplate } from "../apps/api/src/report-template";
import { sanitizePdfText } from "../apps/api/src/report-layout";
import { reportMetrics, type ReportSnapshot } from "../packages/core/reporting";
import { teamReportData, teamTestReportData, distribution, summaryStats } from "../packages/core/team-reporting";
import { dataReport } from "../packages/core/report-fallback";
import { reportAiInput } from "../packages/core/report-input";
import { REPORT_POLICY_VERSION, paragraphIssues, reportContentIssues, reportTextIssues } from "../packages/core/report-policy";
import { reportSummaryFixture } from "./fixtures/report-summary";

vi.mock("../apps/api/src/db", () => ({ db: {}, json: (v: unknown) => v }));
vi.mock("../apps/api/src/people", () => ({ getCampaign: vi.fn() }));
vi.mock("../apps/api/src/access", () => ({ requireRole: vi.fn(), orgId: vi.fn() }));
import { normMetadata, freezeNorm } from "../apps/api/src/norms";
import { db } from "../apps/api/src/db";
import { getCampaign } from "../apps/api/src/people";
import { holdingReportProfile, invalidProfile } from "../packages/core/report-policy";
const ui = { people: [] as any[], reports: [] as any[] };
function ReportCenter(props: { kind: "individual" | "team" }) {
  const nodeRequire = createRequire(import.meta.url), mod = { exports: {} as any };
  const Box = ({ children, title }: any) => createElement("div", null, title, children);
  const uiModule = {
    useApp: () => ({ t: (ru: string) => ru, locale: "ru", campaign: "c", campaigns: [{ id: "c", name: "Synthetic campaign" }], me: { role: "admin" }, notify: vi.fn() }),
    useData: (url: string) => ({ data: url.startsWith("/people") ? ui.people : ui.reports, loading: false, refreshSilently: vi.fn() }),
    post: vi.fn(), download: vi.fn(), PageTitle: Box, Panel: Box, Empty: Box, LoadState: Box, Avatar: () => null,
    Button: ({ children, disabled }: any) => createElement("button", { disabled }, children),
  };
  const source = ts.transpileModule(readFileSync("apps/web/components/report-center.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(source, { module: mod, exports: mod.exports, require: (id: string) => {
    if (id === "./ui") return uiModule;
    if (id === "./report-review") return { ReportReviewAction: () => null };
    if (id.endsWith("report-policy")) return { REPORT_POLICY_VERSION, invalidProfile };
    if (["react", "react/jsx-runtime", "lucide-react", "next/link"].includes(id)) return nodeRequire(id);
    throw Error(`Unexpected report-center dependency ${id}`);
  }, console });
  return createElement(mod.exports.ReportCenter, props);
}

const PERSONALITY = "Балл по шкале опросника от 1 до 5. Это не сравнение с населением Казахстана. Нормативных данных по Казахстану нет";
const SJT = "28 из 28 — полное совпадение с экспертным ключом, а не оценка поведения на работе";
const SINGLE = "один кейс — дополнительный источник; основная оценка — по упражнениям и интервью";
const NAMES = ["Коммуникация и лидерство", "Аналитическое мышление и принятие решений", "Влияние на рабочие процессы", "Организация работы", "Способность к изменениям", "Командность", "Ответственность", "Развитие"];
const profile = () => NAMES.map((ru, i) => ({ code: `C${i + 1}`, name: { ru, kk: ru }, total: [1, 3, 4, 5, 2, 1, 4, 2][i], maximum: [2, 4, 4, 6, 2, 2, 6, 2][i], caseCount: [1, 2, 2, 3, 1, 1, 3, 1][i], showSeparate: [1, 2, 3, 6].includes(i), note: SINGLE }));
function fixture(count = 1): ReportSnapshot {
  const s = reportSummaryFixture(count);
  s.campaign = { ...s.campaign, startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" } as any;
  for (const p of s.people) {
    const r = p.results.find((r) => r.testId === "situations")!;
    r.score.holdingProfile = profile();
    r.score.competencies = { obsolete: { name: { ru: "Управление командой (старое)" }, mean: 5 } };
  }
  return s;
}
function render(s: ReportSnapshot, kind: "individual" | "team" = "individual") {
  return customerReportTemplate(s, dataReport(s, "ru", kind), { kind, language: "ru", createdAt: "2026-11-21" }).html;
}

describe("Holding report source and confidentiality contract", () => {
  it("blocks small-team PDF/generation controls without removing authorized individual reports", () => {
    ui.people = fixture(4).people.map((p) => ({ ...p, role: "employee", user: { name: p.name } }));
    ui.reports = [{ id: "team-small", kind: "team", language: "ru", status: "completed", participantCount: 4, createdAt: "2026-11-21", policyVersion: REPORT_POLICY_VERSION }];
    const html = renderToStaticMarkup(createElement(ReportCenter, { kind: "team" }));
    expect(html).toContain("менее 5 участников");
    expect(html).not.toContain("Профили компетенций, распределения");
    expect(html.match(/<button disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
    ui.reports = [{ ...ui.reports[0], id: "individual", kind: "individual", membershipId: ui.people[0].id, participantCount: 1 }];
    const individual = renderToStaticMarkup(createElement(ReportCenter, { kind: "individual" }));
    expect(individual).toContain("Просмотр");
    expect(individual).not.toContain("Командный отчёт скрыт");
  });
  it("renders four raw same-source matching rows, all four textual supplements, and exact caveats", () => {
    const s = fixture(), before = JSON.stringify(s), html = render(s);
    expect(html).toContain(PERSONALITY);
    expect(html).toContain(SJT);
    expect(html).toContain("Краткий отчёт по результатам тестов");
    expect(html).not.toContain("Интегрированные выводы");
    for (const row of profile()) {
      expect(html).toContain(row.name.ru);
      if (row.showSeparate) expect(html).toContain(`data-holding-code="${row.code}"><td>${row.code} · ${row.name.ru}</td><td>${row.total} / ${row.maximum}</td>`);
      else {
        expect(html).toContain(`${row.code} · ${row.name.ru}: ${SINGLE}`);
        expect(html).not.toContain(`data-holding-code="${row.code}"`);
      }
    }
    expect(html).not.toContain("Управление командой (старое)");
    expect(html).not.toMatch(/целев(?:ой|ого) балл|вес компетенции|оценка компетенции: [1-5]/iu);
    expect(JSON.stringify(s)).toBe(before);
    const ai = JSON.stringify(reportAiInput(s, "individual", "ru").input);
    expect(ai).toContain("holdingProfile");
    expect(ai).not.toContain("Управление командой (старое)");
  });
  it("does not synthesize a Holding profile for historical scores with absent or incomplete detail", () => {
    const s = fixture();
    const score = s.people[0].results.find((r) => r.testId === "situations")!.score;
    for (const invalid of [undefined, [], profile().slice(0, 7)]) {
      score.holdingProfile = invalid;
      const html = render(s);
      expect(html).toContain("профиль по модели Холдинга не рассчитан");
      expect(html).not.toContain('data-holding-code="');
      expect(html).not.toContain("Управление командой (старое)");
    }
  });
  it("rejects incompatible saved labels and totals instead of displaying a false current profile", () => {
    const s = fixture(), score = s.people[0].results.find((r) => r.testId === "situations")!.score;
    expect(holdingReportProfile(score)).not.toBeNull();
    score.holdingProfile[1].name.ru = "Управление командой (старое)";
    expect(holdingReportProfile(score)).toBeNull();
    expect(render(s)).not.toContain("Управление командой (старое)");
    score.holdingProfile = profile();
    score.total = 23;
    expect(holdingReportProfile(score)).toBeNull();
  });
  it("does not let presentation edits rewrite source measurements or mandatory caveats", () => {
    const s = fixture();
    const html = customerReportTemplate(s, dataReport(s, "ru"), { kind: "individual", language: "ru", createdAt: "2026-11-21", presentationEdits: { [PERSONALITY]: "Сравнение с населением Казахстана", [SJT]: "Оценка поведения на работе", "3 / 4": "5 / 5" } }).html;
    expect(html).toContain(PERSONALITY);
    expect(html).toContain(SJT);
    expect(html).toContain("3 / 4");
    expect(html).not.toContain("5 / 5");
  });
  it("shows only frozen internal percentiles with scale-specific actual N and explicit provenance", () => {
    const s = fixture();
    s.norm = { id: "frozen-1", createdAt: "2026-11-03", expectedCount: 65, excludedCount: 3, method: "empirical-midrank-normal-sten-v1", languageMode: "separate", sourceHash: "fixture", country: "Казахстан", period: { startsAt: "2026-10-01", endsAt: "2026-11-01" } } as any;
    const score = s.people[0].results[0].score;
    score.cohortPercentile = { scope: "frozen", normId: "frozen-1", value: 71, n: 37 };
    let html = render(s);
    expect(html).toContain("выборка не представительна для Казахстана");
    expect(html).toContain("Фактическая выборка: 37");
    expect(html).toContain("Страна выборки: Казахстан");
    expect(html).toContain("01.10.2026 — 01.11.2026");
    expect(html).toContain("empirical-midrank-normal-sten-v1");
    expect(html).not.toContain("группа сравнения: 65");
    expect(html).not.toContain("по Казахстану: 71");
    delete (s.norm as any).country;
    expect(render(s)).toContain("Страна выборки: не указана");
    score.cohortPercentile.scope = "live";
    expect(render(s)).not.toContain("Фактическая выборка: 37");
    score.cohortPercentile.scope = "frozen";
    score.cohortPercentile.normId = "different";
    expect(render(s)).not.toContain("Фактическая выборка: 37");
  });
  it("exposes norm provenance and actual metric denominators without treating expected roster as actual N", () => {
    const meta = normMetadata({ id: "n", createdAt: "2026-11-03", expectedCount: 65, excludedCount: 3, sourceHash: "h", metrics: { method: "m", languageMode: "separate", metrics: [{ key: "scale-N", n: 37 }, { key: "scale-E", n: 42 }], provenance: { country: "Казахстан", period: { startsAt: "2026-10-01", endsAt: "2026-11-01" }, source: "campaign" } } });
    expect(meta).toMatchObject({ country: "Казахстан", period: { startsAt: "2026-10-01", endsAt: "2026-11-01" }, actualN: { "scale-N": 37, "scale-E": 42 }, provenance: { source: "campaign" } });
    expect(normMetadata({ id: "old", metrics: {}, expectedCount: 65 })).toMatchObject({ country: null, period: null, actualN: {} });
  });
  it("freezes actual campaign country and dates and fingerprints provenance with actual eligible counts", async () => {
    let country = "Казахстан";
    vi.mocked(getCampaign).mockImplementation(async () => ({ country, startsAt: new Date("2026-10-01"), endsAt: new Date("2026-11-01") }) as any);
    const writes: any[] = [];
    const tx = {
      $queryRaw: vi.fn(),
      testAssignment: { findMany: vi.fn(async () => Array.from({ length: 65 }, (_, i) => ({ membershipId: `synthetic-${i}`, testVersionId: "form", testVersion: { testId: "logical" }, attempts: [{ status: "completed", language: "ru", results: [{ id: `r-${i}`, scoringKeyId: "key", result: { algorithm: "cognitive", total: i < 2 ? null : i % 20, maximum: 24 } }] }] }))) },
      frozenNorm: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: any) => { writes.push(data); return { ...data, id: "frozen", createdAt: "2026-11-21" }; }) },
      auditLog: { create: vi.fn() },
    };
    (db as any).$transaction = (fn: any) => fn(tx);
    const ctx = { role: "admin", user: { id: "fixture-expert" } } as any;
    const first = await freezeNorm(ctx, "synthetic-campaign", { confirm: true, reason: "Synthetic local freeze verification" });
    expect(first).toMatchObject({ country: "Казахстан", period: { startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" } });
    expect(Object.values(first!.actualN)).toEqual([63]);
    country = "Other explicit source country";
    await freezeNorm(ctx, "synthetic-campaign", { confirm: true, reason: "Synthetic local freeze verification" });
    expect(writes[0].sourceHash).not.toBe(writes[1].sourceHash);
  });
  it("withholds a four-person team report even if injected content tries to describe individuals", () => {
    const s = fixture(4), content = dataReport(s, "ru", "team");
    content.summary = [{ text: "Контрольный участник 0 получил 28 баллов.", evidenceIds: ["coverage"] }];
    const html = customerReportTemplate(s, content, { kind: "team", language: "ru", createdAt: "2026-11-21" }).html;
    expect(html).toContain("менее 5 участников");
    expect(html).not.toContain("Контрольный участник");
    expect(html).not.toContain("28 баллов");
    expect(html).not.toContain("Медиана группы");
    expect((teamTestReportData(s, "ru") as any).suppressed).toBe(true);
    expect(reportMetrics(s, "ru")).toEqual([]);
    expect(JSON.stringify(reportAiInput(s, "team", "ru").input)).not.toContain("holdingProfile");
    const collected: string[] = [];
    content.developmentPlan = [{ focus: "Контрольный участник 0", action: "identified action", format: "one", timeframe: "now", success: "private", evidenceIds: ["coverage"] }];
    customerReportTemplate(s, content, { kind: "team", language: "ru", createdAt: "2026-11-21", collectText: (text) => collected.push(text) });
    expect(collected.join(" ")).not.toContain("Контрольный участник 0");
  });
  it("renders five-person Holding medians without numeric single-case rows or legacy labels", () => {
    const s = fixture(5), html = render(s, "team");
    expect(html).toContain("Медиана группы");
    expect(html).toContain('data-holding-code="C2"');
    expect(html).toContain("3 / 4");
    expect(html).not.toContain('data-holding-code="C1"');
    expect(html).toContain(SINGLE);
    const data = teamTestReportData(s, "ru") as any;
    expect(data.suppressed).toBe(false);
    expect(data.holdingProfile.numeric.find((r: any) => r.code === "C2")).toMatchObject({ total: 3, maximum: 4, n: 5 });
    const legacy = fixture(5);
    for (const p of legacy.people) delete p.results.find((r) => r.testId === "situations")!.score.holdingProfile;
    expect(render(legacy, "team")).toContain("профиль по модели Холдинга не рассчитан");
  });
  it("suppresses sparse distributions and secondary role/unit intersections including complement leakage", () => {
    expect(summaryStats([1, 2, 3, 4], false)).toEqual({ suppressed: true });
    expect(distribution([1, 1, 1, 1])).toEqual([]);
    expect(distribution([1, 1, 1, 1, 2])).toEqual([]);
    expect(distribution([1, 1, 1, 1, 1])).toEqual([{ level: 1, count: 5 }, { level: 2, count: 0 }, { level: 3, count: 0 }, { level: 4, count: 0 }, { level: 5, count: 0 }]);
    const s = fixture(9);
    s.people.forEach((p, i) => { p.unit = i < 4 ? "Sparse identifying branch" : "Other branch"; });
    const metrics = reportMetrics(s, "ru");
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics.every((m) => m.units.length === 0)).toBe(true);
    const team = teamReportData(s, "ru");
    expect(team.methods.every((m) => m.groups.every((g) => g.suppressed))).toBe(true);
  });
  it("counts people rather than duplicated expert rating rows at the confidentiality threshold", () => {
    const s = fixture(5), rating = s.people[0].competencyProfile.consensus.scores.ratings[0];
    s.people[0].competencyProfile.consensus.scores.ratings = Array.from({ length: 5 }, () => ({ ...rating }));
    s.people.slice(1).forEach((p) => { p.competencyProfile.consensus.scores.ratings = []; });
    const data = teamReportData(s, "ru");
    expect(data.competencies[0].overall).toEqual({ suppressed: true });
    expect(data.competencies[0].distribution).toEqual([]);
  });
  it("keeps each Holding median with its own form/key and never emits a second form on the first page", () => {
    const s = fixture(10);
    s.people.slice(5).forEach((p) => {
      const r = p.results.find((r) => r.testId === "situations")!;
      r.scoringKeyId = "another-key";
      r.score.holdingProfile[1].total = 1;
      r.score.total = 20;
    });
    const html = render(s, "team");
    const chapters = html.split('<section class="report-page">').filter((p) => p.includes('<h1>Управленческие ситуации</h1>'));
    expect(chapters).toHaveLength(2);
    expect(chapters[0].match(/data-holding-code="C2"/g)).toHaveLength(1);
    expect(chapters[0]).toContain("3 / 4");
    expect(chapters[0]).not.toContain("1 / 4");
    expect(chapters[1]).toContain("1 / 4");
    expect(chapters[1]).not.toContain("3 / 4");
  });
  it("keeps editable narrative review while source values remain locked", () => {
    const s = fixture(), content = dataReport(s, "ru");
    const text = content.developmentPlan[0].action;
    const html = customerReportTemplate(s, content, { kind: "individual", language: "ru", createdAt: "2026-11-21", presentationEdits: { [text]: "Уточнённое экспертом действие." } }).html;
    expect(html).toContain("Уточнённое экспертом действие.");
  });
  it("keeps exact warnings through sanitization and PDF review without weakening unsafe-text gates", () => {
    expect(REPORT_POLICY_VERSION).not.toBe("customer-2026-11-19.1");
    for (const text of [PERSONALITY, SJT, SINGLE, "выборка не представительна для Казахстана", "Период выборки: 01.10.2026 — 01.11.2026"]) {
      expect(sanitizePdfText(text)).toBe(text);
      expect(reportTextIssues(text)).toEqual([]);
      expect(paragraphIssues(text)).toEqual([]);
    }
    expect(reportTextIssues("Участник конфликтный").length).toBeGreaterThan(0);
    expect(paragraphIssues("Результаты: 1, 2, 3").length).toBeGreaterThan(0);
    expect(reportContentIssues(dataReport(fixture(5), "ru", "team"), fixture(5), "team")).toEqual([]);
  });
  it("updates the authorized individual expert template with the same source profile and truthful case denominator", () => {
    const s = fixture(), sjt = s.people[0].results.find((r) => r.testId === "situations")!;
    const d: any = { organization: { name: "Synthetic Holding" }, report: { status: "draft", content: {} }, member: { user: { name: "Synthetic participant" } }, results: [{ result: { ...sjt.score, mostMatches: 14, leastMatches: 8, details: Array.from({ length: 14 }, (_, i) => ({ score: i < 8 ? 2 : 1, mostMatch: true, leastMatch: i < 8 })) }, attempt: { assignment: { testVersion: { testId: "situations", test: { name: sjt.name } } } } }], observations: [] };
    d.ai = { status: "completed", content: { situations: [{ text: "Управление командой (старое)" }] } };
    d.results.push({ result: { algorithm: "cognitive", total: 20, maximum: 24, percent: 100 }, attempt: { assignment: { testVersion: { testId: "logical", test: { name: { ru: "Логическое мышление" } } } } } });
    const html = individualTemplate(d).html;
    expect(html).not.toContain("Управление командой (старое)");
    expect(html).toContain("<td>20 / 24</td><td>83.3%</td>");
    expect(html).toContain(SJT);
    expect(html).toContain('data-holding-code="C2"');
    expect(html).toContain("3 / 4");
    expect(html).toContain("MOST: 14 / 14");
    expect(html).not.toContain("LEAST: 8 / 8");
  });
});
