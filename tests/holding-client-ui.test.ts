import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { DEFAULT_COMPETENCIES, exerciseCriteria } from "../packages/core/competencies";
import { HOLDING_COMPETENCIES, HOLDING_PROFILES, HOLDING_SJT_CASES, HOLDING_SINGLE_CASE_NOTE, holdingSjtProfile } from "../packages/core/holding";
import { CONSENT_VERSION } from "../packages/core/assessment-policy";

// Actual Application, UI shells, data hooks and screen handlers run in Chromium.
// Only Next's router is replaced. Every request is intercepted: no server/DB,
// credentials, remote access or participant mutations are used by this fixture.
let browser: Browser, bundle: string;
const evidenceDir = "/root/research/damu-tests/client-fix-20261121";
beforeAll(async () => {
  const out = await build({
    stdin: { contents: `import React from "react"; import { createRoot } from "react-dom/client";
      import { Application } from "./apps/web/components/application";
      createRoot(document.getElementById("root")).render(<Application/>);`,
      resolveDir: process.cwd(), sourcefile: "holding-client-mount.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "offline-next-router", setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: "holding-router" }));
      builder.onLoad({ filter: /.*/, namespace: "holding-router" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link"
        ? `import React from "react"; import { useRouter } from "next/navigation";
          export default function Link({href, children, ...props}) { const router=useRouter();
            return <a href={href} {...props} onClick={e=>{e.preventDefault();router.push(href);}}>{children}</a>; }`
        : `import {useSyncExternalStore} from "react";
          const subscribe=cb=>{window.addEventListener("popstate",cb);return ()=>window.removeEventListener("popstate",cb);};
          const move=href=>{history.pushState({},"",href);window.dispatchEvent(new PopStateEvent("popstate"));};
          const router={push:move,replace:move}; export const useRouter=()=>router;
          export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname);
          export const useSearchParams=()=>new URLSearchParams(location.search);` }));
    } }],
  });
  bundle = out.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
  mkdirSync(evidenceDir, { recursive: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

const model = { id: "synthetic-model", version: 3, status: "draft", content: DEFAULT_COMPETENCIES };
const campaign = { id: "synthetic-campaign", name: "Синтетическая кампания" };
function session(role: string) {
  return { role, demo: true, user: { id: `synthetic-${role}`, name: `Синтетический ${role}`, email: `${role}@synthetic.invalid`, locale: "ru", mustChangePassword: false },
    member: { id: `${role}-member`, role, consentAt: "2026-11-21T00:00:00Z", consentVersion: CONSENT_VERSION, createdAt: "2026-11-21T00:00:00Z" },
    organization: { id: "synthetic-org", name: "Синтетический Холдинг", purpose: "assessment", dataMode: "synthetic" }, organizations: [] };
}
function participant(profileRow = 55) {
  const p = HOLDING_PROFILES.find(p => p.profileRow === profileRow)!;
  return { member: { id: `subject-${profileRow}`, profileRow, position: p.position, unit: p.unit,
      user: { name: `Синтетический участник ${profileRow}`, email: `subject-${profileRow}@synthetic.invalid` } },
    assignments: [], reports: [], observations: [], files: [], allDone: false };
}
const exercises = [{ id: "synthetic-exercise", type: "interview", name: { ru: "Синтетическое интервью", kk: "Синтетическое интервью" }, criteria: exerciseCriteria(DEFAULT_COMPETENCIES, "interview") }];
function evidence(profileRow = 55) {
  return { model, member: participant(profileRow).member, roleId: `holding-profile-${profileRow}`, consensus: null,
    cards: DEFAULT_COMPETENCIES.competencies.map(c => ({ ...c, sources: [], methodCount: 0 })) };
}
type FixtureOptions = { role?: string; path?: string; offline?: boolean; storage?: Record<string, string>; results?: boolean; bootstrapStatus?: number; demo?: boolean; gate?: "password" | "consent"; campaignId?: string };
async function mounted(options: FixtureOptions, verify: (page: Page, writes: any[]) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), writes: any[] = [], unexpected: string[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const me = session(options.role || "admin");
  if (options.demo === false) { me.demo = false; me.organization.dataMode = "real"; }
  if (options.gate === "password") me.user.mustChangePassword = true;
  if (options.gate === "consent") me.member.consentVersion = "superseded-consent";
  await page.addInitScript(({ storage, offline }) => {
    if (!sessionStorage.getItem("holding-fixture-initialized")) {
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
      sessionStorage.setItem("holding-fixture-initialized", "true");
    }
    if (offline) Object.defineProperty(navigator, "onLine", { get: () => false });
  }, { storage: options.storage || {}, offline: options.offline || false });
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== "http://holding-ui.local") { unexpected.push(req.url()); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) {
      await route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }); return;
    }
    const path = url.pathname.slice(4);
    if (options.offline && !options.bootstrapStatus) { await route.abort("internetdisconnected"); return; }
    if (path === "/me" && options.bootstrapStatus) { await route.fulfill({ status: options.bootstrapStatus, json: { message: "Synthetic denied bootstrap" } }); return; }
    if (req.method() !== "GET") {
      writes.push({ path, body: req.postDataJSON() });
      await route.fulfill({ json: { ok: true } }); return;
    }
    let data: any;
    if (path === "/me") data = me;
    else if (path === "/campaigns") data = [{ ...campaign, id: options.campaignId || campaign.id }];
    else if (path === "/competency-model") data = model;
    else if (path === "/tests") data = [{ id: "situations", direction: "situations", name: { ru: "Управленческие ситуации" }, versions: [{ id: "synthetic-sjt-v3", version: 3, status: "published", _count: { questions: 14 }, delivery: { holdingModelVersion: DEFAULT_COMPETENCIES.holdingModelVersion, keyPanelStatus: "unapproved" } }] }];
    else if (path === "/people") data = [];
    else if (path === "/exercises") data = exercises;
    else if (/^\/people\/subject-(55|56)$/.test(path)) {
      data = participant(Number(path.split("-").at(-1)));
      if (options.results) data.assignments = [{ id: "synthetic-assignment", testVersion: { testId: "situations", version: 3, test: { name: { ru: "Управленческие ситуации" } } }, attempts: [{ status: "completed", results: [{ result: { algorithm: "sjt", total: 28, maximum: 28, percent: 100, details: [], holdingProfile: holdingSjtProfile(HOLDING_SJT_CASES.map(c => ({ questionId: c.questionId, score: 2 }))) } }] }] }];
    } else if (/^\/participants\/subject-(55|56)\/competencies$/.test(path)) data = evidence(Number(path.split("/")[2].split("-").at(-1)));
    else if (path === "/my/assignments") data = [];
    else { unexpected.push(path); await route.fulfill({ status: 500, json: { message: `Unstubbed synthetic request ${path}` } }); return; }
    await route.fulfill({ json: data });
  });
  try {
    await page.goto(`http://holding-ui.local${options.path || "/library"}`);
    await page.addStyleTag({ content: readFileSync("apps/web/app/globals.css", "utf8") });
    await page.addScriptTag({ content: bundle });
    await verify(page, writes);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  } finally { await context.close(); }
}
const modelLink = (page: Page) => page.getByRole("navigation", { name: "Главная навигация" }).getByRole("link", { name: "Модель компетенций", exact: true });

