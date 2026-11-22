import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { customerReportTemplate, holdingPositionReferenceHtml } from "../apps/api/src/customer-report";
import { individualTemplate } from "../apps/api/src/report-template";
import { dataReport } from "../packages/core/report-fallback";
import { REPORT_POLICY_VERSION, SJT_CAVEAT_RU } from "../packages/core/report-policy";
import { reportSummaryFixture } from "./fixtures/report-summary";

const caveat = "Максимальный балл 28 означает полное совпадение с экспертным ключом, а не оценку поведения на работе";
const authoredKk = "28-ден 28 — сараптамалық кілтпен толық сәйкестік, жұмыстағы мінез-құлық бағасы емес";
const nodeRequire = createRequire(import.meta.url);

// Execute the actual local TSX function without adding production exports.
function component(path: string, name: string, globals: Record<string, unknown>) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  const code = ts.transpileModule(`${fn.getText(source)}\nexport { ${name} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as any };
  runInNewContext(code, { module: mod, exports: mod.exports, require: (id: string) => {
    if (id === "react/jsx-runtime") return nodeRequire(id);
    throw Error(`Unexpected dependency: ${id}`);
  }, ...globals });
  return mod.exports[name];
}

describe("five client report presentation corrections", () => {
  it("describes the maximum without claiming that a 15/28 participant scored 28/28", () => {
    const s = reportSummaryFixture(), result = s.people[0].results.find(r => r.testId === "situations")!;
    result.score.total = 15;
    const before = JSON.stringify(s);
    const html = customerReportTemplate(s, dataReport(s, "ru"), { kind: "individual", language: "ru", createdAt: "2026-11-22" }).html;
    expect(SJT_CAVEAT_RU).toBe(caveat);
    expect(html).toContain(caveat);
    expect(html).toContain("15 из 28");
    expect(html).not.toContain("28 из 28 —");
    const d = { organization: s.organization, member: { user: { name: "Synthetic participant" } }, report: { status: "draft", content: {} }, observations: [], results: [{ result: result.score, attempt: { assignment: { testVersion: { testId: "situations", test: { name: result.name } } } } }] };
    expect(individualTemplate(d).html).toContain(caveat);
    const kk = customerReportTemplate(s, dataReport(s, "kk"), { kind: "individual", language: "kk", createdAt: "2026-11-22" }).html;
    expect(kk).toContain(authoredKk);
    expect(JSON.stringify(s)).toBe(before);
  });

  it.each(["ru", "kk"] as const)("removes technical tokens only from the visible %s target heading", language => {
    const reference = { profileRow: 55, unit: "Synthetic unit", position: "Synthetic position", rows: [{ code: "C1", name: { ru: "Источник", kk: "Источник" }, criticality: 1, targetLevelModel: "В", targetScore: null }] };
    const before = JSON.stringify(reference);
    const html = holdingPositionReferenceHtml(reference as any, language, value => String(value ?? ""));
    expect(html).toContain(`<th>${language === "ru" ? "Целевой числовой балл" : "Нысаналы сандық балл"}</th>`);
    expect(html).not.toContain("(target_score)");
    expect(html).toContain('<td data-target-score=""></td>');
    expect(JSON.stringify(reference)).toBe(before);
  });

  it("uses the requested strength wording without changing scores or norms caveats", () => {
    const s = reportSummaryFixture(), before = JSON.stringify(s), report = dataReport(s, "ru");
    expect(report.strengths.some(r => r.text.endsWith(": результат выше среднего по шкале теста."))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("результат относится к верхним диапазонам формы");
    expect(report.limitations).toContain("Балл по шкале опросника от 1 до 5. Это не сравнение с населением Казахстана. Нормативных данных по Казахстану нет");
    expect(JSON.stringify(s)).toBe(before);
  });

  it.each(["synthetic", "real", undefined])("keeps availability and suppresses elapsed only for dataMode=%s", dataMode => {
    const ReportState = component("apps/web/components/report-center.tsx", "ReportState", {
      useApp: () => ({ t: (ru: string) => ru, me: { organization: { dataMode } } }),
      REPORT_POLICY_VERSION, CheckCircle2: () => null,
    });
    const report = { id: "synthetic-report", kind: "individual", status: "completed", policyVersion: REPORT_POLICY_VERSION, readyAt: "2026-11-22T00:10:01.000Z", assessmentCompletedAt: "2026-11-22T00:00:00.000Z" };
    const before = JSON.stringify(report);
    const html = renderToStaticMarkup(createElement(ReportState, { report }));
    expect(html).toContain("Доступен:");
    expect(html).toContain(new Date(report.readyAt).toLocaleString());
    if (dataMode === "synthetic") expect(html).not.toContain("сек после завершения");
    else expect(html).toContain("601 сек после завершения");
    expect(JSON.stringify(report)).toBe(before);
  });

  it.each(["ru", "kk"] as const)("localizes only the participant SJT choice headings in %s", language => {
    const source = ts.createSourceFile("management.tsx", readFileSync("apps/web/components/management.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "Participant")!;
    let table: ts.JsxElement | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "table" && node.getText(source).includes("s.details.map")) table = node;
      ts.forEachChild(node, visit);
    };
    visit(fn);
    expect(table).toBeDefined();
    const code = ts.transpileModule(`export function ChoiceTable() { return (${table!.getText(source)}); }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const score = { details: [{ questionId: "stable-question", mostMatch: true, leastMatch: false, value: { most: "stable-a", least: "stable-b" }, score: 1 }] }, before = JSON.stringify(score), mod = { exports: {} as any };
    runInNewContext(code, { module: mod, exports: mod.exports, require: (id: string) => nodeRequire(id), s: score, t: (ru: string, kk: string) => language === "ru" ? ru : kk });
    const html = renderToStaticMarkup(createElement(mod.exports.ChoiceTable));
    expect(html).toContain(`<th>${language === "ru" ? "Наиболее" : "Ең ықтимал"}</th>`);
    expect(html).toContain(`<th>${language === "ru" ? "Наименее" : "Ең ықтималдығы аз"}</th>`);
    expect(html).not.toMatch(/<th>(MOST|LEAST)<\/th>/);
    expect(html).toContain("1 / 2");
    expect(JSON.stringify(score)).toBe(before);
  });
});
