import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {
  calculateScore,
  type QuestionInput,
  type ScoringConfig,
} from "../packages/core/scoring";
const L = (ru: string, kk: string) => ({ ru, kk });
const en = JSON.parse(readFileSync("data/sources/ipip/en.json", "utf8"));
const ru = JSON.parse(readFileSync("data/sources/ipip/ru.json", "utf8"));
const kk = JSON.parse(readFileSync("data/ipip-kk.json", "utf8"));
if (en.length !== 120 || kk.length !== 120 || ru.length !== 120)
  throw new Error("IPIP must have 120 items");
const ipipScales: NonNullable<ScoringConfig["scales"]> = {};
const domains: Record<string, [string, string]> = {
  N: ["Нейротизм", "Нейротизм"],
  E: ["Экстраверсия", "Экстраверсия"],
  O: ["Открытость опыту", "Тәжірибеге ашықтық"],
  A: ["Доброжелательность", "Тілектестік"],
  C: ["Добросовестность", "Ұқыптылық"],
};
const facets: Record<string, string[]> = {
  N: [
    "Тревожность",
    "Гнев",
    "Сниженное настроение",
    "Застенчивость",
    "Несдержанность",
    "Уязвимость",
  ],
  E: [
    "Дружелюбие",
    "Общительность",
    "Напористость",
    "Активность",
    "Поиск впечатлений",
    "Жизнерадостность",
  ],
  O: [
    "Воображение",
    "Эстетические интересы",
    "Эмоциональность",
    "Разнообразие",
    "Интеллектуальные интересы",
    "Либерализм",
  ],
  A: [
    "Доверие",
    "Искренность",
    "Альтруизм",
    "Сотрудничество",
    "Скромность",
    "Сочувствие",
  ],
  C: [
    "Самоэффективность",
    "Организованность",
    "Ответственность",
    "Стремление к достижениям",
    "Самодисциплина",
    "Обдуманность",
  ],
};
const facetKk: Record<string, string[]> = {
  N: [
    "Мазасыздық",
    "Ашу",
    "Көңілдің түсуі",
    "Ұяңдық",
    "Ұстамсыздық",
    "Осалдық",
  ],
  E: [
    "Достық пейіл",
    "Көпшілдік",
    "Табандылық",
    "Белсенділік",
    "Әсер іздеу",
    "Өмірге құштарлық",
  ],
  O: [
    "Қиял",
    "Эстетикалық қызығушылық",
    "Эмоциялық сезімталдық",
    "Әртүрлілік",
    "Зияткерлік қызығушылық",
    "Либерализм",
  ],
  A: [
    "Сенім",
    "Шынайылық",
    "Альтруизм",
    "Ынтымақтастық",
    "Қарапайымдылық",
    "Жанашырлық",
  ],
  C: [
    "Өз күшіне сену",
    "Ұйымшылдық",
    "Жауапкершілік",
    "Жетістікке ұмтылу",
    "Өзіндік тәртіп",
    "Ойластырушылық",
  ],
};
for (const [d, n] of Object.entries(domains)) {
  ipipScales[d] = { name: L(...n), min: 1, max: 5 };
  facets[d].forEach(
    (f, i) =>
      (ipipScales[`${d}${i + 1}`] = {
        name: L(f, facetKk[d][i]),
        min: 1,
        max: 5,
      }),
  );
}
const instruction = L(
  "Отвечайте так, как вы обычно поступаете. Правильных и неправильных ответов здесь нет.",
  "Әдетте қалай әрекет ететініңізге сай жауап беріңіз. Мұнда дұрыс не қате жауап жоқ.",
);
const limitation = L(
  "Перевод подготовлен для проверки методологом. Локальные нормы отсутствуют; результаты являются первичными баллами.",
  "Аударма әдіскердің тексеруіне дайындалған. Жергілікті нормалар жоқ; нәтижелер бастапқы балдар болып табылады.",
);
export type CatalogEntry = {
  id: string;
  name: { ru: string; kk: string };
  description: { ru: string; kk: string };
  source: string;
  licenseStatus: string;
  scientificBasis: string;
  direction: string;
  durationMinutes: number;
  instructions: { ru: string; kk: string };
  limitations: { ru: string; kk: string };
  algorithm: string;
  config: ScoringConfig;
  questions: QuestionInput[];
  controlExamples: any[];
};
const base = (
  id: string,
  ruName: string,
  kkName: string,
  direction: string,
  source: string,
  minutes: number,
): Omit<
  CatalogEntry,
  "questions" | "config" | "algorithm" | "controlExamples"