describe("ordinary client Holding navigation and source-preserving screens", () => {
  it.each(["admin", "expert"])("%s reaches the actual C1–C8 / 24 / 65 model without a privileged role", async role => {
    await mounted({ role }, async (page, writes) => {
      await modelLink(page).waitFor({ timeout: 2_000 });
      expect(await modelLink(page).getAttribute("href")).toBe("/model");
      await modelLink(page).click();
      await page.getByText("24 поведенческих индикатора", { exact: false }).waitFor({ timeout: 2_000 });
      expect(await page.locator("[data-indicator-id]:visible").count()).toBe(24);
      for (const c of HOLDING_COMPETENCIES) for (const i of c.indicators)
        expect(await page.locator(`[data-indicator-id="${i.id}"]`).textContent()).toContain(i.text.ru);
      expect(await page.getByRole("main").textContent()).toContain("Целевой уровень модели: В");
      expect(await page.getByRole("main").textContent()).toContain("Критичность — не вес и не требуемый балл");
      await page.getByText("Номерные должностные профили: 65", { exact: false }).click();
      expect(await page.locator("[data-profile-row]:visible").count()).toBe(65);
      for (const id of [55, 56, 58, 59]) expect(await page.locator(`[data-profile-row="${id}"] td`).first().textContent()).toBe(String(id));
      expect(await page.locator("[data-profile-row] td:last-child").allTextContents()).toEqual(Array(65).fill(""));
      const targetsFit = await page.locator("[data-profile-row]").first().locator("td:last-child").evaluate(cell => {
        const tableViewport = cell.closest(".table-wrap")!.getBoundingClientRect();
        return cell.getBoundingClientRect().right <= tableViewport.right + 1;
      });
      expect(targetsFit).toBe(true);
      expect(await page.getByRole("button", { name: "Утвердить модель Холдинга", exact: true }).count()).toBe(role === "expert" ? 1 : 0);
      expect(await page.getByRole("button", { name: "Сохранить новую версию", exact: true }).count()).toBe(role === "expert" ? 1 : 0);
      expect(writes).toEqual([]);
      if (role === "admin") {
        await page.getByText("Номерные должностные профили: 65", { exact: false }).click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${evidenceDir}/ui-admin-model.png`, fullPage: true });
        await page.getByText("Номерные должностные профили: 65", { exact: false }).click();
        await page.locator('[data-profile-row="55"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${evidenceDir}/ui-admin-numbered-profiles.png` });
      }
    });
  });
  it("admin finds the same model in library and settings; the preliminary key notice never reveals keys", async () => {
    await mounted({}, async page => {
      await page.getByRole("heading", { name: "Библиотека тестов" }).waitFor();
      const link = page.getByRole("main").getByRole("link", { name: /Модель компетенций/ });
      await link.waitFor({ timeout: 2_000 });
      expect(await link.getAttribute("href")).toBe("/model");
      expect(await page.getByText("Ключ не утверждён экспертной панелью", { exact: true }).count()).toBe(1);
      expect(await page.getByRole("main").textContent()).not.toMatch(/MOST ID|LEAST ID|mostOptionId/);
      await page.getByRole("navigation").getByRole("link", { name: "Настройки", exact: true }).click();
      await page.getByRole("heading", { name: "Настройки организации" }).waitFor();
      expect(await page.getByRole("main").getByRole("link", { name: /Модель компетенций/ }).getAttribute("href")).toBe("/model");
    });
  });
  it.each(["admin", "expert"])("%s sees the bound numbered participant profile and its eight criticalities without changing the binding", async role => {
    await mounted({ role, path: "/people/subject-56" }, async (page, writes) => {
      const tab = page.getByRole("button", { name: "Должностной профиль", exact: true });
      await tab.waitFor({ timeout: 2_000 });
      await tab.click();
      const profile = page.locator('[data-bound-profile="56"]');
      await profile.waitFor({ timeout: 2_000 });
      expect(await profile.textContent()).toContain("№ 56");
      expect(await profile.locator("[data-profile-competency]").count()).toBe(8);
      expect(await profile.locator("[data-profile-competency] td:nth-child(2)").allTextContents()).toEqual(HOLDING_COMPETENCIES.map(c => String(HOLDING_PROFILES[55].criticality[c.id])));
      expect(await profile.locator("[data-profile-competency] td:nth-child(3)").allTextContents()).toEqual(Array(8).fill("В"));
      expect(await profile.locator("[data-profile-competency] td:nth-child(4)").allTextContents()).toEqual(Array(8).fill(""));
      expect(await profile.getByRole("combobox").count()).toBe(0);
      expect(writes).toEqual([]);
      if (role === "expert") await page.screenshot({ path: `${evidenceDir}/ui-expert-participant-profile.png`, fullPage: true });
    });
  });
  it("the existing participant SJT results show all eight saved entries, only C2/C3/C4/C7 as numbers", async () => {
    await mounted({ path: "/people/subject-55", results: true }, async page => {
      await page.locator('[data-sjt-profile-code="C2"]').waitFor({ timeout: 2_000 });
      expect(await page.locator("[data-sjt-profile-code]").count()).toBe(8);
      for (const code of ["C2", "C3", "C4", "C7"]) expect(await page.locator(`[data-sjt-profile-code="${code}"]`).textContent()).toMatch(/\d+ \/ \d+/);
      for (const code of ["C1", "C5", "C6", "C8"]) {
        const text = await page.locator(`[data-sjt-profile-code="${code}"]`).textContent();
        expect(text).toContain(HOLDING_SINGLE_CASE_NOTE);
        expect(text).not.toMatch(/\d+ \/ \d+/);
      }
    });
  });
  it("the existing observation UI selects Not observed separately from score 1 and posts null", async () => {
    await mounted({ role: "expert", path: "/people/subject-55" }, async (page, writes) => {
      await page.getByRole("button", { name: "Практическая оценка", exact: true }).click();
      const criterion = page.locator(".criterion-block").first();
      const missing = criterion.getByRole("button", { name: "Не наблюдалось", exact: true });
      await missing.waitFor();
      for (const button of await page.getByRole("button", { name: "Не наблюдалось", exact: true }).all()) await button.click();
      expect(await missing.getAttribute("aria-pressed")).toBe("true");
      expect(await criterion.textContent()).toContain("не оценка 1");
      await page.getByLabel("Примеры наблюдаемого поведения", { exact: false }).fill("Синтетическое наблюдение для проверки отдельного статуса.");
      await page.getByRole("button", { name: "Сохранить наблюдение", exact: true }).click();
      await page.waitForFunction(() => document.body.textContent?.includes("Наблюдение сохранено"));
      expect(writes).toHaveLength(1);
      expect(writes[0].path).toBe("/observations");
      expect(writes[0].body.scores[exercises[0].criteria[0].id]).toBeNull();
      expect(Object.values(writes[0].body.scores)).not.toContain(1);
    });
  });
  it("consensus retains the separate notObserved=true / value=null contract", async () => {
    await mounted({ role: "expert", path: "/people/subject-55" }, async (page, writes) => {
      await page.getByRole("button", { name: "Компетенции и согласование", exact: true }).click();
      const rating = page.locator(".consensus-card").first().getByRole("combobox");
      await rating.waitFor();
      for (const card of await page.locator(".consensus-card").all()) {
        await card.getByRole("combobox").selectOption("not_observed");
        await card.getByLabel("Обоснование итогового балла", { exact: true }).fill("Синтетическая проверка: компетенция не наблюдалась.");
      }
      expect(await rating.inputValue()).toBe("not_observed");
      await page.getByRole("button", { name: "Сохранить итоговое согласование", exact: true }).click();
      await page.waitForFunction(() => document.body.textContent?.includes("Итоговые оценки сохранены"));
      expect(writes[0].body.ratings[0]).toMatchObject({ competencyId: "C1", value: null, notObserved: true });
    });
  });
});

