import { describe, expect, it } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { customerReportTemplate } from "../apps/api/src/customer-report";
import { individualTemplate } from "../apps/api/src/report-template";
import { dataReport } from "../packages/core/report-fallback";
import { REPORT_POLICY_VERSION } from "../packages/core/report-policy";
import { reportMetrics } from "../packages/core/reporting";
import { calculateScore } from "../packages/core/scoring";
import { HOLDING_PROFILES, HOLDING_SJT_CASES } from "../packages/core/holding";
import { DEFAULT_COMPETENCIES } from "../packages/core/competencies";
import { reportSummaryFixture } from "./fixtures/report-summary";
import type { ReportSnapshot } from "../packages/core/reporting";

const PANEL = "Ключ не утверждён экспертной панелью";
const SINGLE = "один кейс — дополнительный источник; основная оценка — по упражнениям и интервью";
function fixture(count = 1, status: string | undefined = "preliminary"): ReportSnapshot {
  const s = reportSummaryFixture(count);
  const questions = HOLDING_SJT_CASES.map(c => ({ id: c.questionId, type: "sjt", options: [{ id: "most" }, { id: "least" }] }));
  const config = { mode: "matching", holdingModelVersion: "holding-2026-11-21", items: Object.fromEntries(questions.map(q => [q.id, { most: "most", least: "least" }])) };
  const answers = Object.fromEntries(questions.map((q, i) => [q.id, { most: i % 3 ? "most" : "least", least: i % 3 ? "least" : "most" }]));
  const score = calculateScore("sjt", config as any, questions as any, answers);
  for (const p of s.people) {
    const sjt = p.results.find(r => r.testId === "situations")!;
    sjt.score = structuredClone(score);
    sjt.scoringKeyId = "synthetic-holding-key";
    (sjt as any).scoringKeyStatus = status;
    p.competencyProfile = {
      model: { id: "frozen-holding-model", status: "draft", content: structuredClone(DEFAULT_COMPETENCIES) },
      profile: structuredClone(HOLDING_PROFILES[54]), roleId: "holding-profile-55", cards: [], consensus: null,
    };
  }
  return s;
}
function render(s: ReportSnapshot, kind: "individual" | "team" = "individual", language: "ru" | "kk" = "ru") {
  return customerReportTemplate(s, dataReport(s, language, kind), { kind, language, createdAt: "2026-11-21" }).html;
}
function expertFixture(s: ReportSnapshot) {
  const p = s.people[0], sjt = p.results.find(r => r.testId === "situations")!;
  return { organization: s.organization, report: { status: "draft", content: {} }, member: { user: { name: p.name }, position: p.position, unit: p.unit }, competencyProfile: p.competencyProfile,
    results: [{ result: sjt.score, scoringKeyStatus: (sjt as any).scoringKeyStatus, attempt: { assignment: { testVersion: { testId: "situations", test: { name: sjt.name } } } } }], observations: [] };
}