> => ({
  id,
  name: L(ruName, kkName),
  description: L(
    "Оценка отдельных характеристик с последующим экспертным анализом.",
    "Жеке сипаттамаларды бағалау және кейінгі сараптамалық талдау.",
  ),
  direction,
  source,
  durationMinutes: minutes,
  instructions: instruction,
  limitations: limitation,
  licenseStatus: "source_recorded",
  scientificBasis: source,
});
const catalog: CatalogEntry[] = [];
catalog.push({
  ...base(
    "personality",
    "Личностные характеристики",
    "Тұлғалық сипаттамалар",
    "personality",
    "https://github.com/Alheimsins/b5-johnson-120-ipip-neo-pi-r",
    20,
  ),
  algorithm: "scales",
  licenseStatus: "public_domain_items_mit_repository",
  config: {
    min: 1,
    max: 5,
    scales: ipipScales,
    items: Object.fromEntries(
      en.map((q: any) => [
        `ipip-${q.id}`,
        {
          reverse: q.keyed === "minus",
          scales: [q.domain, `${q.domain}${q.facet}`],
        },
      ]),
    ),
  },
  questions: en.map((q: any, i: number) => ({
    id: `ipip-${q.id}`,
    type: "scale",
    text: L(ru.find((r: any) => r.id === q.id).text, kk[i]),
    options: [],
  })),
  controlExamples: [],
});
const motivation = JSON.parse(readFileSync("data/wmps.json", "utf8"));
const wmpsNames = [
  ["Внутренняя мотивация", "Ішкі мотивация"],
  ["Осознанная мотивация", "Саналы мотивация"],
  ["Инструментальная мотивация", "Құралдық мотивация"],
  ["Интроецированная мотивация", "Интроекцияланған мотивация"],
  ["Внешняя мотивация", "Сыртқы мотивация"],
  ["Амотивация", "Амотивация"],
];
catalog.push({
  ...base(
    "motivation",
    "Мотивационный профиль",
    "Мотивациялық бейін",
    "motivation",
    "https://doi.org/10.1177/21582440221091263",
    7,
  ),
  licenseStatus: "CC-BY-4.0",
  algorithm: "scales",
  limitations: L(
    "Chengwei Xu (2022), WMPS, таблицы 1–2. Оригинальный контекст — китайская государственная служба, шкала 1–6. Перенос на другие организации и переводы требуют методологической проверки. Средние по шкалам — описательные показатели без локальных норм.",
    "Chengwei Xu (2022), WMPS, 1–2-кестелер. Бастапқы контекст — Қытайдың мемлекеттік қызметі, шкала 1–6. Басқа ұйымдарға қолдану мен аудармалар әдістемелік тексеруді талап етеді. Шкала орташалары жергілікті нормасыз сипаттамалық көрсеткіштер.",
  ),
  config: {
    min: 1,
    max: 6,
    scales: Object.fromEntries(
      wmpsNames.map((n, i) => [
        `M${i + 1}`,
        { name: L(n[0], n[1]), min: 1, max: 6 },
      ]),
    ),
    items: Object.fromEntries(
      motivation.map((_: unknown, i: number) => [
        `wmps-${i + 1}`,
        {
          scales: [
            `M${i < 4 ? 1 : i < 6 ? 2 : i < 11 ? 3 : i < 14 ? 4 : i < 18 ? 5 : 6}`,
          ],
        },
      ]),
    ),
  },
  questions: motivation.map((n: string[], i: number) => ({
    id: `wmps-${i + 1}`,
    type: "scale",
    text: L(n[0], n[1]),
    options: [],
  })),
  controlExamples: [],
});
const sjt = JSON.parse(readFileSync("data/sjt.json", "utf8"));
const sjtKeys = [
  ["A", "B"],
  ["A", "C"],
  ["C", "D"],
  ["B", "A"],
  ["D", "A"],
  ["B", "A"],
  ["D", "B"],
  ["C", "A"],
];
catalog.push({
  ...base(
    "situations",
    "Управленческие ситуации",
    "Басқарушылық жағдайлар",
    "situations",
    "https://www.123test.com/situational-judgement-test/",
    10,
  ),
  licenseStatus: "permission_confirmed_by_owner",
  algorithm: "sjt",
  instructions: L(
    "В каждой ситуации выберите одно наиболее вероятное действие (MOST) и одно наименее вероятное (LEAST). Один вариант нельзя выбрать дважды.",
    "Әр жағдайда ең ықтимал (MOST) және ең аз ықтимал (LEAST) бір әрекетті таңдаңыз. Бір нұсқаны екі рет таңдауға болмайды.",
  ),
  limitations: L(
    "Предварительный индекс совпадения AssessFlow, 0–16. Ключ из ТЗ 2.0 на основе разбора Jobzilla; не официальный ключ 123test, не процентиль и не валидированная оценка управленческого потенциала.",
    "AssessFlow алдын ала сәйкестік индексі, 0–16. Кілт Jobzilla талдауына негізделген ТТ 2.0-ден алынған; 123test ресми кілті, процентиль немесе басқарушылық әлеуеттің валидтелген бағасы емес.",
  ),
  config: {
    items: Object.fromEntries(
      sjtKeys.map(([m, l], i) => [
        `sjt-${i + 1}`,
        { most: `sjt-${i + 1}-${m}`, least: `sjt-${i + 1}-${l}` },
      ]),
    ),
  },
  questions: sjt.map((q: any, i: number) => ({
    id: `sjt-${i + 1}`,
    type: "sjt",
    text: L(q.ru, q.kk),
    options: q.options.map((o: string[], j: number) => ({
      id: `sjt-${i + 1}-${"ABCD"[j]}`,
      text: L(o[0], o[1]),
    })),
  })),
  controlExamples: [],
});
const bnt = [
  [
    "В городе 1000 жителей. Из 500 участников хора 100 — мужчины. Среди остальных 500 жителей мужчин 300. Какова вероятность, что случайно выбранный мужчина состоит в хоре? Укажите ответ в процентах.",
    "Қалада 1000 тұрғын бар. Хордағы 500 адамның 100-і ер адам. Хорға қатыспайтын 500 тұрғынның 300-і ер адам. Кездейсоқ таңдалған ер адамның хорға қатысу ықтималдығы қандай? Пайызбен көрсетіңіз.",
    25,
  ],
  [
    "Пятигранную игральную кость бросают 50 раз. Сколько раз в среднем выпадет нечётное число (1, 3 или 5)?",
    "Бес қырлы ойын сүйегін 50 рет лақтырады. Орта есеппен неше рет тақ сан (1, 3 немесе 5) түседі?",
    30,
  ],
  [
    "У шестигранной игральной кости вероятность выпадения 6 вдвое выше вероятности каждого из остальных чисел. Сколько раз в среднем выпадет 6 за 70 бросков?",
    "Алты қырлы ойын сүйегінде 6 түсу ықтималдығы қалған сандардың әрқайсысының ықтималдығынан екі есе жоғары. 70 лақтыруда орта есеппен неше рет 6 түседі?",
    20,
  ],
  [
    "В лесу 20% грибов красные, 50% коричневые и 30% белые. Красный гриб ядовит с вероятностью 20%, а некрасный — с вероятностью 5%. Какова вероятность, что ядовитый гриб красный? Укажите ответ в процентах.",
    "Ормандағы саңырауқұлақтардың 20%-ы қызыл, 50%-ы қоңыр және 30%-ы ақ. Қызыл саңырауқұлақтың улы болу ықтималдығы 20%, ал қызыл емес саңырауқұлақтікі 5%. Улы саңырауқұлақтың қызыл болу ықтималдығы қандай? Пайызбен көрсетіңіз.",
    50,
  ],
];
catalog.push({
  ...base(
    "numerical",
    "Числовое мышление",
    "Сандық ойлау",
    "numerical",
    "https://doi.org/10.1017/S1930297500001819",
    8,
  ),
  licenseStatus: "CC-BY",
  algorithm: "cognitive",
  instructions: L(
    "Четыре задачи Berlin Numeracy Test. Введите число без знака %. Используется одна неадаптивная форма с числовым вводом.",
    "Berlin Numeracy Test төрт тапсырмасы. % белгісінсіз сан енгізіңіз. Сандық енгізуі бар бір бейімделмейтін нұсқа қолданылады.",
  ),
  limitations: L(
    "Cokely et al. (2012), BNT: четыре уникальные задачи, неадаптивная форма. Не покрывает полностью анализ деловых таблиц и графиков. Перевод требует проверки; нормы не применяются.",
    "Cokely et al. (2012), BNT: төрт бірегей тапсырма, бейімделмейтін нұсқа. Іскерлік кестелер мен графиктерді талдауды толық қамтымайды. Аударманы тексеру қажет; нормалар қолданылмайды.",
  ),
  config: {
    items: Object.fromEntries(
      bnt.map((q, i) => [`bnt-${i + 1}`, { correct: q[2] }]),
    ),
  },
  questions: bnt.map((q, i) => ({
    id: `bnt-${i + 1}`,
    type: "number",
    text: L(String(q[0]), String(q[1])),
    options: [],
  })),
  controlExamples: [],
});
const vr = [
  [
    "Какое число составляет одну пятую от одной четвёртой от одной девятой числа 900?",
    "900 санының тоғыздан бірінің төрттен бірінің бестен бірі қандай сан?",
    ["2", "3", "4", "5", "6", "7"],
    ["2", "3", "4", "5", "6", "7"],
    3,
    "VR.4",
  ],
  [
    "Зак выше Мэтта, а Ричард ниже Зака. Какое утверждение наиболее точное?",
    "Зак Мэтттен биік, ал Ричард Зактан аласа. Қай тұжырым ең дәл?",
    [
      "Ричард выше Мэтта",
      "Ричард ниже Мэтта",
      "Ричард одного роста с Мэттом",
      "Это невозможно определить",
    ],
    [
      "Ричард Мэтттен биік",
      "Ричард Мэтттен аласа",
      "Ричард пен Мэтттің бойлары бірдей",
      "Мұны анықтау мүмкін емес",
    ],
    3,
    "VR.16",
  ],
  [
    "Джошуа 12 лет, а его сестра втрое старше. Сколько лет будет сестре, когда Джошуа исполнится 23?",
    "Джошуа 12 жаста, ал әпкесі одан үш есе үлкен. Джошуа 23 жасқа толғанда әпкесі неше жаста болады?",
    ["35", "39", "44", "47", "53", "57"],
    ["35", "39", "44", "47", "53", "57"],
    3,
    "VR.17",
  ],
  [
    "Если послезавтра будет за два дня до четверга, какой день сегодня?",
    "Егер бүрсігүні бейсенбіден екі күн бұрын болса, бүгін қай күн?",
    ["Пятница", "Понедельник", "Среда", "Суббота", "Вторник", "Воскресенье"],
    ["Жұма", "Дүйсенбі", "Сәрсенбі", "Сенбі", "Сейсенбі", "Жексенбі"],
    5,
    "VR.19",
  ],
] as const;
catalog.push({
  ...base(
    "verbal",
    "Вербальное мышление",
    "Вербалды ойлау",
    "verbal",
    "https://icar-project.com/attachments/download/61/Intelligence%20Supplement%202014.pdf",
    6,
  ),
  licenseStatus: "public_domain",
  algorithm: "cognitive",
  instructions: L(
    "Прочитайте вопрос и выберите один ответ. Выполняйте задания самостоятельно, без вспомогательных инструментов.",
    "Сұрақты оқып, бір жауапты таңдаңыз. Тапсырмаларды қосымша құралсыз өзіңіз орындаңыз.",
  ),
  limitations: L(
    "Четыре VR-задания из ICAR-16, Condon & Revelle (2014), Appendix A. Подшкала не является полным ICAR-16 и не подтверждает полноценное покрытие анализа деловой информации. Перевод и отдельное использование подшкалы требуют утверждения. Ключ проверен арифметически и логически, ожидает утверждения методологом.",
    "ICAR-16-дан төрт VR тапсырмасы, Condon & Revelle (2014), Appendix A. Бұл толық ICAR-16 емес және іскерлік ақпаратты талдауды толық қамтымайды. Аударма мен ішкі шкаланы бөлек қолдану бекітуді талап етеді. Кілт арифметикалық және логикалық тексерілген, әдіскердің бекітуін күтуде.",
  ),
  questions: vr.map((q) => ({
    id: `icar-${q[5]}`,
    type: "single",
    text: L(q[0], q[1]),
    options: q[2].map((a, i) => ({
      id: `icar-${q[5]}-${i + 1}`,
      text: L(a, q[3][i]),
    })),
  })),
  config: {
    items: Object.fromEntries(
      vr.map((q) => [`icar-${q[5]}`, { correct: `icar-${q[5]}-${q[4] + 1}` }]),
    ),
  },
  controlExamples: [],
});
// OMIB original format is construction, not multiple choice. Store this explicitly as an unvalidated adapted form.
const book = new ExcelJS.Workbook();
await book.xlsx.readFile("data/sources/omib/items.xlsx");
const omibItemCount = book.worksheets[0].actualRowCount - 1;
if (omibItemCount !== 220)
  throw new Error(`Expected all 220 source OMIB items, found ${omibItemCount}`);
