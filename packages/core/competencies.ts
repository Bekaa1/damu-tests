import { z } from "zod";
const label = z.object({
  ru: z.string().min(2).max(300),
  kk: z.string().min(2).max(300),
});
export const competencyModelSchema = z
  .object({
    competencies: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
          name: label,
          indicators: z
            .array(z.object({ id: z.string().min(1), text: label }))
            .min(3)
            .max(5),
          sources: z
            .array(
              z.object({
                kind: z.enum(["test", "exercise"]),
                id: z.string().min(1),
                scales: z.array(z.string()).default([]),
              }),
            )
            .min(2),
        }),
      )
      .length(8),
    roles: z
      .array(
        z.object({
          id: z.string().min(1),
          name: label,
          targets: z.record(z.string(), z.number().int().min(1).max(5)),
        }),
      )
      .length(4),
    scale: z
      .array(
        z.object({ value: z.number().int().min(1).max(5), description: label }),
      )
      .length(5),
  })
  .superRefine((m, ctx) => {
    const ids = m.competencies.map((c) => c.id);
    if (new Set(ids).size !== 8)
      ctx.addIssue({
        code: "custom",
        message: "Компетенции должны иметь уникальные ID",
      });
    for (const c of m.competencies)
      if (new Set(c.indicators.map((i) => i.id)).size !== c.indicators.length)
        ctx.addIssue({
          code: "custom",
          message: "ID индикаторов должны быть уникальными",
        });
    if (
      new Set(m.roles.map((r) => r.id)).size !== 4 ||
      new Set(m.scale.map((s) => s.value)).size !== 5
    )
      ctx.addIssue({
        code: "custom",
        message: "Повторяются роли или баллы шкалы",
      });
    for (const r of m.roles)
      if (
        ids.some((id) => r.targets[id] === undefined) ||
        Object.keys(r.targets).some((id) => !ids.includes(id))
      )
        ctx.addIssue({
          code: "custom",
          message: "Укажите целевые уровни всех восьми компетенций",
        });
  });
