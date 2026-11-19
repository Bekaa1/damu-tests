import type {
  GeneratedContent,
  ReportSnapshot,
  ReportLanguage,
} from "./reporting";
import {
  levelText,
  testLevel,
  reportText,
  personalityProfile,
  motivationProfile,
} from "./report-policy";
import { teamTestReportData } from "./team-reporting";
export function dataReport(
  snapshot: ReportSnapshot,
  language: ReportLanguage,
  kind: "individual" | "team" = "individual",
): GeneratedContent {
  const t = (ru: string, kk: string) => (language === "ru" ? ru : kk);
  const statement = (text: string, evidenceIds = ["coverage"]) => ({
    text,
    evidenceIds,
  });
  const result: GeneratedContent = {
    summary: [
      statement(
        t(
          "Отчёт объединяет сохранённые результаты оценки и практическую программу развития.",
          "Есеп сақталған бағалау нәтижелері мен практикалық даму бағдарламасын біріктіреді.",
        ),
      ),
    ],
    analytical: [],
    personality: [],
    motivation: [],
    management: [],
    competencies: [],
    potential: [],
    strengths: [],
    development: [],
    risks: [],
    recommendations: [],
    developmentPlan: [],
    limitations: [],
  };
  if (kind === "team") {
    const data = teamTestReportData(snapshot, language);
    result.summary = [
      statement(
        t(
          `В статистику включены ${data.passport.included} участников. Недостоверных профилей: ${data.passport.excluded}.`,
          `Статистикаға ${data.passport.included} қатысушы қосылды. Сенімсіз бейіндер: ${data.passport.excluded}.`,
        ),
      ),
    ];
    const training = data.methods
      .filter((c) => c.overall)
      .sort((a, b) => a.overall!.percent - b.overall!.percent)
      .slice(0, 4);
    for (const c of training) {
      result.development.push(
        statement(
          `${c.name}: ${t("направление практики по результатам тестирования группы", "топтың тест нәтижелері бойынша тәжірибе бағыты")}.`,
          [c.id],
        ),
      );
      result.developmentPlan.push({
        focus: c.name,
        action: t(
          "Разберите рабочие кейсы по этому направлению, сопоставьте варианты решений и примените выбранный способ к текущей задаче.",
          "Осы бағыттағы жұмыс кейстерін талдап, шешім нұсқаларын салыстырып, таңдалған тәсілді ағымдағы міндетке қолданыңыз.",
        ),
        format: t(
          "Практикум и сопровождение руководителя",
          "Практикум және басшының қолдауы",
        ),
        timeframe: t("6 недель", "6 апта"),
        success: t(
          "Обоснованное решение рабочего кейса с проверкой исходных данных и результата",
          "Бастапқы деректер мен нәтижені тексеріп, жұмыс кейсіне негізделген шешім ұсыну",
        ),
        evidenceIds: [c.id],
      });
    }
  } else {
    const p = snapshot.people[0],
      evidence = ["profile-1"];
    for (const r of p.results)
      if (
        ["verbal", "numerical", "logical"].includes(r.testId) &&
        !r.score?.reviewRequired
      ) {
        result.analytical.push(
          statement(
            `${reportText(r.name, language)}: ${levelText(testLevel(r.score), language)}.`,
            evidence,
          ),
        );
        if ((testLevel(r.score) || 0) >= 4)
          result.strengths.push(
            statement(
              `${reportText(r.name, language)}: ${t("результат относится к верхним диапазонам формы", "нәтиже нысанның жоғарғы ауқымдарына жатады")}.`,
              evidence,
            ),
          );
      }
    for (const s of personalityProfile(p, language).filter(
      (s) => !s.facet && s.interpretable,
    ))
      result.personality.push(
        statement(
          t(
            `В самоописании уровень шкалы «${reportText(s.name, language)}»: ${s.text}.`,
            `Өзіндік сипаттауда «${reportText(s.name, language)}» шкаласының деңгейі: ${s.text}.`,
          ),
          evidence,
        ),
      );
    const motivation = motivationProfile(p, language);
    if (motivation.top.length)
      result.motivation.push(
        statement(
          t(
            `Ведущие мотиваторы: ${motivation.top.map((s) => s.name).join(", ")}.`,
            `Жетекші мотиваторлар: ${motivation.top.map((s) => s.name).join(", ")}.`,
          ),
          evidence,
        ),
      );
    for (const [focus, action] of [
      [
        t("Анализ информации", "Ақпаратты талдау"),
        t(
          "Перед важным решением запишите факты, варианты действий и критерий выбора. Разберите результат с руководителем.",
          "Маңызды шешім алдында фактілерді, әрекет нұсқаларын және таңдау критерийін жазыңыз. Нәтижені басшымен талқылаңыз.",
        ),
      ],
      [
        t("Управление исполнением", "Орындалуды басқару"),
        t(
          "Для текущей задачи согласуйте ожидаемый результат, срок и промежуточную проверку. Фиксируйте договорённости и итог.",
          "Ағымдағы міндет үшін күтілетін нәтижені, мерзімді және аралық тексеруді келісіңіз. Келісімдер мен қорытындыны тіркеңіз.",
        ),
      ],
      [
        t("Обратная связь", "Кері байланыс"),
        t(
          "Проведите беседу по схеме: конкретное действие, результат, согласованный следующий шаг. Это поможет сделать договорённости понятнее.",
          "Нақты әрекет, нәтиже, келісілген келесі қадам үлгісі бойынша әңгіме өткізіңіз. Бұл келісімдерді түсініктірек етуге көмектеседі.",
        ),
      ],
    ])
      result.developmentPlan.push({
        focus,
        action,
        format: t("Практика на рабочем месте", "Жұмыс орнындағы тәжірибе"),
        timeframe: t("4 недели", "4 апта"),
        success: t(
          "Зафиксированные действия и обратная связь руководителя",
          "Тіркелген әрекеттер және басшының кері байланысы",
        ),
        evidenceIds: evidence,
      });
    const ability = p.results
      .filter(
        (r) =>
          ["verbal", "numerical", "logical"].includes(r.testId) &&
          !r.score?.reviewRequired,
      )
      .sort((a, b) => (testLevel(a.score) || 0) - (testLevel(b.score) || 0))[0];
    if (ability) {
      result.developmentPlan[0].focus = reportText(ability.name, language);
      result.developmentPlan[0].action = t(
        ability.testId === "numerical"
          ? "Разберите рабочую таблицу: проверьте единицы измерения, знаменатели долей и вывод из сравнения показателей. Обсудите расчёт с коллегой."
          : ability.testId === "logical"
            ? "Для рабочей задачи предложите несколько объяснений закономерности и проверьте каждое на контрпримере. Запишите критерий выбора решения."
            : "Для рабочего документа разделите факты, выводы и предположения. Обоснуйте каждое решение ссылкой на конкретное условие документа.",
        ability.testId === "numerical"
          ? "Жұмыс кестесін талдаңыз: өлшем бірліктерін, үлестердің бөлімдерін және көрсеткіштерді салыстыру қорытындысын тексеріңіз. Есепті әріптеспен талқылаңыз."
          : ability.testId === "logical"
            ? "Жұмыс міндетіндегі заңдылыққа бірнеше түсініктеме ұсынып, әрқайсысын қарсы мысалмен тексеріңіз. Шешім таңдау критерийін жазыңыз."
            : "Жұмыс құжатындағы фактілерді, қорытындыларды және болжамдарды бөліңіз. Әр шешімді құжаттың нақты шартына сілтемемен негіздеңіз.",
      );
    }
    if (motivation.top[0]) {
      result.developmentPlan[2].focus = motivation.top[0].name;
      result.developmentPlan[2].action = t(
        `Согласуйте с руководителем задачу, в которой есть место мотиватору «${motivation.top[0].name}». После выполнения обсудите, что поддерживало вовлечённость и какой формат стоит повторить.`,
        `Басшымен «${motivation.top[0].name}» мотиваторына орын беретін міндетті келісіңіз. Орындаған соң қатысуды не қолдағанын және қандай форматты қайталау керектігін талқылаңыз.`,
      );
    }
  }
  result.recommendations = result.developmentPlan.length
    ? result.developmentPlan.map((p) =>
        statement(`${p.focus}. ${p.action}`, p.evidenceIds),
      )
    : [
        statement(
          t(
            "Используйте итоговые экспертные оценки для выбора программы развития группы.",
            "Топтың даму бағдарламасын таңдау үшін сарапшының қорытынды бағаларын пайдаланыңыз.",
          ),
        ),
      ];
  return result;
}
