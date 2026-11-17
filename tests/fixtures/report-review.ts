import type { ReportSnapshot } from "../../packages/core/reporting";
import { DEFAULT_COMPETENCIES } from "../../packages/core/competencies";
export function reviewFixture(count = 10): ReportSnapshot {
  return {
    organization: { name: "Проверка отчётов", matrixConfig: {} },
    campaign: { id: "review-fixture", name: "Контрольная группа" },
    people: Array.from({ length: count }, (_, i) => ({
      id: `person-${i}`,
      name: `Контрольный участник ${i}`,
      position: i % 2 ? "Заместитель директора" : "Директор",
      unit: i % 4 < 2 ? "Головной офис" : "Филиал",
      category: "Руководитель",
      status: "completed",
      completed: 6,
      total: 6,
      results: [
        {
          testId: "verbal",
          testVersionId: "form-1",
          version: "2",
          scoringKeyId: "key",
          language: "ru",
          name: { ru: "Вербальный анализ", kk: "Вербалды талдау" },
          score: {
            algorithm: "cognitive",
            total: 15 + (i % 10),
            maximum: 30,
            bandThresholds: [12, 16, 21, 25, 30],
          },
        },
        {
          testId: "personality",
          testVersionId: "personality-2",
          version: "2",
          name: { ru: "Личностный профиль" },
          score: {
            algorithm: "scales",
            scales: {
              N: {
                name: { ru: "Эмоциональная устойчивость" },
                min: 1,
                max: 5,
                mean: 3.125,
              },
              N1: { name: { ru: "Тревожность" }, min: 1, max: 5, mean: 4.75 },
              N3: {
                name: { ru: "Устойчивость настроения" },
                min: 1,
                max: 5,
                mean: 4.5,
              },
              A: { name: { ru: "Сотрудничество" }, min: 1, max: 5, mean: 3.5 },
              A1: { name: { ru: "Доверие" }, min: 1, max: 5, mean: 3.125 },
            },
          },
        },
      ],
      observations: [],
      expert: null,
      competencyProfile: {
        model: {
          id: "model",
          status: "approved",
          content: structuredClone(DEFAULT_COMPETENCIES),
        },
        cards: [],
        consensus: {
          scores: {
            roleId: [
              "director_hq",
              "deputy_hq",
              "director_branch",
              "deputy_branch",
            ][i % 4],
            ratings: DEFAULT_COMPETENCIES.competencies.map((c) => ({
              competencyId: c.id,
              value: (i % 5) + 1,
              reason: "Оценка подтверждена выполнением рабочей задачи.",
              evidenceIds: [],
            })),
          },
        },
      },
    })),
  };
}
