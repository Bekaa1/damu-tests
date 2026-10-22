import ExcelJS from "exceljs";
import { chromium } from "playwright";
import { z } from "zod";
import { BadRequestException } from "@nestjs/common";
import { createPerson, listPeople } from "./people";
import { getReport } from "./assessment";
import { orgId, requireRole, type Context } from "./access";
import { audit } from "./db";
import { individualTemplate } from "./report-template";
const esc = (v: unknown) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const loc = (v: any, language = "ru") =>
  typeof v === "string" ? v : v?.[language] || v?.ru || "";
const csvSafe = (v: string) => (/^[=+@\-\t\r]/.test(v) ? `'${v}` : v);
export async function exportPeople(ctx: Context, campaignId: string) {
  const people = await listPeople(ctx, campaignId);
  const w = new ExcelJS.Workbook();
  w.creator = "AssessFlow";
  const sheet = w.addWorksheet("Участники");
  sheet.columns = [
    { header: "ФИО", key: "name", width: 30 },
    { header: "Email", key: "email", width: 32 },
    { header: "Должность", key: "position", width: 30 },
    { header: "Подразделение", key: "unit", width: 25 },
    { header: "Пройдено", key: "completed", width: 12 },
    { header: "Назначено", key: "total", width: 12 },
    { header: "Статус", key: "status", width: 18 },
    { header: "Отчёт", key: "report", width: 18 },
  ];
  for (const p of people.filter((p) => p.role === "employee"))
    sheet.addRow({
      name: csvSafe(p.user.name),
      email: csvSafe(p.user.email),
      position: csvSafe(p.position),
      unit: csvSafe(p.unit),
      completed: p.completed,
      total: p.total,
      status: p.status,
      report: p.report?.status || "",
    });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF142635" },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "H1" };
  const results = w.addWorksheet("Первичные результаты");
  results.columns = [
    { header: "Участник", key: "name", width: 30 },
    { header: "Методика", key: "method", width: 35 },
    { header: "Шкала", key: "scale", width: 35 },
    { header: "Баллы / среднее", key: "value", width: 20 },
    { header: "Максимум", key: "max", width: 15 },
  ];
  for (const p of people)
    for (const r of p.results) {
      const s = r.score as any;
      if (!s) continue;
      if (s.scales) {
        for (const [id, scale] of Object.entries(s.scales) as [string, any][])
          results.addRow({
            name: csvSafe(p.user.name),
            method: loc(r.name),
            scale: loc(scale.name),
            value: scale.mean,
            max: scale.max,
          });
      } else
        results.addRow({
          name: csvSafe(p.user.name),
          method: loc(r.name),
          scale:
            s.algorithm === "sjt"
              ? "Предварительный индекс совпадения"
              : "Первичный балл",
          value: s.total,
          max: s.maximum,
        });
    }
  results.getRow(1).font = { bold: true };
  await audit(orgId(ctx), ctx.user.id, "data.exported", campaignId, {
    format: "xlsx",
  });
  return Buffer.from(await w.xlsx.writeBuffer());
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let cell = "",
    quoted = false;
  const delimiter = text.split("\n")[0].includes(";") ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push([...row]);
      row.length = 0;
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  if (quoted) throw new BadRequestException("Незакрытая кавычка в CSV");
  return rows;
}
export async function importPeople(ctx: Context, input: unknown) {
  requireRole(ctx, "admin");
  const d = z
    .object({ name: z.string(), base64: z.string().max(11 * 1024 * 1024) })
    .parse(input);
  const buffer = Buffer.from(d.base64, "base64");
  if (buffer.length > 8 * 1024 * 1024)
    throw new BadRequestException("Максимум 8 МБ");
  let rows: string[][] = [];
  if (d.name.toLowerCase().endsWith(".csv"))
    rows = parseCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  else if (d.name.toLowerCase().endsWith(".xlsx")) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as any);
    book.worksheets[0]?.eachRow((row) =>
      rows.push(
        (row.values as any[])
          .slice(1)
          .map((v) =>
            typeof v === "object"
              ? (v?.text ?? v?.result ?? "")
              : String(v ?? ""),
          ),
      ),
    );
  } else throw new BadRequestException("Поддерживаются .xlsx и .csv");
  if (rows.length > 501)
    throw new BadRequestException("Максимум 500 сотрудников за импорт");
  const headers = rows.shift()?.map((v) => v.trim().toLowerCase()) || [];
  if (!["name", "email", "unit"].every((h) => headers.includes(h)))
    throw new BadRequestException("Нужны заголовки name, email, unit");
  const created: any[] = [],
    errors: { row: number; message: string }[] = [];
  for (const [i, row] of rows.entries()) {
    if (!row.some(Boolean)) continue;
    try {
      const person = Object.fromEntries(
        headers.map((h, j) => [h, row[j]?.trim() || undefined]),
      );
      created.push(await createPerson(ctx, { ...person, role: "employee" }));
    } catch (e) {
      errors.push({ row: i + 2, message: (e as Error).message });
    }
  }
  return { created, errors };
}
const pdfCss = `*{box-sizing:border-box}body{font-family:Arial,'DejaVu Sans',sans-serif;color:#243746;font-size:10px;margin:0}h1{font-size:25px;line-height:1.3;margin:12px 0 8px;font-weight:600}h2{font-size:16px;margin:23px 0 14px}h3{font-size:12px;margin:17px 0 9px}p{line-height:1.75;margin:7px 0;white-space:pre-wrap}table{border-collapse:collapse;width:100%;font-size:9px}th{text-align:left;background:#edf2f4;color:#627683;padding:10px}td{padding:10px;border-bottom:1px solid #e2e8eb;vertical-align:top;line-height:1.6}tr{break-inside:avoid}.page{break-after:page}.page:last-child{break-after:auto}.brand{font-size:14px;color:#326a5b;font-weight:bold;display:flex;justify-content:space-between;border-bottom:2px solid #253e4d;padding-bottom:14px}.brand img{height:35px;max-width:130px;object-fit:contain}.eyebrow{color:#74918d;font-size:9px;letter-spacing:1.7px;margin-top:20px}.sub{color:#8b9ba4;font-size:9px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.box{padding:15px;background:#f5f8f9;border:1px solid #e0e8eb;border-radius:5px;margin:15px 0}.bar{height:7px;background:#ecf1f3;border-radius:3px;margin:7px 0 13px}.bar span{display:block;height:100%;background:#6b9988;border-radius:3px}.row{display:flex;justify-content:space-between;font-size:10px}.muted{color:#81909a}.limit{font-size:8px;line-height:1.7;color:#89949d;margin-bottom:8px}.label{font-size:8px;color:#91a0a9}.matrix{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.matrix>div{border:1px solid #dce7e2;padding:10px;min-height:80px;background:#f4f8f5}.keep{break-inside:avoid}`;
async function pdf(html: string, label: string, language = "ru") {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    await page.setContent(
      `<html lang="${language}"><head><meta charset="utf-8"><style>${pdfCss}</style></head><body>${html}</body></html>`,
      { waitUntil: "load" },
    );
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      margin: { top: "17mm", bottom: "18mm", left: "18mm", right: "18mm" },
      headerTemplate: "<div></div>",
      footerTemplate: `<div style="font-size:8px;color:#85949c;padding:0 18mm;width:100%;display:flex;justify-content:space-between"><span>AssessFlow · ${esc(label)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
}
function scoreBars(
  scales: Record<string, any>,
  filter?: (id: string) => boolean,
) {
  return Object.entries(scales)
    .filter(([id]) => !filter || filter(id))
    .map(
      ([id, s]) =>
        `<div class="keep"><div class="row"><span>${esc(loc(s.name))}</span><b>${Number(s.mean).toFixed(2)} / ${s.max}</b></div><div class="bar"><span style="width:${Math.max(0, Math.min(100, ((s.mean - s.min) / (s.max - s.min)) * 100))}%"></span></div></div>`,
    )
    .join("");
}
export async function exportIndividualPdf(ctx: Context, id: string) {
  const data = await getReport(ctx, id),
    language = ctx.user.locale === "kk" ? "kk" : "ru";
  const rendered = individualTemplate(data, language);
  await audit(orgId(ctx), ctx.user.id, "report.pdf_exported", id);
  return pdf(rendered.html, rendered.label, language);
}
export async function exportTeamPdf(ctx: Context, campaignId: string) {
  const people = (await listPeople(ctx, campaignId)).filter(
    (p) => p.role === "employee",
  );
  const done = people.filter((p) => p.status === "completed").length;
  const units = [...new Set(people.map((p) => p.unit))];
  const header = `<div class="brand"><span>${esc(ctx.org!.name)}</span><span>AssessFlow</span></div>`;
  const content = `<section class="page">${header}<div class="eyebrow">КОМАНДНАЯ АНАЛИТИКА</div><h1>Сводный отчёт организации</h1><div class="box"><p>Участников: ${people.length} · Завершили тестирование: ${done} · Утверждено отчётов: ${people.filter((p) => p.report?.status === "approved").length}</p></div><h2>Сравнение подразделений</h2><table><tr><th>Подразделение</th><th>Участников</th><th>Завершили</th><th>Доля</th></tr>${units
    .map((u) => {
      const ps = people.filter((p) => p.unit === u),
        ds = ps.filter((p) => p.status === "completed").length;
      return `<tr><td>${esc(u)}</td><td>${ps.length}</td><td>${ds}</td><td>${Math.round((ds / ps.length) * 100)}%</td></tr>`;
    })
    .join(
      "",
    )}</table><h2>Матрица потенциала 9-box</h2><p class="muted">По горизонтали: ${esc(loc((ctx.org!.matrixConfig as any).x))}. По вертикали: ${esc(loc((ctx.org!.matrixConfig as any).y))}. Высокий уровень сверху и справа.</p><div class="matrix">${[
    3, 2, 1,
  ]
    .flatMap((y) =>
      [1, 2, 3].map(
        (x) =>
          `<div><b>${y} / ${x}</b><p>${
            people
              .filter((p) => p.report?.matrixX === x && p.report?.matrixY === y)
              .map((p) => esc(p.user.name))
              .join("<br>") || "—"
          }</p></div>`,
      ),
    )
    .join(
      "",
    )}</div><p class="limit">Положение определяется экспертом с обоснованием. Сотрудников без оценки: ${people.filter((p) => !p.report?.matrixX).length}. Автоматические AI-оценки для матрицы не используются.</p><h2>Методологические ограничения</h2><p>Локальные нормативы не применяются. Сравнивать можно только совпадающие шкалы одной версии методики. Итоговый рейтинг пригодности не рассчитывается. Рекомендации команды требуют экспертного обсуждения индивидуальных заключений.</p></section><section class="page">${header}<h1>Реестр участников</h1><table><tr><th>Участник</th><th>Подразделение</th><th>Прогресс</th><th>Заключение</th></tr>${people.map((p) => `<tr><td>${esc(p.user.name)}</td><td>${esc(p.unit)}</td><td>${p.completed} / ${p.total}</td><td>${p.report?.status === "approved" ? "Утверждено" : p.report ? "Черновик" : "Ожидается"}</td></tr>`).join("")}</table></section>`;
  await audit(orgId(ctx), ctx.user.id, "team.pdf_exported", campaignId);
  return pdf(content, "Сводный отчёт");
}
