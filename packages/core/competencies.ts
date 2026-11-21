import { z } from "zod";
import { HOLDING_COMPETENCIES, HOLDING_PROFILES, HOLDING_SJT_CASES, HOLDING_MODEL_VERSION, HOLDING_PROVENANCE } from "./holding";
const label = z.object({ ru: z.string().min(2).max(1000), kk: z.string().min(2).max(1000) });
export const competencyModelSchema = z.object({
  holdingModelVersion: z.literal(HOLDING_MODEL_VERSION).optional(),
  sourceLanguage: z.literal("ru").optional(),
  translationStatus: z.object({ kk: z.literal("source_ru_fallback") }).optional(),
  provenance: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  competencies: z.array(z.object({
    id: z.string().regex(/^(?:[a-z][a-z0-9_-]*|C[1-8])$/),
    name: label, block: z.string().optional(),
    indicators: z.array(z.object({ id: z.string().min(1), text: label })).min(3).max(5),
    sources: z.array(z.object({ kind: z.enum(["test","exercise"]), id: z.string().min(1), scales: z.array(z.string()).default([]) })).min(2),
  })).length(8),
  roles: z.array(z.object({
    id: z.string().min(1), name: label,
    profileRow: z.number().int().min(1).max(65).optional(),
    block: z.enum(["ГО","РФ"]).optional(), unit: z.string().optional(), position: z.string().optional(),
    targetLevelModel: z.literal("В").optional(), targetScore: z.null().optional(),
    criticality: z.record(z.string(),z.number().int().min(1).max(3)).optional(),
    targets: z.record(z.string(), z.number().int().min(1).max(5).nullable()),
  })).min(4).max(65),
  scale: z.array(z.object({ value: z.number().int().min(1).max(5), description: label })).length(5),
}).superRefine((m,ctx) => {
  const issue=(message:string)=>ctx.addIssue({code:"custom",message});
  const ids=m.competencies.map(c=>c.id), isHolding=m.holdingModelVersion===HOLDING_MODEL_VERSION;
  if(new Set(ids).size!==8) issue("Компетенции должны иметь уникальные ID");
  if(new Set(m.roles.map(r=>r.id)).size!==m.roles.length || new Set(m.scale.map(s=>s.value)).size!==5) issue("Повторяются роли или баллы шкалы");
  for(const c of m.competencies) if(new Set(c.indicators.map(i=>i.id)).size!==c.indicators.length) issue("ID индикаторов должны быть уникальными");
  for(const r of m.roles) if(ids.some(id=>r.targets[id]===undefined) || Object.keys(r.targets).some(id=>!ids.includes(id))) issue("Укажите целевые уровни всех восьми компетенций");
  if(!isHolding) {
    if(m.roles.length!==4 || ids.some(id=>! /^[a-z][a-z0-9_-]*$/.test(id)) || m.roles.some(r=>Object.values(r.targets).some(v=>v===null))) issue("Некорректная историческая модель");
    return;
  }
  if(m.sourceLanguage!=="ru" || m.translationStatus?.kk!=="source_ru_fallback") issue("Укажите исходный язык RU; перевод KK не предоставлен");
  if(m.roles.length!==65) issue("Модель Холдинга содержит 65 номерных профилей");
  for(const [index,c] of m.competencies.entries()) {
    const original=HOLDING_COMPETENCIES[index];
    if(c.id!==original.id || c.block!==original.block || JSON.stringify(c.name)!==JSON.stringify(original.name) || JSON.stringify(c.indicators)!==JSON.stringify(original.indicators.map(i=>({id:i.id,text:i.text})))) issue("Сохраните дословную модель и 24 индикатора источника");
    const mapped=HOLDING_SJT_CASES.filter(row=>row.competencyCode===c.id).map(row=>row.questionId);
    for(const s of c.sources) if(s.kind==="test" && (s.id!=="situations" || s.scales.length!==mapped.length || mapped.some(id=>!s.scales.includes(id)))) issue("Источник SJT должен содержать только кейсы своей компетенции");
  }
  for(const [index,r] of m.roles.entries()) {
    const p=HOLDING_PROFILES[index];
    if(!p || r.id!==`holding-profile-${p.profileRow}` || r.profileRow!==p.profileRow || r.block!==p.block || r.unit!==p.unit || r.position!==p.position || r.targetLevelModel!=="В" || r.targetScore!==null || (!r.criticality || Object.keys(r.criticality).length!==8 || Object.keys(p.criticality).some(code=>r.criticality![code]!==p.criticality[code])) || r.name.ru!==`№ ${p.profileRow} · ${p.unit} · ${p.position}` || r.name.kk!==r.name.ru || Object.values(r.targets).some(v=>v!==null)) issue("Профиль, критичность и пустой целевой балл должны совпадать с источником");
  }
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
export const LEGACY_COMPETENCIES: CompetencyConfig = {
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
// Source literals are immutable. The mappings below expose observation opportunities,
// not claims of validated exercise coverage or a numeric target approved by the Fund.
export const DEFAULT_COMPETENCIES: CompetencyConfig = {
  holdingModelVersion: HOLDING_MODEL_VERSION, sourceLanguage: "ru",
  translationStatus: { kk: "source_ru_fallback" }, provenance: HOLDING_PROVENANCE,
  competencies: HOLDING_COMPETENCIES.map(c => ({
    id: c.id, name: c.name, block: c.block,
    indicators: c.indicators.map(i => ({ id: i.id, text: i.text })),
    sources: [
      { kind: "test", id: "situations", scales: HOLDING_SJT_CASES.filter(row=>row.competencyCode===c.id).map(row=>row.questionId) },
      ...["group","roleplay","presentation","interview","facts"].map(id=>({ kind: "exercise" as const, id, scales: [] })),
    ],
  })),
  roles: HOLDING_PROFILES.map(p => ({ ...p, id: `holding-profile-${p.profileRow}`,
    name: { ru: `№ ${p.profileRow} · ${p.unit} · ${p.position}`, kk: `№ ${p.profileRow} · ${p.unit} · ${p.position}` },
    targets: Object.fromEntries(HOLDING_COMPETENCIES.map(c=>[c.id,null])),
  })),
  scale: LEGACY_COMPETENCIES.scale,
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