const paths = [
  "0,0 25,0 0,25",
  "25,100 0,100 0,75",
  "100,75 100,100 75,100",
  "75,0 100,0 100,25",
  "12.5,50 50,12.5",
  "12.5,50 50,87.5",
  "50,87.5 87.5,50",
  "50,12.5 87.5,50",
  "37.5,0 62.5,0 62.5,12.5 37.5,12.5",
  "0,37.5 0,62.5 12.5,62.5 12.5,37.5",
  "37.5,87.5 62.5,87.5 62.5,100 37.5,100",
  "87.5,37.5 87.5,62.5 100,62.5 100,37.5",
];
function svg(code: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/>${[...code].map((n, i) => (n !== "1" ? "" : i < 12 ? `<polygon points="${paths[i]}" fill="${i >= 4 && i < 8 ? "none" : "black"}" stroke="black"/>` : i < 16 ? (i < 14 ? `<rect x="40" y="40" width="20" height="20" fill="${i % 2 ? "none" : "black"}" stroke="black"/>` : `<circle cx="50" cy="50" r="10" fill="${i % 2 ? "none" : "black"}" stroke="black"/>`) : `<polygon points="${["50,12.5 37.5,25 62.5,25", "12.5,50 25,37.5 25,62.5", "50,87.5 37.5,75 62.5,75", "87.5,50 75,37.5 75,62.5"][i - 16]}" fill="black"/>`)).join("")}</svg>`;
}
mkdirSync("data/assets/omib", { recursive: true });
const omibQuestions: QuestionInput[] = [],
  omibItems: ScoringConfig["items"] = {};
for (let i = 1; i <= omibItemCount; i++) {
  const row = book.worksheets[0].getRow(i + 1);
  const solution = String(row.getCell(14).value);
  if (!/^[01]{20}$/.test(solution))
    throw new Error("Invalid source OMIB solution");
  copyFileSync(
    `data/sources/omib/matrices/Item_${i}.svg`,
    `data/assets/omib/item-${i}.svg`,
  );
  const codes = new Set([solution]);
  for (let j = 0; codes.size < 6; j++) {
    const c = solution.split("");
    c[(i + j * 3) % 20] = c[(i + j * 3) % 20] === "1" ? "0" : "1";
    codes.add(c.join(""));
  }
  const options = [...codes];
  const correctPos = i % 6;
  [options[0], options[correctPos]] = [options[correctPos], options[0]];
  const questionId = `omib-full-${i}`;
  options.forEach((code, j) =>
    writeFileSync(`data/assets/omib/item-${i}-option-${j + 1}.svg`, svg(code)),
  );
  omibQuestions.push({
    id: questionId,
    type: "image",
    text: L(
      "Выберите изображение, которое завершает матрицу.",
      "Матрицаны толықтыратын суретті таңдаңыз.",
    ),
    imageUrl: `/api/assets/omib/item-${i}.svg`,
    options: options.map((_, j) => ({
      id: `${questionId}-${j + 1}`,
      text: L(`Вариант ${j + 1}`, `${j + 1}-нұсқа`),
      imageUrl: `/api/assets/omib/item-${i}-option-${j + 1}.svg`,
    })),
  });
  omibItems[questionId] = { correct: `${questionId}-${correctPos + 1}` };
}
catalog.push({
  ...base(
    "logical",
    "Абстрактно-логическое мышление",
    "Абстрактілі-логикалық ойлау",
    "logical",
    "https://osf.io/4km79/",
    90,
  ),
  licenseStatus: "GPL-3.0-source-review",
  algorithm: "cognitive",
  instructions: L(
    "Найдите закономерность в матрице и выберите недостающий элемент.",
    "Матрицадағы заңдылықты тауып, жетіспейтін элементті таңдаңыз.",
  ),
  limitations: L(
    "OMIB, Koch et al. (2022). Включены все 220 матриц банка. Это техническая адаптация: оригинал использует конструирование ответа, здесь добавлены программно сформированные варианты выбора. Форма не валидирована как единый тест; состав, дистракторы и перевод требуют методологического утверждения. Применяются только первичные баллы, без IRT-норм.",
    "OMIB, Koch et al. (2022). Банктегі барлық 220 матрица енгізілді. Бұл техникалық бейімдеу: түпнұсқада жауап құрастырылады, мұнда таңдау нұсқалары бағдарлама арқылы жасалған. Нұсқа біртұтас тест ретінде валидтелмеген; құрамы, дистракторлары мен аудармасы әдістемелік бекітуді талап етеді. IRT нормаларынсыз бастапқы балдар ғана қолданылады.",
  ),
  questions: omibQuestions,
  config: { items: omibItems },
  controlExamples: [],
});
const practiceExtensions = JSON.parse(
  readFileSync("data/practice-extensions.json", "utf8"),
);
const verbal = catalog.find((test) => test.id === "verbal")!;
const verbalPracticeQuestions = practiceExtensions.verbal.map(
  (question: any, index: number) => {
    const id = `af-verbal-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      type: "single",
      text: L(question.ru, question.kk),
      options: question.options.map((option: string[], optionIndex: number) => ({
        id: `${id}-${optionIndex + 1}`,
        text: L(option[0], option[1]),
      })),
    };
  },
);
verbal.questions.push(...verbalPracticeQuestions);
Object.assign(
  verbal.config.items ??= {},
  Object.fromEntries(
    practiceExtensions.verbal.map((question: any, index: number) => {
      const id = `af-verbal-${String(index + 1).padStart(2, "0")}`;
      return [id, { correct: `${id}-${question.correct + 1}` }];
    }),
  ),
);
verbal.durationMinutes = 15;
verbal.source += "; AssessFlow original practice additions";
verbal.licenseStatus = "public_domain_source_items_with_original_supplement";
verbal.instructions = L(
  "16 заданий: 4 задания ICAR-16 и 12 дополнительных вопросов AssessFlow. Прочитайте каждый вопрос и выберите один ответ.",
  "16 тапсырма: ICAR-16-ның 4 тапсырмасы және AssessFlow жасаған 12 қосымша сұрақ. Әр сұрақты оқып, бір жауапты таңдаңыз.",
);
verbal.limitations = L(
  "Включены 4 исходных VR-задания ICAR-16 и 12 оригинальных вопросов AssessFlow. Дополнения не являются частью ICAR или его закрытого банка из 180 вопросов. Перевод и ключ требуют проверки методологом; результаты — только предварительные баллы без норм.",
  "ICAR-16-ның бастапқы 4 VR тапсырмасы және AssessFlow жасаған 12 қосымша сұрақ енгізілді. Қосымша сұрақтар ICAR құрамына да, оның 180 сұрақтан тұратын жабық банкіне де кірмейді. Аударма мен кілтті әдіскер тексеруі керек; нәтиже — нормасыз бастапқы балдар.",
);

