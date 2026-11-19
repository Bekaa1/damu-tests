import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { reportSummaryFixture } from "../tests/fixtures/report-summary";
import { dataReport } from "../packages/core/report-fallback";
import { customerReportTemplate } from "../apps/api/src/customer-report";
import { renderPdf } from "../apps/api/src/exports";
import { reportCss } from "../apps/api/src/report-layout";
import { paginateProfessionalReport } from "../apps/api/src/report-pagination";
import {
  reportTextIssues,
  paragraphIssues,
  reportContentIssues,
} from "../packages/core/report-policy";
const folder = "output/pdf/report-summary-20261119";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const checks: any[] = [];
try {
  for (const kind of ["individual", "team"] as const)
    for (const language of ["ru", "kk"] as const) {
      const snap = reportSummaryFixture(kind === "team" ? 5 : 1);
      const content = dataReport(snap, language, kind);
      assert.deepEqual(reportContentIssues(content, snap, kind), []);
      const rendered = customerReportTemplate(snap, content, {
        kind,
        language,
        createdAt: new Date("2026-11-19"),
      });
      const bytes = await renderPdf(
        rendered.html,
        rendered.label,
        language,
        reportCss,
        (text, paragraphs) => {
          assert.deepEqual(reportTextIssues(text), []);
          assert.deepEqual(
            paragraphs.flatMap((text) => paragraphIssues(text)),
            [],
          );
        },
      );
      await writeFile(folder + "/" + kind + "-" + language + ".pdf", bytes);
      await page.setContent(
        "<html><style>" +
          reportCss +
          "</style><body>" +
          rendered.html +
          "</body></html>",
      );
      await paginateProfessionalReport(page);
      const dimensions = await page
        .locator(".report-page")
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            height: n.getBoundingClientRect().height,
            text: n.textContent?.length || 0,
            overflow: n.scrollWidth > n.clientWidth + 1,
          })),
        );
      assert(
        dimensions.every((d) => d.height <= 985 && d.text > 25 && !d.overflow),
        JSON.stringify(dimensions),
      );
      checks.push({
        kind,
        language,
        pages: dimensions.length,
        bytes: bytes.length,
        dimensions,
      });
      console.log(
        "PASS",
        kind,
        language,
        dimensions.length,
        "pages, no overflow, all text checks passed",
      );
    }
  await writeFile(folder + "/checks.json", JSON.stringify(checks, null, 2));
} finally {
  await browser.close();
}
process.exit(0);
