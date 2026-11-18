import type {
  GeneratedContent,
  ReportSnapshot,
  ReportLanguage,
  ReportPerson,
} from "../../../packages/core/reporting";
import {
  reportText,
  personalityProfile,
  motivationProfile,
  riskEvidence,
  levelText,
  testLevel,
  roundReport,
} from "../../../packages/core/report-policy";
import {
  teamReportData,
  JOB_GROUPS,
} from "../../../packages/core/team-reporting";
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
    team = kind === "team",
    t = (ru: string, kk: string) => (lang === "ru" ? ru : kk);
  const normInfo = snapshot.norm
    ? `<div class="callout"><p>${t("Фиксированная внутренняя группа сравнения", "Бекітілген ішкі салыстыру тобы")}: ${snapshot.norm.expectedCount}. ${t("Исключено недостоверных профилей", "Сенімсіз бейіндер алынып тасталды")}: ${snapshot.norm.excludedCount}.</p><p>${t("Норма зафиксирована", "Норма бекітілді")}: ${e(new Date(snapshot.norm.createdAt).toLocaleDateString(lang === "ru" ? "ru-RU" : "kk-KZ"))}.</p></div>`
    : "";
  const label = team
    ? t("Командный отчёт", "Командалық есеп")
    : t("Индивидуальный отчёт", "Жеке есеп");
  const brand = `<div class="brand"><b>AssessFlow</b><span>${e(snapshot.organization.name)}</span></div>`;
  const page = (
    title: string,
    subtitle: string,
    body: string,
    appendix = false,
  ) =>
    `<section class="report-page${appendix ? " appendix" : ""}">${brand}<div class="kicker">${e(label)}</div><h1>${e(title)}</h1><p class="subtitle">${e(subtitle)}</p>${body}</section>`;
  const paragraphs = (rows: { text: string }[]) =>
    rows.map((r) => `<p>${e(r.text)}</p>`).join("");
  const section = (title: string, rows: { text: string }[]) =>
    rows.length ? `<h2>${e(title)}</h2>${paragraphs(rows)}` : "";
  const bar = (name: string, text: string, value: number, min = 1, max = 5) =>
    `<div class="metric"><div class="metric-head"><span>${e(name)}</span><strong>${e(text)}</strong></div><div class="track"><i style="width:${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)).toFixed(1)}%"></i></div></div>`;
  const table = (headers: string[], rows: string[][]) =>
    `<table><thead><tr>${headers.map((h) => `<th>${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const noData = `<p class="no-data">${t("Нет сохранённых итоговых оценок.", "Сақталған қорытынды бағалар жоқ.")}</p>`;
  const plan = content.developmentPlan
    .map(
      (p, i) =>
        `<div class="plan-card"><div class="plan-number">${t("НАПРАВЛЕНИЕ", "БАҒЫТ")} ${i + 1}</div><h3>${e(p.focus)}</h3><p>${e(p.action)}</p><div class="plan-meta"><div><b>${t("Формат", "Формат")}</b><p>${e(p.format)}</p></div><div><b>${t("Срок", "Мерзім")}</b><p>${e(p.timeframe)}</p></div></div><p><b>${t("Критерий результата", "Нәтиже критерийі")}</b></p><p>${e(p.success)}</p></div>`,
    )
    .join("");
  const cover = `<section class="report-page report-cover">${brand}<div class="cover-main"><div class="kicker">${e(snapshot.campaign.name)}</div><h1>${e(label)}</h1><div class="cover-rule"></div>${!team ? `<p class="cover-person">${e(snapshot.people[0]?.name)}</p><p>${e(snapshot.people[0]?.position)}</p>` : ""}<p>${t("Результаты оценки и программа развития", "Бағалау нәтижелері және даму бағдарламасы")}</p></div><div class="cover-meta"><p>${e(snapshot.organization.name)}</p><p>${e(new Date(options.createdAt).toLocaleDateString(lang === "ru" ? "ru-RU" : "kk-KZ"))}</p></div></section>`;
  if (team) {
    const data = teamReportData(snapshot, lang),
      small = t("менее 5 участников", "5 қатысушыдан аз");
    const stats = (s: any) =>
      !s || s.suppressed
        ? small
        : `${s.n} · ${n(s.median, lang)} · ${n(s.min, lang)}–${n(s.max, lang)}`;
    const distribution = (d: { level: number; count: number }[]) =>
      d.length
        ? `<div style="display:flex;height:22px;border-radius:4px;overflow:hidden">${d.map((v) => `<div style="flex:${v.count};background:${["#acb8c0", "#92b1c1", "#b8ccc4", "#66a18b", "#276f66"][v.level - 1]};text-align:center;color:#122d37">${v.count ? v.count : ""}</div>`).join("")}</div><p class="note">${d.map((v) => `${v.level}: ${v.count}`).join(" · ")}</p>`
        : `<p>${small}</p>`;
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
        [
          t("Утверждённые заключения", "Бекітілген қорытындылар"),
          String(data.passport.approved),
        ],
      ],
    );
    const heatmap = table(
      [t("Компетенция", "Құзырет"), ...JOB_GROUPS.map((g) => g[lang])],
      data.competencies.map((c) => [
        e(c.name),
        ...c.groups.map((g) =>
          g.suppressed
            ? small
            : g.below === null
              ? "—"
              : `<span style="display:block;padding:8px;background:${g.color === "green" ? "#dceee5" : g.color === "yellow" ? "#fff1ca" : "#f4d8d4"}">${n(g.below, lang)}%</span>`,
        ),
      ]),
    );
    const methods = data.methods
      .map(
        (m) =>
          `<div class="chart-card"><h3>${e(m.name)}</h3>${m.percentage ? distribution(m.distribution) : ""}${table([t("Группа", "Топ"), "n · " + t("Медиана · Мин–макс", "Медиана · Мин–макс")], [[t("Вся группа", "Барлық топ"), stats(m.overall)], ...JOB_GROUPS.map((g, i) => [e(g[lang]), stats(m.groups[i])])])}</div>`,
      )
      .join("");
    const competencies = data.competencies
      .map(
        (c) =>
          `<div class="chart-card"><h3>${e(c.name)}</h3>${distribution(c.distribution)}${table(
            [
              t("Группа", "Топ"),
              "n · " + t("Медиана · Мин–макс", "Медиана · Мин–макс"),
            ],
            JOB_GROUPS.map((g, i) => [e(g[lang]), stats(c.groups[i])]),
          )}</div>`,
      )
      .join("");
    const comparisons = data.methods
      .filter((m) => m.comparison)
      .map(
        (m) =>
          `<p><b>${e(m.name)}</b></p><p>${t("Медиана ГО", "Бас кеңсе медианасы")}: ${n((m.comparison!.hq as any).median, lang)}. ${t("Медиана филиалов", "Филиалдар медианасы")}: ${n((m.comparison!.branches as any).median, lang)}.</p>`,
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
            ),
        ) +
        page(
          t("Профиль компетенций", "Құзыреттер бейіні"),
          t(
            "Доля участников ниже утверждённого требуемого уровня",
            "Бекітілген талап деңгейінен төмен қатысушылар үлесі",
          ),
          (data.competencies.length ? heatmap : noData) +
            `<p class="note">${t("Зелёный: менее 20%; жёлтый: 20–40%; красный: более 40%. Прочерк — требуемый уровень не утверждён или недостаточно данных.", "Жасыл: 20%-дан аз; сары: 20–40%; қызыл: 40%-дан көп. Сызықша — талап деңгейі бекітілмеген немесе дерек жеткіліксіз.")}</p>` +
            competencies,
        ) +
        page(
          t("Распределения результатов", "Нәтижелер үлестірімі"),
          t(
            "Сопоставимые формы и ключи оценивания",
            "Салыстырмалы нысандар мен бағалау кілттері",
          ),
          methods + comparisons,
        ) +
        page(
          t("Развитие команды", "Команданы дамыту"),
          t("Практическая программа", "Практикалық бағдарлама"),
          section(t("Сильные стороны", "Күшті жақтар"), content.strengths) +
            section(t("Зоны развития", "Даму бағыттары"), content.development) +
            section(t("Рекомендации", "Ұсыныстар"), content.recommendations) +
            plan,
        ),
    };
  }
  const person: ReportPerson = snapshot.people[0],
    profile = person?.competencyProfile;
  const ratings = profile?.consensus?.scores?.ratings || [],
    model = profile?.model;
  const role = model?.content.roles.find(
    (r: any) => r.id === profile?.consensus?.scores?.roleId,
  );
  const competencyRows = (model?.content.competencies || []).map((c: any) => {
    const rating = ratings.find((r: any) => r.competencyId === c.id),
      target = model.status === "approved" ? role?.targets[c.id] : null;
    const chart = `<div class="track" style="margin-top:9px;width:100%;min-width:320px"><i style="width:${typeof rating?.value === "number" ? (rating.value / 5) * 100 : 0}%"></i>${target ? `<b style="position:absolute;left:${(target / 5) * 100}%;top:-3px;height:16px;border-left:2px dashed #a87938"></b>` : ""}</div>`;
    return [
      e(reportText(c.name, lang)) + chart,
      typeof rating?.value === "number" ? String(rating.value) : "—",
      target ? String(target) : "—",
    ];
  });
  const details = ratings
    .filter((r: any) => typeof r.value === "number")
    .map((r: any) => {
      const card = profile.cards.find((c: any) => c.id === r.competencyId),
        sources = (card?.sources || []).filter((s: any) =>
          r.evidenceIds.includes(s.id),
        );
      const observations = sources
        .filter((s: any) => s.kind === "exercise")
        .flatMap((s: any) =>
          s.scores
            .filter((v: any) => v.example)
            .map((v: any) => `<p class="quote">${e(v.example)}</p>`),
        )
        .join("");
      const methods = new Set(sources.map((s: any) => s.method)).size;
      const name =
        card?.name ||
        model.content.competencies.find((c: any) => c.id === r.competencyId)
          ?.name;
      return `<h2>${e(reportText(name, lang))}</h2><p>${e(r.reason)}</p>${observations}<p class="note">${t("Независимых источников", "Тәуелсіз дереккөздер")}: ${methods}${methods < 2 ? " · " + t("недостаточно для интегрированного вывода", "біріктірілген қорытынды үшін жеткіліксіз") : ""}</p>`;
    })
    .join("");
  const abilities = person.results
    .filter(
      (r) =>
        ["verbal", "numerical", "logical"].includes(r.testId) &&
        !r.score?.reviewRequired,
    )
    .map((r) => {
      const level = testLevel(r.score),
        percentile = r.score.cohortPercentile;
      return (
        bar(reportText(r.name, lang), levelText(level, lang), level || 1) +
        (snapshot.norm && percentile?.scope === "frozen" && percentile?.n >= 30
          ? `<p>${t("Процентиль внутри сопоставимой группы", "Салыстырмалы топ ішіндегі процентиль")}: ${n(percentile.value, lang)}${r.score.reportNorm?.sten != null ? `. ${t("Стен", "Стен")}: ${r.score.reportNorm.sten}` : ""}.</p><p class="note">${t("Сопоставимая выборка", "Салыстырмалы іріктеме")}: ${percentile.n}.</p>`
          : "")
      );
    })
    .join("");
  const personality = personalityProfile(person, lang),
    domains = personality.filter((s) => !s.facet && s.interpretable),
    extremes = personality.filter(
      (s) => s.facet && s.interpretable && s.band !== "middle",
    );
  const motivation = motivationProfile(person, lang),
    sjt = person.results.filter((r) => r.score?.algorithm === "sjt");
  const confirmed = riskEvidence(person, lang).confirmed;
  const raw = person.results
    .filter((r) => r.score && !r.score.reviewRequired)
    .flatMap((r) =>
      r.score.scales
        ? Object.entries(r.score.scales).map(([id, s]: [string, any]) => {
            const neutral =
              r.testId === "personality"
                ? personality.find((p) => p.id === id)
                : s;
            return [
              e(reportText(r.name, lang)),
              e(reportText(neutral?.name, lang)),
              r.testId === "personality" && !neutral?.interpretable
                ? "—"
                : n(neutral?.mean ?? s.mean, lang),
              `${s.min}–${s.max}`,
              ...(snapshot.norm
                ? [s.reportNorm?.sten == null ? "—" : String(s.reportNorm.sten)]
                : []),
            ];
          })
        : [
            [
              e(reportText(r.name, lang)),
              t("Итог", "Қорытынды"),
              r.score.algorithm === "sjt"
                ? `${n((r.score.total / r.score.maximum) * 100, lang)}%`
                : n(r.score.total, lang),
              r.score.algorithm === "sjt" ? "%" : `0–${r.score.maximum}`,
              ...(snapshot.norm
                ? [
                    r.score.reportNorm?.sten == null
                      ? "—"
                      : String(r.score.reportNorm.sten),
                  ]
                : []),
            ],
          ],
    );
  return {
    label,
    html:
      cover +
      page(
        t("Профиль компетенций", "Құзыреттер бейіні"),
        person.position,
        normInfo +
          (competencyRows.length
            ? table(
                [
                  t("Компетенция", "Құзырет"),
                  t("Оценка", "Баға"),
                  t("Требуемый уровень", "Талап деңгейі"),
                ],
                competencyRows,
              )
            : noData) +
          section(
            t("Интегрированные выводы", "Біріктірілген қорытындылар"),
            content.summary,
          ) +
          section(t("Сильные стороны", "Күшті жақтар"), content.strengths),
      ) +
      (details || content.competencies.length
        ? page(
            t("Основания оценки", "Бағалау негіздері"),
            t(
              "Наблюдаемое поведение и итоговые оценки",
              "Бақыланған мінез-құлық және қорытынды бағалар",
            ),
            details +
              section(
                t("Выводы по компетенциям", "Құзыреттер бойынша қорытындылар"),
                content.competencies,
              ),
          )
        : "") +
      page(
        t(
          "Способности и управленческие решения",
          "Қабілеттер және басқарушылық шешімдер",
        ),
        t("Результаты тестирования", "Тестілеу нәтижелері"),
        abilities +
          section(
            t("Анализ информации", "Ақпаратты талдау"),
            content.analytical,
          ) +
          sjt
            .map((r) =>
              bar(
                reportText(r.name, lang),
                levelText(testLevel(r.score), lang),
                testLevel(r.score) || 1,
              ),
            )
            .join("") +
          (sjt.length
            ? `<p class="note">${t("Тест не измеряет поведение в реальной работе", "Тест нақты жұмыстағы мінез-құлықты өлшемейді")}</p>`
            : "") +
          section(
            t("Управленческие решения", "Басқарушылық шешімдер"),
            content.management,
          ),
      ) +
      page(
        t("Личностный профиль", "Тұлғалық бейін"),
        t("Самоописание участника", "Қатысушының өзіндік сипаттауы"),
        domains
          .map((s) =>
            bar(
              reportText(s.name, lang),
              s.text,
              s.reportNorm ? (s.reportNorm.sten ?? 1) : s.mean,
              1,
              s.reportNorm ? 10 : 5,
            ),
          )
          .join("") +
          section(
            t("Особенности самоописания", "Өзіндік сипаттау ерекшеліктері"),
            content.personality,
          ) +
          (extremes.length
            ? extremes
                .map(
                  (s) => `<p>${e(reportText(s.name, lang))}: ${e(s.text)}.</p>`,
                )
                .join("")
            : `<p>${domains.length === 5 && domains.every((s) => !s.reportNorm || s.reportNorm.sten !== null) ? t("Личностный профиль сбалансирован, выраженных перекосов нет", "Тұлғалық бейін теңгерімді, айқын ауытқулар жоқ") : domains.some((s) => s.reportNorm?.sten === null) ? t("Для описания по группе нет сопоставимой нормы.", "Топ бойынша сипаттау үшін салыстырмалы норма жоқ.") : t("Полный личностный профиль ещё не доступен для интерпретации.", "Толық тұлғалық бейін түсіндіруге әлі қолжетімсіз.")}</p>`),
      ) +
      page(
        t(
          "Мотивация и рабочие приоритеты",
          "Мотивация және жұмыс басымдықтары",
        ),
        t("Предпочтения участника", "Қатысушының қалаулары"),
        `<h2>${t("Ведущие мотиваторы", "Жетекші мотиваторлар")}</h2>${motivation.top.map((s) => `<p>${e(s.name)}</p>`).join("")}<h2>${t("Наименее приоритетные мотиваторы", "Басымдығы ең төмен мотиваторлар")}</h2>${motivation.bottom.map((s) => `<p>${e(s.name)}</p>`).join("")}` +
          section(t("Мотивация", "Мотивация"), content.motivation),
      ) +
      page(
        t("План развития", "Даму жоспары"),
        t("Действия, формат и сроки", "Әрекеттер, формат және мерзімдер"),
        (confirmed.length
          ? `<h2>${t("Риски, подтверждённые наблюдением", "Бақылаумен расталған тәуекелдер")}</h2>${confirmed.map((r) => `<p>${e(r.competency)}. ${e(r.reason)}</p>${r.observations.map((o: any) => `<p class="quote">${e(o.notes)}</p>`).join("")}`).join("")}`
          : "") +
          section(t("Зоны развития", "Даму бағыттары"), content.development) +
          section(t("Рекомендации", "Ұсыныстар"), content.recommendations) +
          plan,
      ) +
      page(
        t("Приложение: числовые результаты", "Қосымша: сандық нәтижелер"),
        t("Фактические значения шкал", "Шкалалардың нақты мәндері"),
        table(
          [
            t("Методика", "Әдістеме"),
            t("Шкала", "Шкала"),
            t("Значение", "Мән"),
            t("Диапазон", "Ауқым"),
            ...(snapshot.norm ? [t("Стен", "Стен")] : []),
          ],
          raw,
        ),
        true,
      ),
  };
}