const numerical = catalog.find((test) => test.id === "numerical")!;
const numericalPracticeQuestions = practiceExtensions.numberSeries.map(
  (question: any, index: number) => {
    const id = `af-series-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      type: "number",
      text: L(
        `Какое число продолжает ряд: ${question.sequence}, ?`,
        `Қатарды жалғастыратын келесі санды табыңыз: ${question.sequence}, ?`,
      ),
      options: [],
    };
  },
);
numerical.questions.push(...numericalPracticeQuestions);
Object.assign(
  numerical.config.items ??= {},
  Object.fromEntries(
    practiceExtensions.numberSeries.map((question: any, index: number) => [
      `af-series-${String(index + 1).padStart(2, "0")}`,
      { correct: question.answer },
    ]),
  ),
);
numerical.durationMinutes = 45;
numerical.source += "; https://cran.r-project.org/package=numGen (item-family reference)";
numerical.licenseStatus = "BNT-source-with-original-number-series-supplement";
numerical.instructions = L(
  "52 задания: 4 задачи Berlin Numeracy Test и 48 дополнительных рядов чисел. Введите один числовой ответ. Для первых четырёх задач укажите процент без знака %.",
  "52 тапсырма: Berlin Numeracy Test-тің 4 тапсырмасы және 48 қосымша сан қатары. Бір сандық жауап енгізіңіз. Алғашқы төрт тапсырмада пайызды % белгісінсіз жазыңыз.",
);
numerical.limitations = L(
  "Cokely et al. (2012), BNT включает 4 уникальные задачи. Ещё 48 рядов — оригинальные учебные задания AssessFlow по распространённым моделям числовых последовательностей; это не вопросы ICAR/ANSIG. Смешанная форма не валидирована как единая шкала; нормы BNT к общему баллу не применяются.",
  "Cokely et al. (2012), BNT 4 бірегей тапсырмадан тұрады. Қосылған 48 сан қатары — AssessFlow жасаған сандық тізбек тапсырмалары; олар ICAR/ANSIG сұрақтары емес. Аралас нұсқа бір шкала ретінде валидтелмеген; BNT нормалары жалпы балға қолданылмайды.",
);

const situations = catalog.find((test) => test.id === "situations")!;
const situationPracticeQuestions = practiceExtensions.situations.map(
  (question: any, index: number) => {
    const id = `af-sjt-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      type: "sjt",
      text: L(question.ru, question.kk),
      options: question.options.map((option: string[], optionIndex: number) => ({
        id: `${id}-${"ABCD"[optionIndex]}`,
        text: L(option[0], option[1]),
      })),
    };
  },
);
situations.questions.push(...situationPracticeQuestions);
Object.assign(
  situations.config.items ??= {},
  Object.fromEntries(
    practiceExtensions.situations.map((question: any, index: number) => {
      const id = `af-sjt-${String(index + 1).padStart(2, "0")}`;
      return [id, { most: `${id}-${question.most}`, least: `${id}-${question.least}` }];
    }),
  ),
);
situations.durationMinutes = 20;
situations.source += "; AssessFlow original practice additions";
situations.licenseStatus =
  "permission_confirmed_for_source_items_with_original_supplement";