function captureHarness(keys: any[]) {
  const source = readFileSync("apps/api/src/generated-reports.ts", "utf8");
  const ast = ts.createSourceFile("generated-reports.ts", source, ts.ScriptTarget.Latest, true);
  const capture = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "captureReport")!;
  const js = ts.transpileModule(`${capture.getText(ast)}\nexport { captureReport };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const s = fixture(), p = s.people[0];
  p.results.forEach(r => delete r.scoringKeyStatus);
  let keySelect: any;
  const mod = { exports: {} as any };
  runInNewContext(js, { module: mod, exports: mod.exports, requireRole() {}, participant: async () => {}, orgId: () => "synthetic-org",
    getCampaign: async () => ({ id: "synthetic-campaign", name: "Synthetic campaign" }),
    listPeople: async () => [{ ...p, role: "employee", user: { name: p.name } }],
    campaignRanks: async () => new Map(), normMetadata: () => null,
    competencyEvidence: async () => p.competencyProfile,
    db: { frozenNorm: { findFirst: async () => null }, scoringKey: { findMany: async (q: any) => { keySelect = q.select; return keys; } }, expertObservation: { findMany: async () => [] }, finalReport: { findMany: async () => [] } },
  });
  return { capture: () => mod.exports.captureReport({ org: { name: "Synthetic Holding" } }, "synthetic-campaign", p.id), select: () => keySelect };
}

describe("Fund client actual report templates", () => {
  it.each(["individual", "team"] as const)("renders the fresh %s eight-source profile and frozen preliminary-key warning", kind => {
    const s = fixture(kind === "team" ? 5 : 1), before = JSON.stringify(s), html = render(s, kind);
    expect(html).toContain(PANEL);
    for (const row of s.people[0].results.find(r => r.testId === "situations")!.score.holdingProfile) {
      expect(html).toContain(`${row.code} · ${row.name.ru}`);
      if (["C2", "C3", "C4", "C7"].includes(row.code)) expect(html).toContain(`data-holding-code="${row.code}"`);
      else {
        expect(html).toContain(`${row.code} · ${row.name.ru}: ${SINGLE}`);
        expect(html).not.toContain(`data-holding-code="${row.code}"`);
      }
    }
    expect(html).toContain("Краткий отчёт по результатам тестов");
    expect(html).toContain("28 из 28 — полное совпадение с экспертным ключом, а не оценка поведения на работе");
    expect(html).toContain("Нормативных данных по Казахстану нет");
    expect(JSON.stringify(s)).toBe(before);
  });
  it.each(["individual", "team"] as const)("renders the frozen numbered position reference in the %s report without numeric targets or weights", kind => {
    const s = fixture(kind === "team" ? 5 : 1), html = render(s, kind), profile = s.people[0].competencyProfile.profile;
    expect(html).toContain("Должностной профиль № 55");
    expect(html).toContain(profile.unit);
    expect(html).toContain(profile.position);
    expect(html).toContain("Критичность (1/2/3)");
    expect(html).toContain("Целевой уровень модели");
    expect(html).toContain("target_score");
    for (const [code, criticality] of Object.entries(profile.criticality)) {
      expect(html).toMatch(new RegExp(`data-profile-code="${code}"[^>]*>[^]*?<td[^>]*>${criticality}</td><td[^>]*>В</td><td data-target-score=""></td>`));
    }
    expect(html).toContain("не является весом");
    expect(html).not.toContain("Итоговая оценка эксперта: 1");
  });
  it("uses saved profile metadata rather than today's catalog and supports frozen model-role references", () => {
    const s = fixture(), p = s.people[0];
    p.competencyProfile.profile.criticality.C2 = 3;
    p.competencyProfile.profile.position = "Дословная сохранённая должность";
    const html = render(s);
    expect(html).toContain("Дословная сохранённая должность");
    expect(html).toMatch(/data-profile-code="C2"[^>]*>[^]*?<td[^>]*>3<\/td><td[^>]*>В<\/td>/);
    const frozenRole = p.competencyProfile.model.content.roles.find((r: any) => r.profileRow === 55);
    p.competencyProfile.profile = undefined;
    p.competencyProfile.roleId = frozenRole.id;
    expect(render(s)).toContain("Должностной профиль № 55");
  });
  it("keeps explicit not-observed evidence separate from a genuine score of one", () => {
    const s = fixture(), p = s.people[0];
    p.competencyProfile.consensus = { scores: { ratings: [{ competencyId: "C1", value: null, notObserved: true, evidenceIds: [] }] } };
    expect(render(s)).toMatch(/data-profile-code="C1"[^>]*>[^]*?Не наблюдалось/);
    const d: any = expertFixture(s);
    d.observations = [{ criteriaSnapshot: { name: { ru: "Сохранённое упражнение" }, criteria: [{ id: "absent", name: "Отсутствие наблюдения", indicators: [], scale: [] }, { id: "observed", name: "Наблюдаемая оценка один", indicators: [], scale: [] }] }, scores: { absent: null, observed: 1 }, createdAt: "2026-11-21", notes: "Синтетическая проверка отображения, не экспертное наблюдение" }];
    const html = individualTemplate(d).html;
    expect(html).toMatch(/Отсутствие наблюдения[^]*?<td>Не наблюдалось/);
    expect(html).toMatch(/Наблюдаемая оценка один[^]*?<td>1/);
    expect(html).not.toContain("null / 5");
  });
  it.each(["individual", "team"] as const)("does not call an approved or unknown key unapproved in a %s report", kind => {
    for (const status of ["approved", undefined]) {
      const s = fixture(kind === "team" ? 5 : 1, status);
      if (status === undefined) s.people.forEach(p => delete (p.results.find(r => r.testId === "situations") as any).scoringKeyStatus);
      expect(render(s, kind)).not.toContain(PANEL);
    }
  });
  it("does not upgrade historical missing profiles, infer missing profile references or change policy semantics", () => {
    const s = fixture(), p = s.people[0];
    delete p.results.find(r => r.testId === "situations")!.score.holdingProfile;
    delete p.competencyProfile;
    const html = render(s);
    expect(html).toContain("профиль по модели Холдинга не рассчитан");
    expect(html).not.toContain('data-holding-code="');
    expect(html).not.toContain("Должностной профиль №");
    expect(REPORT_POLICY_VERSION).toBe("holding-2026-11-21.1");
  });
  it("suppresses profile partitions and their complements before text collection", () => {
    const s = fixture(6);
    s.people[5].competencyProfile.profile = structuredClone(HOLDING_PROFILES[55]);
    s.people[5].competencyProfile.roleId = "holding-profile-56";
    const html = render(s, "team");
    expect(html).not.toContain("Должностной профиль №");
    const small = fixture(4), collected: string[] = [];
    const hidden = customerReportTemplate(small, dataReport(small, "ru", "team"), { kind: "team", language: "ru", createdAt: "2026-11-21", collectText: t => collected.push(t) }).html;
    expect(hidden).toContain("менее 5 участников");
    expect(collected.join(" ")).not.toContain(PANEL);
    expect(collected.join(" ")).not.toContain("Должностной профиль №");
  });
  it("keeps the authorized expert template and Kazakh source-language fallback truthful", () => {
    const s = fixture(), html = individualTemplate(expertFixture(s)).html;
    expect(html).toContain(PANEL);
    expect(html).toContain("Должностной профиль № 55");
    const kk = render(s, "individual", "kk");
    expect(kk).toContain("Коммуникация и лидерство");
    expect(kk).toContain("source_ru_fallback");
    const edits = customerReportTemplate(s, dataReport(s, "ru"), { kind: "individual", language: "ru", createdAt: "2026-11-21", presentationEdits: { [PANEL]: "Ключ утверждён", "В": "5", "55": "1" } }).html;
    expect(edits).toContain(PANEL);
    expect(edits).toContain("Должностной профиль № 55");
  });
  it("freezes the exact referenced scoring-key status without changing score semantics", async () => {
    for (const status of ["preliminary", "approved"]) {
      const h = captureHarness([{ id: "synthetic-holding-key", status, config: { bands: [1, 2, 3] } }]);
      const snapshot = await h.capture();
      expect(h.select()).toMatchObject({ id: true, config: true, status: true });
      const r = snapshot.people[0].results.find((r: any) => r.testId === "situations");
      expect(r.scoringKeyStatus).toBe(status);
      expect(r.score.holdingProfile).toEqual(fixture().people[0].results.find(r => r.testId === "situations")!.score.holdingProfile);
      expect(render(snapshot)).toContain(status === "preliminary" ? PANEL : "Совпадения с ключом");
      if (status === "approved") expect(render(snapshot)).not.toContain(PANEL);
    }
  });
  it("keeps legacy metrics and narrative readers unchanged by additive frozen metadata", async () => {
    const current = fixture(5), legacy = structuredClone(current);
    legacy.people.forEach(p => p.results.forEach(r => delete r.scoringKeyStatus));
    expect(reportMetrics(current, "ru")).toEqual(reportMetrics(legacy, "ru"));
    expect(dataReport(current, "ru", "team")).toEqual(dataReport(legacy, "ru", "team"));
    const missing = await captureHarness([]).capture();
    expect(missing.people[0].results.every((r: any) => r.scoringKeyStatus === undefined)).toBe(true);
    expect(render(missing)).not.toContain(PANEL);
  });
  it("keeps pending notices scoped to their exact form/key and does not publish sparse key strata", () => {
    const s = fixture(10);
    s.people.slice(5).forEach(p => {
      const r = p.results.find(r => r.testId === "situations")!;
      r.scoringKeyId = "approved-key";
      r.scoringKeyStatus = "approved";
    });
    const chapters = render(s, "team").split('<section class="report-page">').filter(p => p.includes('<h1>Управленческие ситуации</h1>'));
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toContain(PANEL);
    expect(chapters[1]).not.toContain(PANEL);
    const sparse = fixture(6);
    sparse.people[5].results.find(r => r.testId === "situations")!.scoringKeyId = "singleton-key";
    expect(render(sparse, "team").match(/Ключ не утверждён экспертной панелью/g)).toHaveLength(1);
    const multi = fixture(10);
    multi.people.slice(5).forEach(p => { p.competencyProfile.profile = structuredClone(HOLDING_PROFILES[55]); });
    const html = render(multi, "team");
    expect(html).toContain("Должностной профиль № 55");
    expect(html).toContain("Должностной профиль № 56");
    expect(html).not.toContain(multi.people[0].name);
  });
  it("can persist actual synthetic template evidence without external services", () => {
    const folder = process.env.FUND_REPORT_EVIDENCE_DIR;
    if (!folder) return;
    mkdirSync(folder, { recursive: true });
    for (const kind of ["individual", "team"] as const) for (const language of ["ru", "kk"] as const) {
      const s = fixture(kind === "team" ? 5 : 1);
      writeFileSync(`${folder}/${kind}-${language}.html`, render(s, kind, language));
      writeFileSync(`${folder}/${kind}-${language}-snapshot.json`, JSON.stringify(s, null, 2));
    }
    writeFileSync(`${folder}/expert-ru.html`, individualTemplate(expertFixture(fixture())).html);
  });
});
