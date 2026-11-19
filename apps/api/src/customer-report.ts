import type {
  GeneratedContent,
  ReportSnapshot,
  ReportLanguage,
} from "../../../packages/core/reporting";
import {
  reportText,
  personalityProfile,
  motivationProfile,
  levelText,
  roundReport,
} from "../../../packages/core/report-policy";
import { testScoreSummary } from "../../../packages/core/test-levels";
import { teamTestReportData } from "../../../packages/core/team-reporting";
import { sanitizePdfText } from "./report-layout";

const n = (v: number, lang: ReportLanguage) =>
  roundReport(v).toLocaleString(lang === "ru" ? "ru-RU" : "kk-KZ", {
    maximumFractionDigits: 1,
  });

export function customerReportTemplate(
  snapshot: ReportSnapshot,
  content: GeneratedContent,
  options: {
    kind: "individual" | "team";
    language: ReportLanguage;
    createdAt: Date | string;
    presentationEdits?: Record<string, string>;
    collectText?: (text: string) => void;
  },
) {
  const e = (s: unknown) => {
    const original = String(s ?? "");
    options.collectText?.(original);
    return sanitizePdfText(options.presentationEdits?.[original] ?? original)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  };
  const { language: lang, kind } = options,
    team = kind === "team";
  const t = (ru: string, kk: string) => (lang === "ru" ? ru : kk);
  const label = t(
    team ? "Командный отчёт" : "Индивидуальный отчёт",
    team ? "Командалық есеп" : "Жеке есеп",
  );
  const brand = `<div class="brand"><b>AssessFlow</b><span>${e(snapshot.organization.name)}</span></div>`;
  const page = (title: string, subtitle: string, body: string) =>
    `<section class="report-page">${brand}<div class="kicker">${e(label)}</div><h1>${e(title)}</h1><p class="subtitle">${e(subtitle)}</p>${body}</section>`;
  const section = (title: string, rows: { text: string }[]) =>
    rows.length
      ? `<h2>${e(title)}</h2>${rows.map((r) => `<p>${e(r.text)}</p>`).join("")}`
      : "";
  const table = (headers: string[], rows: string[][]) =>
    `<table><thead><tr>${headers.map((h) => `<th>${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const bar = (name: string, text: string, value: number, max = 5) =>
    `<div class="metric"><div class="metric-head"><span>${e(name)}</span><strong>${e(text)}</strong></div><div class="track"><i style="width:${Math.max(0, Math.min(100, (value / max) * 100)).toFixed(1)}%"></i></div></div>`;
  const formula = (score: NonNullable<ReturnType<typeof testScoreSummary>>) =>
    lang === "ru"
      ? `${n(score.total, lang)} из ${n(score.maximum, lang)} (${Math.round(score.percent)}%) → уровень ${score.level}, ${levelText(score.level, lang)}`
      : `${n(score.maximum, lang)} ішінен ${n(score.total, lang)} (${Math.round(score.percent)}%) → ${score.level}-деңгей, ${levelText(score.level, lang)}`;
  const legend = () =>
    `<div class="keep"><h3>${t("Шкала уровней", "Деңгейлер шкаласы")}</h3>${table(
      [
        t("Уровень", "Деңгей"),
        t("Подпись", "Сипаттама"),
        t("Верных ответов", "Дұрыс жауаптар"),
      ],
      ["< 40%", "40–54%", "55–69%", "70–84%", "≥ 85%"].map((range, i) => [
        String(i + 1),
        e(levelText(i + 1, lang)),
        e(range),
      ]),
    )}<p class="note">${t("Уровень определяется по точной доле верных ответов до округления процента для отображения.", "Деңгей көрсетілетін пайызды дөңгелектеуге дейін дұрыс жауаптардың нақты үлесі бойынша анықталады.")}</p></div>`;
  const sjtRule = `<p class="note">${t("Ситуационный тест: +1 за совпадение с ключом по «наиболее вероятно» и +1 по «наименее вероятно». В 14 кейсах максимум 28 баллов.", "Жағдаяттық тест: «ең ықтимал» таңдауының кілтпен сәйкестігіне +1 және «ең ықтимал емес» таңдауының сәйкестігіне +1. 14 кейсте ең көбі 28 балл.")}</p>`;
  const priorities = (top: { name: string }[], bottom: { name: string }[]) =>
    `<div class="grid-2"><div><h2>${t("3 ведущих фактора", "3 жетекші фактор")}</h2>${top.map((s) => `<p>${e(s.name)}</p>`).join("")}</div><div><h2>${t("3 наименее важных фактора", "Маңыздылығы ең төмен 3 фактор")}</h2>${bottom.map((s) => `<p>${e(s.name)}</p>`).join("")}</div></div>`;
  const plan = content.developmentPlan
    .map(
      (p, i) =>
        `<div class="plan-card"><div class="plan-number">${t("НАПРАВЛЕНИЕ", "БАҒЫТ")} ${i + 1}</div><h3>${e(p.focus)}</h3><p>${e(p.action)}</p><div class="plan-meta"><div><b>${t("Формат", "Формат")}</b><p>${e(p.format)}</p></div><div><b>${t("Срок", "Мерзім")}</b><p>${e(p.timeframe)}</p></div></div><p><b>${t("Критерий результата", "Нәтиже критерийі")}</b></p><p>${e(p.success)}</p></div>`,
    )
    .join("");
  const development = page(
    t("План развития", "Даму жоспары"),
    t("Действия, формат и сроки", "Әрекеттер, формат және мерзімдер"),
    section(t("Зоны развития", "Даму бағыттары"), content.development) +
      section(t("Рекомендации", "Ұсыныстар"), content.recommendations) +
      plan,
  );
  const normInfo = snapshot.norm
    ? `<div class="callout"><p>${t("Фиксированная внутренняя группа сравнения", "Бекітілген ішкі салыстыру тобы")}: ${snapshot.norm.expectedCount}. ${t("Исключено недостоверных профилей", "Сенімсіз бейіндер алынып тасталды")}: ${snapshot.norm.excludedCount}.</p><p>${t("Норма зафиксирована", "Норма бекітілді")}: ${e(new Date(snapshot.norm.createdAt).toLocaleDateString(lang === "ru" ? "ru-RU" : "kk-KZ"))}.</p></div>`
    : "";
  const cover = `<section class="report-page report-cover">${brand}<div class="cover-main"><div class="kicker">${e(snapshot.campaign.name)}</div><h1>${e(label)}</h1><div class="cover-rule"></div>${!team ? `<p class="cover-person">${e(snapshot.people[0]?.name)}</p><p>${e(snapshot.people[0]?.position)}</p>` : ""}<p>${t("Результаты оценки и программа развития", "Бағалау нәтижелері және даму бағдарламасы")}</p></div><div class="cover-meta"><p>${e(snapshot.organization.name)}</p><p>${e(new Date(options.createdAt).toLocaleDateString(lang === "ru" ? "ru-RU" : "kk-KZ"))}</p></div></section>`;

  if (team) {
    const data = teamTestReportData(snapshot, lang),
      small = t(
        "Недостаточно данных для группового вывода",
        "Топтық қорытынды үшін дерек жеткіліксіз",
      );
    const passport = table(
      [t("Показатель", "Көрсеткіш"), t("Количество", "Саны")],
      [
        [t("Приглашены", "Шақырылды"), String(data.passport.invited)],
        [t("Завершили", "Аяқтады"), String(data.passport.completed)],
        [
          t(
            "Исключены: недостоверный профиль",
            "Алып тасталды: сенімсіз бейін",
          ),
          String(data.passport.excluded),
        ],
        [
          t("Включены в статистику", "Статистикаға қосылды"),
          String(data.passport.included),
        ],
      ],
    );
    const methods = data.methods
      .map((m) => {
        const distribution = m.distribution.length
          ? `<div style="display:flex;height:24px;border-radius:4px;overflow:hidden">${m.distribution.map((v) => `<div style="flex:${v.count};background:${["#acb8c0", "#92b1c1", "#b8ccc4", "#66a18b", "#276f66"][v.level - 1]};text-align:center;color:#122d37">${v.count || ""}</div>`).join("")}</div><p class="note">${t("Уровень: число участников", "Деңгей: қатысушылар саны")} · ${m.distribution.map((v) => `${v.level}: ${v.count}`).join(" · ")}</p>`
          : "";
        return page(
          m.name,
          t("Результаты группы", "Топ нәтижелері"),
          (m.overall
            ? `<div class="callout"><b>${t("Медиана группы", "Топ медианасы")}</b><div class="score-calculation">${e(formula(m.overall))}</div></div>${distribution}`
            : `<p>${small}</p>`) +
            table(
              [
                t("Группа", "Топ"),
                t("Участников", "Қатысушылар"),
                t("Медианный результат", "Медианалық нәтиже"),
              ],
              [
                { name: t("Вся группа", "Барлық топ"), summary: m.overall },
                ...m.groups,
              ].map((g) => [
                e(g.name),
                g.summary ? String(g.summary.n) : "—",
                g.summary
                  ? e(formula(g.summary))
                  : t("менее 5 участников", "5 қатысушыдан аз"),
              ]),
            ) +
            (m.comparison
              ? `<p>${t("Медиана ГО", "Бас кеңсе медианасы")}: ${n((m.comparison.hq as any).median, lang)}%. ${t("Медиана филиалов", "Филиалдар медианасы")}: ${n((m.comparison.branches as any).median, lang)}%.</p>`
              : "") +
            (m.testId === "situations" && m.overall?.maximum === 28
              ? sjtRule
              : "") +
            legend(),
        );
      })
      .join("");
    const personality = data.personality
      .map((s) =>
        s.band
          ? bar(
              s.name,
              s.band.text,
              { low: 1, middle: 3, high: 5 }[
                s.band.band as "low" | "middle" | "high"
              ],
            )
          : `<p>${e(s.name)}: ${small}.</p>`,
      )
      .join("");
    const motivation = data.motivation
      .map((m) =>
        m.available ? priorities(m.top, m.bottom) : `<p>${small}.</p>`,
      )
      .join("");
    return {
      label,
      html:
        cover +
        page(
          t("Паспорт оценки", "Бағалау паспорты"),
          snapshot.campaign.name,
          normInfo +
            passport +
            section(
              t("Выводы по группе", "Топ бойынша қорытындылар"),
              content.summary,
            ) +
            section(t("Сильные стороны", "Күшті жақтар"), content.strengths),
        ) +
        methods +
        page(
          t("Личностный профиль группы", "Топтың тұлғалық бейіні"),
          t(
            "Пять основных шкал — медианный уровень группы",
            "Бес негізгі шкала — топтың медианалық деңгейі",
          ),
          personality +
            section(
              t("Особенности самоописания", "Өзіндік сипаттау ерекшеліктері"),
              content.personality,
            ),
        ) +
        page(
          t("Мотивация группы", "Топ мотивациясы"),
          t(
            "Приоритеты по медианным значениям факторов",
            "Факторлардың медианалық мәндері бойынша басымдықтар",
          ),
          motivation + section(t("Мотивация", "Мотивация"), content.motivation),
        ) +
        development,
    };
  }

  const person = snapshot.people[0];
  const testCards = person.results
    .filter((r) =>
      ["verbal", "numerical", "logical", "situations"].includes(r.testId),
    )
    .map((r) => {
      const score = testScoreSummary(r.score);
      if (!score) return "";
      const percentile = r.score.cohortPercentile;
      return `<div class="keep">${bar(reportText(r.name, lang), levelText(score.level, lang), score.level)}<div class="score-calculation">${e(formula(score))}</div>${
        snapshot.norm && percentile?.scope === "frozen" && percentile?.n >= 30
          ? `<p class="note">${t("Процентиль внутри сопоставимой группы", "Салыстырмалы топ ішіндегі процентиль")}: ${n(percentile.value, lang)}${r.score.reportNorm?.sten != null ? `. ${t("Стен", "Стен")}: ${r.score.reportNorm.sten}` : ""}.</p>`
          : ""
      }</div>`;
    })
    .join("");
  const domains = personalityProfile(person, lang).filter(
    (s) => !s.facet && s.interpretable,
  );
  const motivation = motivationProfile(person, lang);
  return {
    label,
    html:
      cover +
      page(
        t("Результаты оценки", "Бағалау нәтижелері"),
        person.position,
        normInfo +
          section(
            t("Интегрированные выводы", "Біріктірілген қорытындылар"),
            content.summary,
          ) +
          section(t("Сильные стороны", "Күшті жақтар"), content.strengths) +
          section(
            t("Анализ информации", "Ақпаратты талдау"),
            content.analytical,
          ) +
          section(
            t("Управленческие решения", "Басқарушылық шешімдер"),
            content.management,
          ),
      ) +
      page(
        t("Результаты тестов", "Тест нәтижелері"),
        t(
          "Способности и управленческие решения",
          "Қабілеттер және басқарушылық шешімдер",
        ),
        testCards +
          (person.results.some(
            (r) =>
              r.testId === "situations" &&
              testScoreSummary(r.score)?.maximum === 28,
          )
            ? sjtRule
            : "") +
          legend(),
      ) +
      page(
        t("Личностный профиль", "Тұлғалық бейін"),
        t(
          "Пять основных шкал самоописания",
          "Өзіндік сипаттаудың бес негізгі шкаласы",
        ),
        domains
          .map((s) =>
            bar(
              reportText(s.name, lang),
              s.text,
              { low: 1, middle: 3, high: 5 }[
                s.band as "low" | "middle" | "high"
              ],
            ),
          )
          .join("") +
          section(
            t("Особенности самоописания", "Өзіндік сипаттау ерекшеліктері"),
            content.personality,
          ),
      ) +
      page(
        t(
          "Мотивация и рабочие приоритеты",
          "Мотивация және жұмыс басымдықтары",
        ),
        t("Предпочтения участника", "Қатысушының қалаулары"),
        priorities(motivation.top, motivation.bottom) +
          section(t("Мотивация", "Мотивация"), content.motivation),
      ) +
      development,
  };
}
