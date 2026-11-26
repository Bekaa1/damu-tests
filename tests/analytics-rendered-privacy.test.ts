import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { basename } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

// Real React mount of the actual Analytics TSX + privacy helper. Only the app
// context/data transport and decorative UI shells are substituted; no server,
// service, browser navigation or network request is allowed.
let browser: Browser, bundle: string;
beforeAll(async () => {
  const output = await build({
    stdin: {
      contents: `import React from "react";
        import { createRoot } from "react-dom/client";
        import { Analytics } from "./apps/web/components/organization";
        createRoot(document.getElementById("root")).render(React.createElement(Analytics));`,
      resolveDir: process.cwd(), sourcefile: "analytics-privacy-mount.tsx",
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "offline-analytics-context", setup(builder) {
      builder.onResolve({ filter: /^\.\/ui$/ }, (args) => basename(args.importer) === "organization.tsx" ? { path: "ui", namespace: "analytics-fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "analytics-fixture" }, () => ({
        loader: "jsx", resolveDir: process.cwd(), contents: `import React from "react";
          export const useApp = () => ({t: ru => ru, loc: value => value?.ru || value,
            campaign: "synthetic", locale: "ru", notify: () => { throw Error("Unexpected notification"); }});
          export const useData = url => {
            if (url !== "/people?campaignId=synthetic") throw Error("Unexpected data request: " + url);
            return {data: window.__analyticsRows, loading: false, error: null};
          };
          const Box = ({children, title}) => <section>{title}{children}</section>;
          export const PageTitle = Box, Panel = Box, LoadState = Box;
          export const post = undefined, patch = undefined, download = undefined,
            Stat = undefined, Badge = undefined, Avatar = undefined, Progress = undefined,
            Button = undefined, Empty = undefined, Modal = undefined, Field = undefined, date = undefined;`,
      }));
      // These belong to other exports of organization.tsx, not Analytics.
      builder.onResolve({ filter: /^(\.\/pilot-permission|.*\/(holding|assessment-policy|method-passports))$/ }, (args) => basename(args.importer) === "organization.tsx" ? { path: args.path, namespace: "analytics-unused" } : undefined);
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "analytics-unused" }));
      builder.onLoad({ filter: /.*/, namespace: "analytics-unused" }, () => ({ contents: "export default undefined; export const PilotPermission = undefined, HOLDING_PROFILES = undefined, holdingProfile = undefined, questionCountText = undefined, METHOD_PASSPORTS = undefined;" }));
    }}],
  });
  bundle = output.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

const row = (id: string, unit: string, position: string) => ({
  id, role: "employee", unit, position, status: "completed",
  results: [{ testVersionId: "verbal-v2", scoringKeyId: "key", language: "ru",
    name: { ru: "Overall method" }, score: { total: 12, maximum: 30 } }],
});
async function mounted(rows: any[], verify: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  const requests: string[] = [], errors: string[] = [];
  await page.route("**/*", async (route) => { requests.push(route.request().url()); await route.abort(); });
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.setContent('<div id="root"></div>');
    await page.evaluate(rows => { (window as any).__analyticsRows = rows; }, rows);
    await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: "По подразделениям", exact: true }).waitFor({ timeout: 2_000 }).catch(() => { throw Error(`Analytics mount failed: ${errors.join("; ")}`); });
    await verify(page);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}
const chartLabels = (page: Page) => page.locator(".bar-chart-row > span").allTextContents();
const methodNs = (page: Page) => page.locator("tbody tr td:nth-child(2)").allTextContents();
async function toggle(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.locator("button.active").filter({ hasText: name }).waitFor();
}

describe("Mounted Analytics complementary confidentiality", () => {
  it("does not disclose the five-person complement when toggling the real 6/5/1 fixture", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ...row(String(i), "Allsix", i < 5 ? "Visiblefive" : "hiddenone"),
      status: i < 5 ? "completed" : "in_progress",
    }));
    await mounted(rows, async page => {
      expect(await chartLabels(page)).toEqual(["Allsix"]);
      expect(await page.locator(".bar-chart-row strong").allTextContents()).toEqual(["83%"]);
      expect(await methodNs(page)).toEqual(["6"]);
      await toggle(page, "По должностям");
      expect(await chartLabels(page)).toEqual([]);
      expect(await methodNs(page)).toEqual(["6"]);
      expect(await page.locator("#root").textContent()).not.toMatch(/Visiblefive|hiddenone|100%/);
      expect(await page.locator(".notice").textContent()).toContain("связанные разрезы");
      await toggle(page, "По подразделениям");
      expect(await chartLabels(page)).toEqual(["Allsix"]);
    });
  });
  it("withholds the 5/4 unit complement beside the retained actual N=9", async () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(String(i), i < 5 ? "Visiblefive" : "hiddenfour", "Allnine"));
    await mounted(rows, async page => {
      expect(await chartLabels(page)).toEqual([]);
      expect(await methodNs(page)).toEqual(["9"]);
      expect(await page.locator(".notice").textContent()).toContain("связанные разрезы");
      await toggle(page, "По должностям");
      expect(await chartLabels(page)).toEqual(["Allnine"]);
      expect(await methodNs(page)).toEqual(["9"]);
      expect(await page.locator("#root").textContent()).not.toMatch(/Visiblefive|hiddenfour/);
    });
  });
  it("does not retain an overlapping five-person method denominator beside six", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(String(i), "Allsix", "Allsix"));
    for (const p of rows.slice(0, 5)) p.results.push({ ...p.results[0], testVersionId: "subset-v2", name: { ru: "Hidden subset method" } });
    await mounted(rows, async page => {
      expect(await methodNs(page)).toEqual(["6"]);
      expect(await page.locator("tbody").textContent()).not.toContain("Hidden subset method");
      await toggle(page, "По должностям");
      expect(await methodNs(page)).toEqual(["6"]);
    });
  });
  it("does not turn a withheld scale family into a fabricated zero-scale result", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ ...row(String(i), "Allsix", "Allsix"), results: [{
      testVersionId: "personality-v2", scoringKeyId: "key", language: "ru", name: { ru: "Personality" },
      score: { scales: i < 5 ? { partial: { name: "Partial", mean: 3, min: 1, max: 5 } } : {} },
    }] }));
    await mounted(rows, async page => {
      expect(await methodNs(page)).toEqual(["6"]);
      expect(await page.locator("tbody tr td:nth-child(3)").allTextContents()).toEqual(["Показатели недоступны"]);
      expect(await page.locator("#root").textContent()).not.toContain("0 шкал");
    });
  });
  it("keeps safe aligned five/six groups and separate method/key/language sample sizes", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(String(i), i < 5 ? "Unit five" : "Unit six", i < 5 ? "Position five" : "Position six"));
    for (const p of rows.slice(5)) Object.assign(p.results[0], { testVersionId: "verbal-v3", scoringKeyId: "key-2", language: "kk", name: { ru: "Separate method" } });
    await mounted(rows, async page => {
      expect(await chartLabels(page)).toEqual(["Unit five", "Unit six"]);
      expect(await methodNs(page)).toEqual(["5", "6"]);
      expect(await page.locator("tbody tr td:nth-child(3)").allTextContents()).toEqual(["12.0 / 30", "12.0 / 30"]);
      expect(await page.locator(".notice").count()).toBe(0);
      await toggle(page, "По должностям");
      expect(await chartLabels(page)).toEqual(["Position five", "Position six"]);
      expect(await methodNs(page)).toEqual(["5", "6"]);
    });
  });
});