situations.instructions = L(
  "В каждой из 16 ситуаций выберите одно наиболее вероятное действие (MOST) и одно наименее вероятное (LEAST). Один вариант нельзя выбрать дважды.",
  "16 жағдайдың әрқайсысында ең ықтимал (MOST) және ең аз ықтимал (LEAST) бір әрекетті таңдаңыз. Бір нұсқаны екі рет таңдауға болмайды.",
);
situations.limitations = L(
  "Предварительный индекс совпадения AssessFlow, 0–32. Включены 8 разрешённых вопросов 123test и 8 оригинальных дополнительных ситуаций AssessFlow. Ключ предварительный, не официальный ключ 123test; форма и переводы не валидированы, процентиль не рассчитывается.",
  "AssessFlow алдын ала сәйкестік индексі, 0–32. Рұқсат берілген 123test-тің 8 сұрағы және AssessFlow жасаған 8 қосымша жағдай енгізілген. Кілт алдын ала жасалған, 123test ресми кілті емес; нұсқа мен аудармалар валидтелмеген, процентиль есептелмейді.",
);

for (const test of catalog) {
  const answers = Object.fromEntries(
    test.questions.map((q) => {
      const k = test.config.items[q.id];
      return [
        q.id,
        test.algorithm === "sjt"
          ? { most: k.most, least: k.least }
          : test.algorithm === "scales"
            ? 3
            : k.correct,
      ];
    }),
  );
  const score = calculateScore(
    test.algorithm,
    test.config,
    test.questions,
    answers,
  );
  test.controlExamples = [
    { name: "Полный контрольный набор", answers, expected: score },
  ];
}
writeFileSync("data/catalog.json", JSON.stringify(catalog, null, 2));
console.log(
  `Prepared ${catalog.length} methods, ${catalog.reduce((s, t) => s + t.questions.length, 0)} questions. Translations and adapted forms require methodology approval.`,
);
