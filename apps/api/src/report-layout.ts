import { reportLoc, reportMetrics, type GeneratedContent, type ReportMetric, type ReportSnapshot, type ReportLanguage } from "../../../packages/core/reporting";
export const escapeHtml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function sanitizePdfText(value: unknown) {
  return String(value ?? "")
    .replace(/\bAI(?:[\s-]*(?:generated|powered|written|created))?[\s\-–—]*/gi, "")
    .replace(/(?:Версия|Version)\s+1\.0-draft(?:\s*[·•]\s*(?:RU|KK))?/giu, "")
    .replace(/Баллы обозначают число правильных ответов выбранной формы\.[\s\S]*?не является процентилем\./giu, "")
    .replace(/Первичные баллы не являются процентилями или оценкой пригодности к должности\./giu, "")
    .replace(/Показаны фактические значения шкал\.[\s\S]*?преимущество\./gi, "")
    .replace(/WMPS:\s*средние значения[\s\S]*?(?:уровней|нормативтер)\./gi, "")
    .replace(/SJT:\s*число совпадений MOST и LEAST[\s\S]*?(?:потенциала|әлеуетінің)\./gi, "")
    .replace(/Практические оценки компетенций ещё не внесены\.[\s\S]*?(?:разделах|бөлімдерде)\./gi, "")
    .replace(/[^.!?]*(?:\b9[- ]?box\b|матриц\p{L}*|matrix)[^.!?]*[.!?]?/giu, "")
    .replace(/,\s*(?:\d+\s+)?(?:практическ\p{L}*\s+(?:задан\p{L}*|упражнен\p{L}*|оценк\p{L}*)|практикалық\s+(?:тапсырмалар|жаттығулар|бағалар))[^,;.]*?(?:не\s+(?:проводил\p{L}*|внесен\p{L}*|представлен\p{L}*)|отсутств\p{L}*|жоқ|жүргізілмеген)[^,;.]*,?/giu, ",")
    .replace(/(?:^|\n)\s*(?:\d+\s+)?(?:практическ\p{L}*\s+(?:задан\p{L}*|упражнен\p{L}*|оценк\p{L}*)|практикалық\s+(?:тапсырмалар|жаттығулар|бағалар))[^.!?]*?(?:не\s+(?:проводил\p{L}*|внесен\p{L}*|представлен\p{L}*)|отсутств\p{L}*|жоқ|жүргізілмеген)[^.!?]*[.!?]?/giu, "")
    .replace(/,\s*,/g, ",")
    .replace(/(?:^|\n)\s*Контекст интерпретации\b[\s\S]*$/i, "")
    .replace(/Демонстрационное заключение\.[\s\S]*?(?=$|\n)/gi, "")
    .replace(/([.!?])\s*[.!?]+/g, "$1")
    .replace(/(^|\n)\s*[.,;:!?]+\s*/g, "$1")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
const e = (value: unknown) => escapeHtml(sanitizePdfText(value));
const number = (value: number, language: ReportLanguage, digits = 1) => value.toLocaleString(language === "ru" ? "ru-RU" : "kk-KZ", { maximumFractionDigits: digits });
const proportion = (value: number, min: number, max: number) => Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
export const reportCss = [
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

function metricBar(m: ReportMetric, language: ReportLanguage, team: boolean) {
  const t = (ru: string, kk: string) => language === "ru" ? ru : kk;
  return '<div class="metric"><div class="metric-head"><span>' + e(m.name) + '</span><strong>' + number(m.mean, language, 2) + ' / ' + m.max + '</strong></div><div class="track"><i style="width:' + proportion(m.mean, m.min, m.max).toFixed(2) + '%"></i></div><div class="axis"><span>' + m.min + '</span><span>' + m.max + '</span></div>' +
    (team ? '<small>' + t("Участников", "Қатысушылар") + ': ' + m.n + ' · ' + t("Диапазон", "Ауқым") + ': ' + number(m.low, language) + '-' + number(m.high, language) + '</small>' : "") + '</div>';
}
function radar(metrics: ReportMetric[], language: ReportLanguage) {
  if (metrics.length < 3 || metrics.length > 6) return "";
  const size = 330, center = 165, radius = 102;
  const point = (i: number, factor: number) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / metrics.length;
    return [center + Math.cos(a) * radius * factor, center + Math.sin(a) * radius * factor];
  };
  const coords = (factor: number) => metrics.map((_, i) => point(i, factor).join(",")).join(" ");
  const grid = [0.25, 0.5, 0.75, 1].map(f => '<polygon points="' + coords(f) + '" fill="none" stroke="#d9e4e8" stroke-width="1"/>').join("");
  const axes = metrics.map((_, i) => '<line x1="165" y1="165" x2="' + point(i, 1)[0] + '" y2="' + point(i, 1)[1] + '" stroke="#d9e4e8"/>').join("");
  const values = metrics.map((m, i) => point(i, proportion(m.mean, m.min, m.max) / 100).join(",")).join(" ");
  const labels = metrics.map((m, i) => {
    const [x, y] = point(i, 1.22);
    return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-size="11" fill="#426572">' + e(m.scale) + ' ' + number(m.mean, language, 2) + '</text>';
  }).join("");
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Personality profile">' + grid + axes + '<polygon points="' + values + '" fill="#347e74" fill-opacity=".18" stroke="#347e74" stroke-width="2"/>' + labels + '</svg>';
}
function donut(done: number, total: number) {
  const percentage = total ? done / total * 100 : 0;
  return '<svg viewBox="0 0 210 210" role="img" aria-label="Assessment completion"><circle cx="105" cy="105" r="76" fill="none" stroke="#e4edef" stroke-width="20"/><circle cx="105" cy="105" r="76" fill="none" stroke="#347e74" stroke-width="20" pathLength="100" stroke-dasharray="' + percentage + ' 100" transform="rotate(-90 105 105)"/><text x="105" y="107" text-anchor="middle" font-size="36" font-weight="bold" fill="#213f4e">' + Math.round(percentage) + '%</text><text x="105" y="130" text-anchor="middle" font-size="13" fill="#738c97">' + done + ' / ' + total + '</text></svg>';
}

export function professionalReportTemplate(snapshot: ReportSnapshot, content: GeneratedContent, options: { kind: "individual" | "team"; language: ReportLanguage; createdAt: Date | string; label?: string }) {
  const { kind, language } = options, team = kind === "team", person = snapshot.people[0];
  const t = (ru: string, kk: string) => language === "ru" ? ru : kk;
  const metrics = reportMetrics(snapshot, language);
  const label = options.label || t("Отчёт", "Есеп");
  const title = team ? t("Командный отчёт", "Командалық есеп") : t("Индивидуальный отчёт", "Жеке есеп");
  const brand = '<div class="brand"><b>AssessFlow</b><span>' + e(snapshot.organization.name) + '</span></div>';
  const date = new Date(options.createdAt).toLocaleDateString(language === "ru" ? "ru-RU" : "kk-KZ");
  const header = (index: string, heading: string) => brand + '<div class="kicker">' + e(title) + ' / ' + index + '</div><h1>' + e(heading) + '</h1><div class="subtitle">' + e(team ? snapshot.campaign.name : person.name) + ' · ' + date + '</div>';
  const page = (index: string, heading: string, body: string) => '<section class="report-page">' + header(index, heading) + body + '</section>';
  const cleanPdfNarrative = sanitizePdfText;
  const isDemonstrationText = (value: string) => /демонстрационное заключение|результаты созданы для проверки платформы|не относятся к реальному сотруднику/i.test(value);
  const narrative = (key: keyof GeneratedContent) => ((content[key] || []) as any[])
    .map(v => cleanPdfNarrative(v.text || v))
    .filter(text => text && !isDemonstrationText(text))
    .map(text => '<p>' + e(text) + '</p>').join("");
  const bars = (items: ReportMetric[]) => items.map(m => metricBar(m, language, team)).join("");
  const groups = (items: ReportMetric[]) => {
    const grouped = new Map<string, ReportMetric[]>();
    for (const metric of items) {
      const key = JSON.stringify([metric.method, metric.version, metric.language]);
      grouped.set(key, [...(grouped.get(key) || []), metric]);
    }
    return [...grouped.values()].map(ms => '<div class="chart-card"><h3>' + e(ms[0].method) + '</h3>' + bars(ms) + '</div>').join("");
  };
  const empty = (text: string) => '<div class="no-data">' + e(text) + '</div>';
  const cognitive = metrics.filter(m => !["personality", "motivation", "sjt", "expert"].includes(m.testId));
  const personality = metrics.filter(m => m.testId === "personality" && m.scale.length === 1);
  const motivation = metrics.filter(m => m.testId === "motivation");
  const sjt = metrics.filter(m => m.testId === "sjt");
  const competencies = metrics.filter(m => m.testId === "expert");
  const competencyComparisons = team ? competencies.map(m => '<h3>' + e(m.name) + ' · ' + e(m.method) + '</h3><table><thead><tr><th>' + t("Подразделение", "Бөлімше") + '</th><th>n</th><th>' + t("Средний балл", "Орташа балл") + '</th></tr></thead><tbody>' + m.units.map(u => '<tr><td>' + e(u.name) + '</td><td>' + u.n + '</td><td>' + number(u.mean, language, 2) + ' / ' + m.max + '</td></tr>').join("") + '</tbody></table>').join("") : "";
  const completed = snapshot.people.filter(p => p.status === "completed").length;
  const approved = snapshot.people.filter(p => p.expert?.status === "approved").length;
  const cover = '<section class="report-page report-cover">' + brand + '<div class="cover-main"><div class="kicker">' + t("Оценка и профессиональное развитие", "Бағалау және кәсіби даму") + '</div><h1>' + e(title) + '</h1><div class="cover-rule"></div><div class="cover-person">' + e(team ? snapshot.organization.name : person.name) + '</div><p>' + e(team ? snapshot.campaign.name : [person.position, person.unit].filter(Boolean).join(" · ")) + '</p><p class="muted">' + e(team ? snapshot.people.length + ' ' + t("участников", "қатысушы") : snapshot.campaign.name) + '</p><p><span class="status-pill">' + e(cleanPdfNarrative(label)) + '</span></p></div><div class="cover-meta"><div class="grid2"><div><div class="kicker">' + t("Дата формирования", "Жасалған күні") + '</div><p>' + date + '</p></div><div><div class="kicker">' + t("Основа отчёта", "Есептің негізі") + '</div><p>' + t("Результаты тестов и доступные экспертные оценки", "Тест нәтижелері және қолжетімді сараптамалық бағалар") + '</p></div></div><p class="note">' + t("Персонализированный анализ с практическими рекомендациями.", "Практикалық ұсыныстары бар дербестендірілген талдау.") + '</p></div></section>';

  const units = [...new Set(snapshot.people.map(p => p.unit))];
  const unitTable = '<table><thead><tr><th>' + t("Подразделение", "Бөлімше") + '</th><th>' + t("Участники", "Қатысушылар") + '</th><th>' + t("Завершили", "Аяқтады") + '</th><th>%</th></tr></thead><tbody>' + units.map(unit => {
    const people = snapshot.people.filter(p => p.unit === unit), done = people.filter(p => p.status === "completed").length;
    return '<tr><td>' + e(unit) + '</td><td>' + people.length + '</td><td>' + done + '</td><td>' + Math.round(done / people.length * 100) + '%</td></tr>';
  }).join("") + '</tbody></table>';
  const overview = page("01", team ? t("Команда: результаты и контекст", "Команда: нәтижелер мен контекст") : t("Профиль участника и способности", "Қатысушының бейіні және қабілеттері"),
    (team ? '<div class="grid2"><div>' + donut(completed, snapshot.people.length) + '</div><div><div class="stat"><strong>' + snapshot.people.length + '</strong><span>' + t("участников в кампании", "науқандағы қатысушылар") + '</span></div><p>' + t("Подразделений", "Бөлімшелер") + ': ' + units.length + '<br>' + t("Экспертных заключений утверждено", "Бекітілген сараптамалық қорытындылар") + ': ' + approved + '</p></div></div>' : '<div class="grid2"><div class="stat"><strong>' + person.completed + ' / ' + person.total + '</strong><span>' + t("тестов завершено", "тест аяқталды") + '</span></div><div class="stat"><strong>' + date.slice(0,5) + '</strong><span>' + t("дата отчёта", "есеп күні") + '</span></div></div>') +
    '<h2>' + t("Ключевые выводы", "Негізгі қорытындылар") + '</h2>' + narrative("summary") +
    (team ? '<h2>' + t("Головной офис и филиалы", "Бас кеңсе және филиалдар") + '</h2>' + unitTable : '<h2>' + t("Аналитические способности", "Талдау қабілеттері") + '</h2>' + groups(cognitive) + narrative("analytical")));

  const comparisons = team ? page("02", t("Способности и сравнение подразделений", "Қабілеттер мен бөлімшелерді салыстыру"),
    groups(cognitive) + narrative("analytical") +
    cognitive.map(m => '<h3>' + e(m.name) + '</h3><table><thead><tr><th>' + t("Подразделение", "Бөлімше") + '</th><th>n</th><th>' + t("Средний балл", "Орташа балл") + '</th></tr></thead><tbody>' + m.units.map(u => '<tr><td>' + e(u.name) + '</td><td>' + u.n + '</td><td>' + number(u.mean, language, 2) + ' / ' + m.max + '</td></tr>').join("") + '</tbody></table>').join("")
  ) : "";

  const personalityPage = page(team ? "03" : "02", t("Личность и профессиональный стиль", "Тұлға және кәсіби стиль"),
    (!team && personality.length === 5 ? '<div class="grid2"><div>' + radar(personality, language) + '</div><div>' + bars(personality) + '</div></div>' : groups(personality)) +
    narrative("personality") +
    '<h2>' + t("Сильные стороны", "Күшті жақтар") + '</h2>' + narrative("strengths"));

  const motivationPage = page(team ? "04" : "03", t("Мотивация и управленческие решения", "Мотивация және басқарушылық шешімдер"),
    groups(motivation) + narrative("motivation") +
    '<h2>' + t("Управленческие ситуации", "Басқарушылық жағдайлар") + '</h2>' + groups(sjt) + narrative("management"));

  const practice = !team ? person.observations.map(o => '<div class="quote"><small>' + e(reportLoc(o.criteriaSnapshot.name, language)) + '</small><p>' + e(o.notes) + '</p></div>').join("") : "";
  const competencyPage = page(team ? "05" : "04", t("Компетенции, потенциал и риски", "Құзыреттер, әлеует және тәуекелдер"),
    (competencies.length ? groups(competencies) + narrative("competencies") : "") +
    (competencyComparisons ? '<h2>' + t("Компетенции по подразделениям", "Бөлімшелер бойынша құзыреттер") + '</h2>' + competencyComparisons : "") +
    (practice ? '<h2>' + t("Наблюдаемое поведение", "Бақыланған мінез-құлық") + '</h2>' + practice : "") +
    narrative("potential") +
    '<h2>' + t("Поведенческие и управленческие риски", "Мінез-құлық және басқарушылық тәуекелдер") + '</h2>' + narrative("risks"));

  const developmentPage = page(team ? "06" : "05", team ? t("Развитие команды: план действий", "Команданы дамыту: іс-қимыл жоспары") : t("Индивидуальный план развития", "Жеке даму жоспары"),
    '<h2>' + t("Приоритетные направления", "Басым бағыттар") + '</h2>' + narrative("development") +
    '<h2>' + t("Практические рекомендации", "Практикалық ұсыныстар") + '</h2>' + narrative("recommendations") +
    (content.developmentPlan || []).map((p, i) => '<div class="plan-card"><div class="plan-number">' + t("ШАГ", "ҚАДАМ") + ' ' + String(i+1).padStart(2, "0") + '</div><h3>' + e(cleanPdfNarrative(p.focus)) + '</h3><p>' + e(cleanPdfNarrative(p.action)) + '</p><div class="plan-meta"><div><b>' + t("Формат", "Формат") + '</b><br>' + e(cleanPdfNarrative(p.format)) + '</div><div><b>' + t("Предлагаемый срок", "Ұсынылатын мерзім") + '</b><br>' + e(cleanPdfNarrative(p.timeframe)) + '</div></div><p><b>' + t("Как оценить прогресс", "Ілгерілеуді бағалау") + ':</b> ' + e(cleanPdfNarrative(p.success)) + '</p></div>').join(""));

  const roster = team ? page("A", t("Приложение: состав группы", "Қосымша: топ құрамы"),
    '<table><thead><tr><th>' + t("Участник", "Қатысушы") + '</th><th>' + t("Подразделение", "Бөлімше") + '</th><th>' + t("Тесты", "Тесттер") + '</th></tr></thead><tbody>' + snapshot.people.map(p => '<tr><td>' + e(p.name) + '<br><small>' + e(p.position) + '</small></td><td>' + e(p.unit) + '</td><td>' + p.completed + ' / ' + p.total + '</td></tr>').join("") + '</tbody></table>') : "";
  const facets = metrics.filter(m => m.testId === "personality" && m.scale.length > 1);
  const appendix = !team && facets.length ? page("A", t("Приложение: подробный личностный профиль", "Қосымша: толық тұлғалық бейін"), '<p class="note">' + t("Средние значения аспектов личности по шкале 1–5.", "Тұлға қырларының 1–5 шкаласы бойынша орташа мәндері.") + '</p><div class="facet-grid">' + bars(facets) + '</div>') : roster;
  return { html: cover + overview + comparisons + personalityPage + motivationPage + competencyPage + developmentPage + appendix, label };
}