export type CompetencyConfig = z.infer<typeof competencyModelSchema>;
const drafts = [
  [
    "analysis",
    "Анализ и принятие решений",
    "Талдау және шешім қабылдау",
    [
      "Отделяет факты от предположений",
      "Сравнивает не менее двух вариантов решения",
      "Обосновывает выбор данными и последствиями",
    ],
    [
      "Фактілерді болжамдардан ажыратады",
      "Шешімнің кемінде екі нұсқасын салыстырады",
      "Таңдауды деректер мен салдарлар арқылы негіздейді",
    ],
    ["verbal", "numerical", "logical", "situations"],
    ["facts", "presentation"],
  ],
  [
    "results",
    "Ориентация на результат",
    "Нәтижеге бағдарлану",
    [
      "Определяет измеримый результат и срок",
      "Выделяет приоритеты при ограниченных ресурсах",
      "Контролирует исполнение и корректирует план",
    ],
    [
      "Өлшенетін нәтиже мен мерзімді белгілейді",
      "Ресурстар шектеулі кезде басымдықтарды анықтайды",
      "Орындалуын бақылайды және жоспарды түзетеді",
    ],
    ["situations", "motivation"],
    ["group", "presentation"],
  ],
  [
    "team",
    "Управление командой",
    "Команданы басқару",
    [
      "Ставит задачу с понятным результатом и сроком",
      "Проверяет понимание задачи сотрудником",
      "Даёт обратную связь на конкретных примерах",
    ],
    [
      "Міндетті түсінікті нәтиже және мерзіммен қояды",
      "Қызметкердің міндетті түсінгенін тексереді",
      "Нақты мысалдармен кері байланыс береді",
    ],
    ["situations", "personality"],
    ["roleplay", "group"],
  ],
  [
    "people",
    "Развитие людей",
    "Адамдарды дамыту",
    [
      "Выясняет потребность сотрудника в развитии",
      "Договаривается о конкретном действии для развития",
      "Определяет способ проверки прогресса",
    ],
    [
      "Қызметкердің даму қажеттілігін анықтайды",
      "Даму үшін нақты әрекетті келіседі",
      "Ілгерілеуді тексеру тәсілін анықтайды",
    ],
    ["situations", "personality"],
    ["roleplay", "interview"],
  ],
  [
    "client",
    "Клиентоориентированность",
    "Клиентке бағдарлану",
    [
      "Уточняет потребность клиента вопросами",
      "Предлагает решение в пределах правил",
      "Объясняет клиенту следующий шаг и срок",
    ],
    [
      "Клиент қажеттілігін сұрақтар арқылы нақтылайды",
      "Ережелер шегінде шешім ұсынады",
      "Келесі қадам мен мерзімді түсіндіреді",
    ],
    ["situations"],
    ["roleplay", "interview"],
  ],
  [
    "cooperation",
    "Взаимодействие ГО и филиалов",
    "Бас кеңсе мен филиалдардың өзара іс-қимылы",
    [
      "Учитывает ограничения обеих сторон",
      "Согласует зоны ответственности",
      "Фиксирует общую договорённость и порядок связи",
    ],
    [
      "Екі тараптың шектеулерін ескереді",
      "Жауапкершілік салаларын келіседі",
      "Ортақ келісім мен байланыс тәртібін бекітеді",
    ],
    ["situations"],
    ["group", "interview"],
  ],
  [
    "risk",
    "Управление рисками и соблюдение правил",
    "Тәуекелдерді басқару және ережелерді сақтау",
    [
      "Называет конкретные риски решения",
      "Проверяет ограничения и обязательные требования",
      "Предлагает меры контроля и эскалации",
    ],
    [
      "Шешімнің нақты тәуекелдерін атайды",
      "Шектеулер мен міндетті талаптарды тексереді",
      "Бақылау және эскалация шараларын ұсынады",
    ],
    ["verbal", "numerical", "situations"],
    ["facts", "presentation"],
  ],
  [
    "strategy",
    "Стратегическое мышление",
    "Стратегиялық ойлау",
    [
      "Связывает решение с долгосрочной целью",
      "Учитывает внешние факторы и зависимости",
      "Предлагает этапы реализации и критерии успеха",
    ],
    [
      "Шешімді ұзақ мерзімді мақсатпен байланыстырады",
      "Сыртқы факторлар мен тәуелділіктерді ескереді",
      "Іске асыру кезеңдері мен табыс критерийлерін ұсынады",
    ],
    ["logical", "numerical", "situations"],
    ["presentation", "interview"],
  ],
] as const;
export const DEFAULT_COMPETENCIES: CompetencyConfig = {
  competencies: drafts.map(([id, ru, kk, indRu, indKk, tests, exercises]) => ({
    id,
    name: { ru, kk },
    indicators: indRu.map((text, i) => ({
      id: `${id}-${i + 1}`,
      text: { ru: text, kk: indKk[i] },
    })),
    sources: [
      ...tests.map((id) => ({ kind: "test" as const, id, scales: [] })),
      ...exercises.map((id) => ({ kind: "exercise" as const, id, scales: [] })),
    ],
  })),
  roles: [
    ["director_hq", "Директор ГО", "Бас кеңсе директоры", 4],
    ["deputy_hq", "Заместитель ГО", "Бас кеңсе директорының орынбасары", 3],
    ["director_branch", "Директор филиала", "Филиал директоры", 4],
    [
      "deputy_branch",
      "Заместитель филиала",
      "Филиал директорының орынбасары",
      3,
    ],
  ].map(([id, ru, kk, target]) => ({
    id: String(id),
    name: { ru: String(ru), kk: String(kk) },
    targets: Object.fromEntries(drafts.map((c) => [c[0], Number(target)])),
  })),
  scale: [
    [
      1,
      "Действие не проявлено при наличии возможности",
      "Мүмкіндік болғанда әрекет байқалмады",
    ],
    [2, "Действует с существенной поддержкой", "Елеулі қолдаумен әрекет етеді"],
    [
      3,
      "Самостоятельно действует в типичной ситуации",
      "Әдеттегі жағдайда дербес әрекет етеді",
    ],
    [
      4,
      "Устойчиво действует в сложной ситуации",
      "Күрделі жағдайда тұрақты әрекет етеді",
    ],
    [
      5,
      "Системно действует и помогает другим",
      "Жүйелі әрекет етеді және басқаларға көмектеседі",
    ],
  ].map(([value, ru, kk]) => ({
    value: Number(value),
    description: { ru: String(ru), kk: String(kk) },
  })),
};
export function exerciseCriteria(model: CompetencyConfig, type: string) {
  return model.competencies
    .filter((c) =>
      c.sources.some((s) => s.kind === "exercise" && s.id === type),
    )
    .flatMap((c) =>
      c.indicators.map((i) => ({
        id: i.id,
        competencyId: c.id,
        name: `${c.name.ru}: ${i.text.ru}`,
        nameKk: `${c.name.kk}: ${i.text.kk}`,
        indicators: [i.text.ru],
        scale: model.scale.map((s) => ({
          value: s.value,
          description: s.description.ru,
        })),
        allowNotObserved: true,
      })),
    );
}
export function latestAssessorObservations<
  T extends { expertId?: string; exerciseId?: string; criteriaSnapshot: any },
>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((o) => {
    const key = JSON.stringify([
      o.expertId,
      o.exerciseId ?? o.criteriaSnapshot.type,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
