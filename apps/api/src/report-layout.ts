export { customerReportTemplate as professionalReportTemplate } from "./customer-report";
export const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function sanitizePdfText(value: unknown) {
  return String(value ?? "")
    .replace(
      /\bAI(?:[\s-]*(?:generated|powered|written|created))?[\s\-–—]*/gi,
      "",
    )
    .replace(/(?:Версия|Version)\s+1\.0-draft(?:\s*[·•]\s*(?:RU|KK))?/giu, "")
    .replace(
      /Баллы обозначают число правильных ответов выбранной формы\.[\s\S]*?не является процентилем\./giu,
      "",
    )
    .replace(
      /Первичные баллы не являются процентилями или оценкой пригодности к должности\./giu,
      "",
    )
    .replace(/Показаны фактические значения шкал\.[\s\S]*?преимущество\./gi, "")
    .replace(/WMPS:\s*средние значения[\s\S]*?(?:уровней|нормативтер)\./gi, "")
    .replace(
      /SJT:\s*число совпадений MOST и LEAST[\s\S]*?(?:потенциала|әлеуетінің)\./gi,
      "",
    )
    .replace(
      /Практические оценки компетенций ещё не внесены\.[\s\S]*?(?:разделах|бөлімдерде)\./gi,
      "",
    )
    .replace(/[^.!?]*(?:\b9[- ]?box\b|матриц\p{L}*|matrix)[^.!?]*[.!?]?/giu, "")
    .replace(
      /,\s*(?:\d+\s+)?(?:практическ\p{L}*\s+(?:задан\p{L}*|упражнен\p{L}*|оценк\p{L}*)|практикалық\s+(?:тапсырмалар|жаттығулар|бағалар))[^,;.]*?(?:не\s+(?:проводил\p{L}*|внесен\p{L}*|представлен\p{L}*)|отсутств\p{L}*|жоқ|жүргізілмеген)[^,;.]*,?/giu,
      ",",
    )
    .replace(
      /(?:^|\n)\s*(?:\d+\s+)?(?:практическ\p{L}*\s+(?:задан\p{L}*|упражнен\p{L}*|оценк\p{L}*)|практикалық\s+(?:тапсырмалар|жаттығулар|бағалар))[^.!?]*?(?:не\s+(?:проводил\p{L}*|внесен\p{L}*|представлен\p{L}*)|отсутств\p{L}*|жоқ|жүргізілмеген)[^.!?]*[.!?]?/giu,
      "",
    )
    .replace(/,\s*,/g, ",")
    .replace(/(?:^|\n)\s*Контекст интерпретации\b[\s\S]*$/i, "")
    .replace(/Демонстрационное заключение\.[\s\S]*?(?=$|\n)/gi, "")
    .replace(/([.!?])\s*[.!?]+/g, "$1")
    .replace(/(^|\n)\s*[.,;:!?]+\s*/g, "$1")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
export const reportCss = [
  ".score-calculation{font-size:13px;line-height:1.6;margin:0 0 18px;font-weight:600;color:#285f58}.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:24px;break-inside:avoid}",
  "*{box-sizing:border-box}body{margin:0;color:#1e3442;font:13px/1.55 Arial,'DejaVu Sans',sans-serif}",
  "h1,h2,h3,p{margin:0}h1{font-size:29px;line-height:1.2;letter-spacing:-.5px;margin:13px 0 9px}h2{font-size:19px;line-height:1.3;margin:25px 0 12px}h3{font-size:14px;margin:17px 0 9px}h1,h2,h3{break-after:avoid}",
  "p{margin:9px 0;white-space:pre-line;overflow-wrap:anywhere;orphans:3;widows:3}small,.muted{color:#657a86}.note{font-size:11px;line-height:1.55;color:#657a86;margin:10px 0 16px}",
  ".report-page{break-before:page;display:flow-root}.report-page:first-child{break-before:auto}.report-body,.report-heading{display:flow-root}.brand{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #246b65;padding-bottom:12px;margin-bottom:20px;font-size:12px;color:#57727d}.brand b{font-size:18px;color:#1c3745}.kicker{text-transform:uppercase;font-size:10px;letter-spacing:1.8px;color:#427c75;font-weight:bold}.subtitle{font-size:12px;color:#607581;margin-bottom:18px}",
  ".report-cover{min-height:880px;display:flex;flex-direction:column}.cover-main{margin-top:65px}.cover-main h1{font-size:44px;max-width:530px;line-height:1.13;margin:22px 0}.cover-rule{height:5px;width:75px;background:#286f67;margin:30px 0}.cover-person{font-size:26px;margin:15px 0}.cover-meta{margin-top:auto;border-top:1px solid #d7e1e6;padding-top:22px}.status-pill{display:inline-block;border:1px solid #b3d2cb;color:#276b62;background:#eff7f4;padding:6px 12px;border-radius:20px;font-size:11px}",
  ".grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:13px}.stat{padding:16px 18px;background:#f0f5f6;border-radius:8px;break-inside:avoid}.stat strong{font-size:30px;display:block;line-height:1.3;color:#246b65}.stat span{font-size:11px;color:#58707d}.callout{border-left:3px solid #318074;padding:12px 16px;background:#eff6f4;margin:17px 0}.callout p:first-child{margin-top:0}.callout p:last-child{margin-bottom:0}.chart-card{border:1px solid #dce5e9;border-radius:8px;padding:16px 18px;margin:13px 0;break-inside:avoid}.chart-card h3{margin:0 0 10px}.keep{break-inside:avoid}",
  ".metric{margin:15px 0 17px;break-inside:avoid}.metric-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:7px}.metric-head strong{white-space:nowrap;font-size:14px}.metric-head span{max-width:77%}.track{height:10px;background:#e6eef0;border-radius:5px;position:relative}.track i{display:block;height:100%;background:#347e74;border-radius:5px;min-width:0}.axis{display:flex;justify-content:space-between;color:#78909c;font-size:10px;margin-top:3px}.metric small{font-size:10px}",
  "svg{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:11.5px;margin:13px 0}thead{display:table-header-group}th{text-align:left;padding:10px;background:#edf3f4;font-weight:600;color:#526d7a}td{padding:11px 10px;vertical-align:top;border-bottom:1px solid #e1e8eb;overflow-wrap:anywhere}tr{break-inside:avoid}td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.source{font-size:10px;color:#728793}.legend{display:flex;gap:15px;align-items:center;font-size:11px;color:#59707c}.legend i{display:inline-block;width:9px;height:9px;background:#347e74;border-radius:50%;margin-right:5px}",
  ".plan-card{padding:16px 18px;border:1px solid #d9e4e7;border-radius:7px;margin:14px 0;break-inside:avoid}.plan-card h3{margin:0 0 10px;color:#216b61}.plan-number{font-size:11px;font-weight:bold;letter-spacing:1px;color:#698f86}.plan-meta{display:grid;grid-template-columns:1fr 1fr;gap:14px;border-top:1px solid #e5ecef;padding-top:10px;margin-top:12px;font-size:11px}.quote{padding:12px 16px;border-left:3px solid #a7bfca;margin:12px 0;background:#f6f8f9}.quote small{display:block;margin-bottom:5px}.appendix{font-size:11px}.no-data{padding:15px;background:#f4f7f8;color:#617983;border-radius:5px;margin:12px 0}",
  ".facet-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 30px}.facet-grid .metric{margin:8px 0 10px;font-size:11px}.facet-grid .metric-head{margin-bottom:4px}.facet-grid .metric-head strong{font-size:11px}.facet-grid .track{height:6px}.facet-grid .axis{display:none}",
].join("\n");
