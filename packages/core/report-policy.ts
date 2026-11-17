import type { ReportLanguage, ReportPerson, ReportSnapshot } from "./reporting";

export const REPORT_POLICY_VERSION = "customer-2026-11-17.1";
export const roundReport = (n: number) =>
  Math.round((n + Number.EPSILON) * 10) / 10;
export const reportText = (v: any, language: ReportLanguage) =>
  typeof v === "string" ? v : v?.[language] || v?.ru || "";
export const PERSONALITY_REPORT_NAMES: Record<
  string,
  { ru: string; kk: string; reverse?: boolean }
> = {
  N1: {
    ru: "Спокойствие в неопределённости",
    kk: "Белгісіздіктегі сабырлылық",
    reverse: true,
  },
  N2: {
    ru: "Сдержанность при препятствиях",
    kk: "Кедергілер кезіндегі ұстамдылық",
    reverse: true,
  },
  N3: { ru: "Ровный настрой", kk: "Бірқалыпты көңіл күй" },
  N4: {
    ru: "Уверенность в новых контактах",
    kk: "Жаңа байланыстардағы сенімділік",
    reverse: true,
  },
  N5: { ru: "Самоконтроль", kk: "Өзін-өзі бақылау", reverse: true },
  N6: {
    ru: "Устойчивость под давлением",
    kk: "Қысым жағдайындағы төзімділік",
    reverse: true,
  },
  A2: { ru: "Прямота в отношениях", kk: "Қарым-қатынастағы туралық" },
  A5: {
    ru: "Сдержанность в самопрезентации",
    kk: "Өзін таныстырудағы ұстамдылық",
  },
  O6: {
    ru: "Готовность пересматривать правила",
    kk: "Ережелерді қайта қарауға дайындық",
  },
  O3: { ru: "Внимание к своим чувствам", kk: "Өз сезімдеріне назар аудару" },
};
export function reportScale(id: string, scale: any, testId: string) {
  if (testId !== "personality") return { ...scale };
  const alias = PERSONALITY_REPORT_NAMES[id];
  const value = alias?.reverse ? 6 - scale.mean : scale.mean;
  // N and N3 have already been inverted by the scoring engine. Never invert twice.
  return {
    ...scale,
    name: alias ? { ru: alias.ru, kk: alias.kk } : scale.name,
    mean: value,
    interpretable: scale.min >= 1 && value >= 1 && value <= 5,
  };
}
export function personalityBand(value: number, language: ReportLanguage) {
  const band = value <= 2 ? "low" : value >= 4 ? "high" : "middle";
  return {
    band,
    text:
      language === "ru"
        ? {
            low: "выражено слабо",
            middle: "в среднем диапазоне",
            high: "выражено сильно",
          }[band]
        : {
            low: "аз байқалады",
            middle: "орташа ауқымда",
            high: "айқын байқалады",
          }[band],
  };
}
export function personalityProfile(
  person: ReportPerson,
  language: ReportLanguage,
) {
  const result = person.results.find(
    (r) => r.testId === "personality" && r.score && !r.score.reviewRequired,
  );
  return Object.entries(result?.score.scales || {}).map(([id, s]) => {
    const scale = reportScale(id, s, "personality");
    return {
      id,
      ...scale,
      ...personalityBand(scale.mean, language),
      facet: id.length > 1,
    };
  });
}
export function invalidProfile(person: ReportPerson) {
  return person.results.some((r) => {
    const score = r.score;
    if (!score) return false;
    if (score.invalidProfile || score.reviewRequired) return true;
    if (score.qualityReview) return false;
    return (
      ["personality", "motivation"].includes(r.testId) &&
      (score.qualityFlags || []).some((f: string) =>
        ["too_fast", "straightlining"].includes(f),
      )
    );
  });
}
export function testLevel(score: any) {
  if (Number.isInteger(score?.level) && score.level >= 1 && score.level <= 5)
    return score.level as number;
  const percent =
    typeof score?.percent === "number"
      ? score.percent
      : typeof score?.total === "number" && score.maximum > 0
        ? (100 * score.total) / score.maximum
        : null;
  if (percent === null) return null;
  if (
    Array.isArray(score.bandThresholds) &&
    score.bandThresholds.length === 5
  ) {
    const i = score.bandThresholds.findIndex((n: number) => score.total <= n);
    return i < 0 ? 5 : i + 1;
  }
  return percent < 40
    ? 1
    : percent < 55
      ? 2
      : percent < 70
        ? 3
        : percent < 85
          ? 4
          : 5;
}
export function levelText(
  level: number | null,
  language: ReportLanguage,
  approvedTarget = false,
) {
  if (!level) return language === "ru" ? "нет оценки" : "баға жоқ";
  // A score band is not an approved job requirement. Use requirement wording only with approval.
  const ru = approvedTarget
    ? [
        "",
        "значительно ниже требуемого",
        "ниже требуемого",
        "соответствует",
        "выше требуемого",
        "значительно выше",
      ]
    : [
        "",
        "начальный уровень",
        "уровень ниже среднего",
        "средний уровень",
        "уровень выше среднего",
        "высокий уровень",
      ];
  const kk = approvedTarget
    ? [
        "",
        "талаптан едәуір төмен",
        "талаптан төмен",
        "талапқа сәйкес",
        "талаптан жоғары",
        "едәуір жоғары",
      ]
    : [
        "",
        "бастапқы деңгей",
        "орташадан төмен деңгей",
        "орташа деңгей",
        "орташадан жоғары деңгей",
        "жоғары деңгей",
      ];
  return (language === "ru" ? ru : kk)[level];
}
export function motivationProfile(
  person: ReportPerson,
  language: ReportLanguage,
) {
  const result = person.results.find(
    (r) => r.testId === "motivation" && r.score && !r.score.reviewRequired,
  );
  const profile = result?.score.motivation?.profile || {};
  const scales = Object.entries(result?.score.scales || {}).map(
    ([id, s]: [string, any]) => ({
      id,
      name: reportText(s.name, language),
      mean: s.mean,
      priority: profile[id]?.priority || 0,
      adjusted: profile[id]?.adjusted ?? s.mean,
    }),
  );
  const sorted = [...scales].sort(
    (a, b) =>
      b.adjusted - a.adjusted ||
      b.priority - a.priority ||
      a.id.localeCompare(b.id),
  );
  return {
    all: scales,
    top: sorted.slice(0, 3),
    bottom: [...sorted]
      .reverse()
      .filter((s) => !sorted.slice(0, 3).includes(s))
      .slice(0, 2),
  };
}
export function riskEvidence(person: ReportPerson, language: ReportLanguage) {
  if (invalidProfile(person))
    return { confirmed: [] as any[], interview: [] as any[] };
  const facets = personalityProfile(person, language).filter(
    (s) => s.facet && s.interpretable && s.band !== "middle",
  );
  const model = person.competencyProfile?.model;
  const ratings = person.competencyProfile?.consensus?.scores?.ratings || [];
  const cards = person.competencyProfile?.cards || [];
  const confirmed: any[] = [],
    interview: any[] = [];
  for (const facet of facets) {
    const links = (model?.content.competencies || []).filter((c: any) =>
      c.sources.some(
        (s: any) =>
          s.kind === "test" &&
          s.id === "personality" &&
          s.scales.includes(facet.id),
      ),
    );
    let matched = false;
    for (const c of links) {
      const rating = ratings.find((r: any) => r.competencyId === c.id);
      if (
        model.status !== "approved" ||
        !rating ||
        rating.value === null ||
        rating.value > 2
      )
        continue;
      const cardSources =
        cards.find((card: any) => card.id === c.id)?.sources || [];
      if (
        !cardSources.some(
          (s: any) =>
            s.kind === "test" &&
            rating.evidenceIds.includes(s.id) &&
            s.score?.scales?.[facet.id],
        )
      )
        continue;
      const sources = cardSources.filter(
        (s: any) =>
          s.kind === "exercise" &&
          rating.evidenceIds.includes(s.id) &&
          s.scores.some((v: any) => v.score >= 1 && v.score <= 2),
      );
      if (!sources.length) continue;
      confirmed.push({
        id: `risk-${c.id}-${facet.id}`,
        competencyId: c.id,
        competency: reportText(c.name, language),
        facet: facet.id,
        name: reportText(facet.name, language),
        band: facet.text,
        reason: rating.reason,
        observations: sources.map((s: any) => ({
          id: s.id,
          notes:
            s.scores
              .filter((v: any) => v.score >= 1 && v.score <= 2)
              .map((v: any) => v.example)
              .filter(Boolean)
              .join("\n") || s.notes,
        })),
      });
      matched = true;
    }
    if (!matched)
      interview.push({
        facet: facet.id,
        name: reportText(facet.name, language),
        band: facet.text,
        value: roundReport(facet.mean),
        question:
          language === "ru"
            ? `Какие рабочие ситуации помогут раскрыть самоописание по шкале «${reportText(facet.name, language)}»? Приведите пример своих действий.`
            : `«${reportText(facet.name, language)}» шкаласы бойынша өзіндік сипаттауды қандай жұмыс жағдайлары ашады? Өз әрекетіңізге мысал келтіріңіз.`,
      });
  }
  return { confirmed, interview };
}
export function roundReportInput<T>(value: T): T {
  if (typeof value === "number")
    return (Number.isFinite(value) ? roundReport(value) : null) as T;
  if (Array.isArray(value)) return value.map((v) => roundReportInput(v)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, roundReportInput(v)]),
    ) as T;
  return value;
}
const STOP_WORDS = [
  "гнев(?:а|у|ом|е|ный|ная|ное|ные)?",
  "тревожност[ьиью]+",
  "депресси[яиюей]+",
  "уязвимост[ьиью]+",
  "неискренност[ьиью]+",
  "импульсивност[ьиью]+",
  "эмоциональн[а-яё]*\\s+реагирован[а-яё]*",
  "конфликтн[а-яё]*",
  "неустойчив[а-яё]*",
  "слаб(?:ый|ая|ое|ые|ого|ому|ым|ых|ую|ой|ыми)",
  "не\\s+способ[а-яё]*",
  "не\\s+подход[а-яё]*",
  "ашушаң[а-яәіңғүұқөһ]*",
  "мазасыздық[а-яәіңғүұқөһ]*",
  "депрессия[а-яәіңғүұқөһ]*",
  "осалдық[а-яәіңғүұқөһ]*",
  "адал\\s+емес",
  "импульсивті[а-яәіңғүұқөһ]*",
  "тұрақсыз[а-яәіңғүұқөһ]*",
  "қақтығысшыл[а-яәіңғүұқөһ]*",
  "әлсіз[а-яәіңғүұқөһ]*",
  "жарамсыз[а-яәіңғүұқөһ]*",
];
export type ReportIssue = { code: string; path: string; message: string };
export function paragraphIssues(
  text: string,
  path = "paragraph",
): ReportIssue[] {
  return (text.match(/(?<![\p{L}\d])[-−]?\d+(?:[.,]\d+)?/gu) || []).length > 2
    ? [
        {
          code: "too_many_numbers",
          path,
          message: "В абзаце допустимо не более двух чисел",
        },
      ]
    : [];
}
export function reportTextIssues(text: string, path = "text"): ReportIssue[] {
  const issues: ReportIssue[] = [];
  for (const pattern of STOP_WORDS) {
    const match = text.match(
      new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, "iu"),
    );
    if (match)
      issues.push({
        code: "stop_word",
        path,
        message: `Формулировка требует правки: «${match[0]}»`,
      });
  }
  const withoutDates = text.replace(/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g, "");
  if (/\d+[.,]\d{2,}/u.test(withoutDates))
    issues.push({
      code: "precision",
      path,
      message: "Допустим один знак после запятой",
    });
  return issues;
}
export function reportContentIssues(
  content: any,
  snapshot: ReportSnapshot,
  kind: "individual" | "team",
): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const visit = (value: any, path: string) => {
    if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}.${i}`));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value))
        if (k !== "evidenceIds") visit(v, `${path}.${k}`);
    } else if (typeof value === "string") {
      issues.push(...reportTextIssues(value, path));
      issues.push(...paragraphIssues(value, path));
      if (kind === "team") {
        if (
          snapshot.people.some(
            (p) =>
              p.name &&
              value.toLocaleLowerCase().includes(p.name.toLocaleLowerCase()),
          )
        )
          issues.push({
            code: "personal_data",
            path,
            message: "В командном тексте обнаружено имя участника",
          });
        if (
          /\b(?:profile|participant)-\d+/iu.test(value) ||
          /участник[ау]?\s*(?:№|номер|#)?\s*\d+/iu.test(value)
        )
          issues.push({
            code: "individual_statement",
            path,
            message: "Командный отчёт не должен описывать отдельных участников",
          });
      }
    }
  };
  visit(content, "content");
  if (
    kind === "individual" &&
    content.risks?.length &&
    !snapshot.people.some((p) => riskEvidence(p, "ru").confirmed.length)
  )
    issues.push({
      code: "unconfirmed_risk",
      path: "content.risks",
      message:
        "Риски требуют подтверждения наблюдением и итоговой оценкой эксперта",
    });
  return issues;
}
export class ReportReviewRequired extends Error {
  constructor(public issues: ReportIssue[]) {
    super("Отчёт направлен эксперту на проверку формулировок");
    this.name = "ReportReviewRequired";
  }
}