describe("Application offline session identity boundary", () => {
  it("does not expose a newly bootstrapped organization with a stale React campaign while its permitted campaigns are loading", async () => {
    await mounted({ demo: false, campaignId: "review-demo-20261119", path: "/library", storage: { "assessflow.org": "damu-organization", "assessflow.campaign": "review-demo-20261119" } }, async page => {
      await page.getByRole("heading", { name: "Библиотека тестов", exact: true }).waitFor();
      const next = session("admin"); next.organization.id = "fund-client-demo-20261121"; next.organization.name = "Новая синтетическая организация";
      const invalidReads: string[] = [];
      page.on("request", request => {
        const url = new URL(request.url());
        if (/^\/api\/(people|participants|reports)/.test(url.pathname) && request.headers()["x-organization-id"] === next.organization.id &&
          url.searchParams.get("campaignId") === "review-demo-20261119") invalidReads.push(url.pathname + url.search);
      });
      let release!: () => void, requested!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const campaignsRequested = new Promise<void>(resolve => { requested = resolve; });
      await page.route("**/api/me", route => route.fulfill({ json: next }));
      await page.route("**/api/campaigns", async route => { requested(); await gate; await route.fulfill({ json: [{ ...campaign, id: "fund-client-demo-20261121-assessment" }] }); });
      await page.getByRole("navigation").getByRole("link", { name: "Сотрудники", exact: true }).click();
      await campaignsRequested;
      try {
        await page.waitForTimeout(100);
        expect(await page.locator(".workspace strong").filter({ hasText: next.organization.name }).count()).toBe(0);
      } finally { release(); }
      await page.locator(".workspace strong").filter({ hasText: next.organization.name }).waitFor();
      expect(await page.locator(".header-campaign select").inputValue()).toBe("fund-client-demo-20261121-assessment");
      expect(invalidReads).toEqual([]);
    });
  });
  it.each(["password", "consent"] as const)("a successful bootstrap with a current %s gate invalidates the previously authorized cache", async gate => {
    const cached = session("employee"); cached.demo = false; cached.organization.dataMode = "real";
    await mounted({ role: "employee", demo: false, gate, path: "/cabinet", storage: {
      "assessflow.org": cached.organization.id,
      "assessflow.offline-session": JSON.stringify({ version: 2, scope: { userId: cached.user.id, membershipId: cached.member.id, organizationId: cached.organization.id, demo: false, dataMode: "real" }, session: cached, campaigns: [campaign] }),
      "assessflow.answers.existing-attempt": "keep me",
    } }, async page => {
      await expect.poll(() => page.evaluate(() => localStorage.getItem("assessflow.offline-session")), { timeout: 2_000 }).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem("assessflow.answers.existing-attempt"))).toBe("keep me");
    });
  });
  it.each([401, 403])("does not restore even a scoped v2 cache on HTTP %s while navigator is offline", async status => {
    const cached = session("employee");
    await mounted({ offline: true, bootstrapStatus: status, storage: {
      "assessflow.org": cached.organization.id,
      "assessflow.offline-session": JSON.stringify({ version: 2, scope: { userId: cached.user.id, membershipId: cached.member.id, organizationId: cached.organization.id, demo: true, dataMode: "synthetic" }, session: cached, campaigns: [campaign] }),
    } }, async page => {
      await page.getByRole("heading", { name: "Вход", exact: true }).waitFor({ timeout: 2_000 });
      expect(await page.getByText("Синтетический employee", { exact: false }).count()).toBe(0);
      expect(await page.evaluate(() => localStorage.getItem("assessflow.offline-session"))).toBeNull();
    });
  });
  it("does not restore an unversioned real-tenant cache after a failed new bootstrap and preserves scoped answers", async () => {
    const old = session("employee");
    old.demo = false; old.user.name = "OLD REAL TENANT IDENTITY"; old.organization.id = "old-real-org"; old.organization.name = "OLD REAL TENANT";
    await mounted({ offline: true, storage: {
      "assessflow.org": "old-real-org",
      "assessflow.offline-session": JSON.stringify({ session: old, campaigns: [campaign] }),
      "assessflow.answers.existing-attempt": '{"saved":"answer"}',
    } }, async page => {
      await page.getByRole("heading", { name: "Вход", exact: true }).waitFor({ timeout: 2_000 });
      expect(await page.locator("body").textContent()).not.toContain("OLD REAL TENANT");
      expect(await page.evaluate(() => localStorage.getItem("assessflow.answers.existing-attempt"))).toBe('{"saved":"answer"}');
      expect(await page.evaluate(() => localStorage.getItem("assessflow.offline-session"))).toBeNull();
    });
  });
  it("a freshly authenticated employee keeps a versioned same-scope offline session without touching autosave", async () => {
    await mounted({ role: "employee", demo: false, path: "/cabinet", storage: { "assessflow.answers.existing-attempt": "keep me" } }, async page => {
      await page.getByText("Синтетический employee", { exact: false }).first().waitFor();
      const cached = await page.evaluate(() => JSON.parse(localStorage.getItem("assessflow.offline-session") || "null"));
      expect(cached.version).toBe(2);
      expect(cached.scope.organizationId).toBe("synthetic-org");
      await page.addInitScript(() => { Object.defineProperty(navigator, "onLine", { get: () => false }); });
      let bootstrapAttempts = 0;
      await page.route("**/api/me", route => { bootstrapAttempts++; return route.abort("internetdisconnected"); });
      // A fresh real Application mount starts with me=null, so the rendered
      // identity below can only come from the actual scoped cache restoration.
      await page.reload();
      await page.addScriptTag({ content: bundle });
      await page.getByText("Синтетический employee", { exact: false }).first().waitFor();
      expect(bootstrapAttempts).toBeGreaterThan(0);
      expect(await page.getByRole("heading", { name: "Вход", exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => localStorage.getItem("assessflow.answers.existing-attempt"))).toBe("keep me");
    });
  });
});
