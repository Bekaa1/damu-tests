import { reviewFixture } from "./report-review";
export const factorNames = [
  { ru: "Достижение результата", kk: "Нәтижеге жету" },
  { ru: "Развитие и обучение", kk: "Даму және оқу" },
  { ru: "Сложные задачи", kk: "Күрделі міндеттер" },
  { ru: "Доход", kk: "Табыс" },
  { ru: "Признание", kk: "Мойындалу" },
  { ru: "Карьерный рост и статус", kk: "Мансаптық өсу және мәртебе" },
  { ru: "Влияние", kk: "Ықпал" },
  { ru: "Автономия", kk: "Дербестік" },
  { ru: "Смысл", kk: "Мән" },
  { ru: "Стабильность", kk: "Тұрақтылық" },
  { ru: "Команда и отношения", kk: "Команда және қарым-қатынас" },
  { ru: "Баланс", kk: "Теңгерім" },
];

/** Synthetic, complete profiles for checking customer PDF calculations and disclosure. */
export function reportSummaryFixture(count = 1) {
  const snapshot = reviewFixture(count);
  for (const person of snapshot.people) {
    const personality = person.results[1].score.scales;
    Object.assign(personality, {
      E: {
        name: { ru: "Экстраверсия", kk: "Экстраверсия" },
        min: 1,
        max: 5,
        mean: 4.2,
      },
      O: {
        name: { ru: "Открытость опыту", kk: "Тәжірибеге ашықтық" },
        min: 1,
        max: 5,
        mean: 1.8,
      },
      C: {
        name: { ru: "Добросовестность", kk: "Ұқыптылық" },
        min: 1,
        max: 5,
        mean: 3.4,
      },
    });
    person.results.push(
      {
        testId: "logical",
        testVersionId: "logical-current",
        version: "2",
        name: { ru: "Абстрактное мышление", kk: "Абстрактілі ойлау" },
        score: {
          algorithm: "cognitive",
          total: 20,
          maximum: 24,
          level: 5,
          bandThresholds: [7, 11, 15, 19, 24],
        },
      },
      {
        testId: "numerical",
        testVersionId: "numerical-current",
        version: "2",
        name: { ru: "Числовой анализ", kk: "Сандық талдау" },
        score: { algorithm: "cognitive", total: 12, maximum: 18, level: 3 },
      },
      {
        testId: "situations",
        testVersionId: "sjt-current",
        version: "2",
        name: { ru: "Управленческие ситуации", kk: "Басқарушылық жағдайлар" },
        score: { algorithm: "sjt", total: 22, maximum: 28, level: 4 },
      },
      {
        testId: "motivation",
        testVersionId: "motivation-current",
        version: "2",
        name: { ru: "Мотивация", kk: "Мотивация" },
        score: {
          algorithm: "scales",
          scales: Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [
              `M${i + 1}`,
              {
                name: factorNames[i],
                mean: 1 + i * 0.3,
                min: 1,
                max: 5,
              },
            ]),
          ),
        },
      },
    );
  }
  return snapshot;
}
