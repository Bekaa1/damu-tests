import React from "react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_COMPETENCIES, competencyModelSchema, exerciseCriteria } from "../packages/core/competencies";

// Frozen independently from the named source workbooks BEFORE implementation.
const sourceIndicators = [["C1", "Коммуникация и лидерство", "Мотивация подчиненных", "C1.1", "Создает у сотрудников положительное отношение к работе."], ["C1", "Коммуникация и лидерство", "Мотивация подчиненных", "C1.2", "Признает достижения подчиненных и публично хвалит их."], ["C1", "Коммуникация и лидерство", "Мотивация подчиненных", "C1.3", "Регулярно предоставляет конструктивную обратную связь."], ["C2", "Аналитическое мышление и принятие решений", "Выбор и принятие решений", "C2.1", "Понимает вклад своего подразделения в работу Холдинга."], ["C2", "Аналитическое мышление и принятие решений", "Выбор и принятие решений", "C2.2", "При анализе информации учитывает все ключевые факторы и выделяет приоритеты."], ["C2", "Аналитическое мышление и принятие решений", "Выбор и принятие решений", "C2.3", "При принятии решений прогнозирует их последствия и риски."], ["C3", "Влияние на рабочие процессы", "Межфункциональное взаимодействие", "C3.1", "Координирует деятельность своего подразделения с другими подразделениями для достижения общехолдинговских целей."], ["C3", "Влияние на рабочие процессы", "Межфункциональное взаимодействие", "C3.2", "Выдвигает инициативы, которые существенно улучшают сложившийся подход к работе в смежном взаимодействии."], ["C3", "Влияние на рабочие процессы", "Межфункциональное взаимодействие", "C3.3", "Организует работу своих подчиненных для взаимовыгодного и эффективного взаимодействия со смежными подразделениями."], ["C4", "Организация работы", "Организация работы подразделения", "C4.1", "Четко планирует выполнение поставленных задач: разбивает задачу на этапы, определяет ресурсы, необходимые для выполнения каждого этапа, устанавливает реалистичные сроки выполнения."], ["C4", "Организация работы", "Организация работы подразделения", "C4.2", "Координирует работу подчиненных, отслеживает отклонения от ожидаемых результатов и оперативно вносит коррективы."], ["C4", "Организация работы", "Организация работы подразделения", "C4.3", "При постановке целей и задач объясняет подчиненным цели и приоритеты Холдинга и подразделения."], ["C5", "Способность к изменениям", "Внедрение изменений", "C5.1", "Информирует подчиненных о необходимости изменений."], ["C5", "Способность к изменениям", "Внедрение изменений", "C5.2", "Способствует принятию группой необходимых изменений."], ["C5", "Способность к изменениям", "Внедрение изменений", "C5.3", "Активно вовлекает подчиненных в совершенствование рабочих процессов."], ["C6", "Командность", "Командный дух", "C6.1", "Разделяет общекорпоративные цели и ценности, воспринимает их как более приоритетные по сравнению с целями конкретного подразделения и своими рабочими задачами."], ["C6", "Командность", "Командный дух", "C6.2", "Помогает подчиненным и коллегам в решении задач, делится имеющимися знаниями и опытом."], ["C6", "Командность", "Командный дух", "C6.3", "Активно взаимодействует с коллегами, добиваясь согласованности действий на стыках своего и соседних участков работы."], ["C7", "Ответственность", "Ответственность за результат", "C7.1", "Осознает влияние своих действий и решений на результат работы подразделения."], ["C7", "Ответственность", "Ответственность за результат", "C7.2", "Разделяет ответственность за неудачи и успехи, как команды, так и личные."], ["C7", "Ответственность", "Ответственность за результат", "C7.3", "Для достижения необходимого результата берет на себя дополнительные функции."], ["C8", "Развитие", "Развитие", "C8.1", "Непрерывно расширяет кругозор, совершенствует свои знания и способности для достижения лучших результатов в работе."], ["C8", "Развитие", "Развитие", "C8.2", "Конструктивно воспринимает обратную связь от коллег и подчиненных, учитывает ее в своей работе."], ["C8", "Развитие", "Развитие", "C8.3", "Привлекает, развивает и удерживает ценных сотрудников."]];
const sourceProfiles = [[1, "ГО", "Административный департамент", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [2, "ГО", "Департамент безопасности", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [3, "ГО", "Департамент бизнес-технологий", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 3], [4, "ГО", "Департамент бухгалтерского учета и отчетности", "Главный бухгалтер – директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [5, "ГО", "Департамент бюджетного планирования", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [6, "ГО", "Департамент гарантирования", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [7, "ГО", "Департамент гарантирования", "Заместитель директора департамента", 3, 2, 2, 3, 2, 2, 3, 2], [8, "ГО", "Департамент заимствования и международного сотрудничества", "Директор департамента", 3, 3, 3, 3, 2, 3, 3, 2], [9, "ГО", "Департамент закупок", "Директор департамента", 3, 3, 3, 3, 2, 3, 3, 2], [10, "ГО", "Департамент информационных технологий", "Директор департамента", 3, 3, 2, 3, 3, 3, 3, 2], [11, "ГО", "Департамент казначейства", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [12, "ГО", "Департамент кредитного администрирования", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [13, "ГО", "Департамент маркетинга", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [14, "ГО", "Департамент мониторинга", "Директор департамента", 3, 3, 3, 3, 2, 3, 3, 2], [15, "ГО", "Департамент по взаимодействию с государственными органами", "Директор департамента", 3, 3, 3, 3, 2, 3, 3, 2], [16, "ГО", "Департамент по взаимодействию с государственными органами", "Заместитель директора департамента", 3, 2, 3, 3, 2, 2, 3, 2], [17, "ГО", "Департамент по продвижению программ и регионального развития", "Директор департамента", 3, 3, 3, 3, 2, 3, 3, 3], [18, "ГО", "Департамент по продвижению программ и регионального развития", "Заместитель директора департамента", 3, 2, 3, 3, 2, 2, 3, 2], [19, "ГО", "Департамент по работе с проблемными активами", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [20, "ГО", "Департамент по развитию персонала", "Директор департамента", 3, 3, 2, 3, 3, 3, 3, 3], [21, "ГО", "Департамент программного финансирования", "Директор департамента", 3, 3, 3, 3, 2, 3, 3, 2], [22, "ГО", "Департамент риск - менеджмента", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [23, "ГО", "Департамент стратегического анализа и корпоративного развития", "Директор департамента", 3, 3, 2, 3, 3, 3, 3, 2], [24, "ГО", "Департамент субсидирования", "Директор департамента", 3, 3, 3, 3, 2, 3, 3, 2], [25, "ГО", "Юридический департамент", "Директор департамента", 3, 3, 2, 3, 2, 3, 3, 2], [26, "РФ", "РФ по Акмолинской обл.", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [27, "РФ", "РФ по Акмолинской обл.", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [28, "РФ", "РФ по Актюбинской обл.", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [29, "РФ", "РФ по Актюбинской обл.", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [30, "РФ", "РФ по Алматинской обл.", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [31, "РФ", "РФ по Алматинской обл.", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [32, "РФ", "РФ по Атырауской обл.", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [33, "РФ", "РФ по Атырауской обл.", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [34, "РФ", "РФ по ВКО", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [35, "РФ", "РФ по ВКО", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [36, "РФ", "РФ по Жамбылской обл.", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [37, "РФ", "РФ по Жамбылской обл.", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [38, "РФ", "РФ по ЗКО", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [39, "РФ", "РФ по ЗКО", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [40, "РФ", "РФ по Карагандинской обл.", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [41, "РФ", "РФ по Карагандинской обл.", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [42, "РФ", "РФ по Костанайской обл.", "Директор филиала", 3, 3, 3, 3, 2, 3, 3, 2], [43, "РФ", "РФ по Костанайской обл.", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [44, "РФ", "РФ по Кызылординской обл.", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [45, "РФ", "РФ по Кызылординской обл.", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [46, "РФ", "РФ по Мангистауской обл.", "Директор филиала", 3, 3, 3, 3, 2, 3, 3, 2], [47, "РФ", "РФ по Мангистауской обл.", "Заместитель директора филиала", 2, 3, 2, 3, 2, 2, 3, 2], [48, "РФ", "РФ по Павлодарской области", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [49, "РФ", "РФ по Павлодарской области", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [50, "РФ", "РФ по СКО", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [51, "РФ", "РФ по СКО", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [52, "РФ", "РФ по Туркестанской области", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [53, "РФ", "РФ по Туркестанской области", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [54, "РФ", "РФ по г.Алматы", "Директор филиала", 3, 3, 3, 3, 2, 3, 3, 2], [55, "РФ", "РФ по г.Алматы", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [56, "РФ", "РФ по г.Алматы", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [57, "РФ", "РФ по г.Астана", "Директор филиала", 3, 3, 3, 3, 2, 3, 3, 2], [58, "РФ", "РФ по г.Астана", "Заместитель директора филиала", 2, 2, 3, 3, 2, 2, 3, 2], [59, "РФ", "РФ по г.Астана", "Заместитель директора филиала", 2, 2, 3, 3, 2, 2, 3, 2], [60, "РФ", "РФ по г.Шымкент", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [61, "РФ", "РФ по г.Шымкент", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [62, "РФ", "РФ по области Абай", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2], [63, "РФ", "РФ по области Жетiсу", "Директор филиала", 3, 3, 3, 3, 2, 3, 3, 2], [64, "РФ", "РФ по области Жетiсу", "Заместитель директора филиала", 2, 2, 2, 3, 2, 2, 3, 2], [65, "РФ", "РФ по области Ұлытау", "Директор филиала", 3, 2, 3, 3, 2, 3, 3, 2]];
const sourceCases = [[1, "C2", "C2.2", "C2.3", "B", "D"], [2, "C4", "C4.2", "C7.1", "D", "A"], [3, "C4", "C4.2", "C6.3", "A", "C"], [4, "C1", "C1.3", "C8.3", "C", "B"], [5, "C7", "C7.3", "C2.3", "D", "A"], [6, "C5", "C5.2", "C3.2", "B", "D"], [7, "C2", "C2.3", "C7.1", "A", "C"], [8, "C4", "C4.1", "C2.1", "C", "A"], [9, "C3", "C3.1", "C4.2", "B", "D"], [10, "C6", "C6.3", "C2.2", "D", "B"], [11, "C7", "C7.2", "C2.3", "A", "C"], [12, "C8", "C8.3", "C1.2", "C", "B"], [13, "C3", "C3.2", "C2.2", "B", "D"], [14, "C7", "C7.1", "C2.1", "D", "B"]];
const holding = await import("../packages/core/holding").catch(() => ({})) as any;

describe("Holding source contract", () => {
  it("makes the literal Holding model the active default, not eight substitutes", () => {
    expect(DEFAULT_COMPETENCIES.competencies.map(c => c.id)).toEqual(["C1","C2","C3","C4","C5","C6","C7","C8"]);
    expect((DEFAULT_COMPETENCIES as any).holdingModelVersion).toBe("holding-2026-11-21");
    expect(DEFAULT_COMPETENCIES.roles).toHaveLength(65);
  });
  it("preserves all 24 source indicators including C7.2 without the older slash", () => {
    expect(holding.HOLDING_COMPETENCIES).toHaveLength(8);
    const actual = holding.HOLDING_COMPETENCIES.flatMap((c:any) => c.indicators.map((i:any) => [c.id,c.name.ru,c.block,i.id,i.text.ru]));
    expect(actual).toEqual(sourceIndicators);
    for(const c of holding.HOLDING_COMPETENCIES) {
      expect(c.name.kk).toBe(c.name.ru);
      for(const i of c.indicators) expect(i.text.kk).toBe(i.text.ru);
    }
  });
  it("preserves every numbered job profile and all 520 informational criticalities", () => {
    expect(holding.HOLDING_PROFILES).toHaveLength(65);
    expect(holding.HOLDING_PROFILES.map((p:any) => [p.profileRow,p.block,p.unit,p.position,...Array.from({length:8},(_,i)=>p.criticality[`C${i+1}`])])).toEqual(sourceProfiles);
    for(const p of holding.HOLDING_PROFILES) {
      expect(p.targetLevelModel).toBe("В");
      expect(p.targetScore).toBeNull();
    }
    expect(holding.holdingProfile(55).profileRow).not.toBe(holding.holdingProfile(56).profileRow);
    expect(holding.holdingProfile(58).profileRow).not.toBe(holding.holdingProfile(59).profileRow);
    expect(holding.holdingProfile(66)).toBeUndefined();
  });
  it("retains exact provenance and source-language fallback without fabricated translations", () => {
    const data=JSON.parse(readFileSync("data/holding-model-2026-11-21.json","utf8"));
    expect(data.sourceLanguage).toBe("ru");
    expect(data.translationStatus.kk).toBe("source_ru_fallback");
    expect(data.provenance.competencies.sha256).toBe("546b22d3701a0fab4b93109eb4889452c61eb81bc953d9e0994f87542672427e");
    expect(data.provenance.profiles.sha256).toBe("4be1d6498523d83f152fab628dc6bad12fd0bdb8fcb138fc8f0802789e12e712");
    expect(data.provenance.profiles.sheet).toBe("Профили должностей");
    expect(data.databaseFields.map((r:any)=>r.field)).toContain("not_observed");
  });
  it("maps all fourteen SJT rows to the original stable question and option IDs", () => {
    expect(holding.HOLDING_SJT_CASES).toHaveLength(14);
    expect(holding.HOLDING_SJT_CASES.map((c:any) => [c.caseNumber,c.competencyCode,c.indicatorCode,c.additionalIndicatorCode,c.mostOptionId.slice(-1),c.leastOptionId.slice(-1)])).toEqual(sourceCases);
    const form=JSON.parse(readFileSync("data/catalog.json","utf8")).find((f:any)=>f.id==="situations");
    for(const c of holding.HOLDING_SJT_CASES) {
      expect(c.questionId).toBe(`situations-v2-${c.caseNumber}`);
      expect(c.mostOptionId).toBe(`${c.questionId}-${sourceCases[c.caseNumber-1][4]}`);
      expect(form.config.items[c.questionId]).toMatchObject({most:c.mostOptionId,least:c.leastOptionId});
    }
  });
  it("shows separate scores only for C2 C3 C4 C7 and never invents a final 1–5 rating", () => {
    expect(typeof holding.holdingSjtProfile).toBe("function");
    const details=holding.HOLDING_SJT_CASES.map((c:any)=>({questionId:c.questionId,score:2}));
    const profile=holding.holdingSjtProfile(details);
    expect(profile).toHaveLength(8);
    expect(profile.filter((p:any)=>p.showSeparate).map((p:any)=>p.code)).toEqual(["C2","C3","C4","C7"]);
    expect(profile.map((p:any)=>p.maximum)).toEqual([2,4,4,6,2,2,6,2]);
    expect(profile.reduce((s:number,p:any)=>s+p.total,0)).toBe(28);
    for(const p of profile.filter((p:any)=>!p.showSeparate)) expect(p.note).toBe("один кейс — дополнительный источник; основная оценка — по упражнениям и интервью");
    expect(holding.holdingSjtProfile([...details,details[0],{questionId:"unknown",score:2}])).toEqual(profile);
    expect(holding.holdingSjtProfile([]).every((p:any)=>p.total===0)).toBe(true);
  });
  it("rejects fabricated role translations and tampering with informational criticality",()=>{
    const config=structuredClone(DEFAULT_COMPETENCIES) as any;
    config.roles[0].name.kk="Жасанды аударма";
    expect(competencyModelSchema.safeParse(config).success).toBe(false);
    config.roles[0].name.kk=config.roles[0].name.ru;
    config.roles[0].criticality.C1=1;
    expect(competencyModelSchema.safeParse(config).success).toBe(false);
  });
  it("validates Holding nullable targets independently of criticality and forbids altered source literals", () => {
    expect(competencyModelSchema.safeParse(DEFAULT_COMPETENCIES).success).toBe(true);
    const c=structuredClone(DEFAULT_COMPETENCIES) as any;
    expect(c.roles[0].targets.C1).toBeNull();
    c.roles[0].targets.C1=3;
    expect(competencyModelSchema.safeParse(c).success).toBe(false);
    c.roles[0].targets.C1=null;
    c.competencies[0].name.ru="Изменённая компетенция";
    expect(competencyModelSchema.safeParse(c).success).toBe(false);
  });
  it("still reads frozen legacy lowercase IDs, four numeric target roles and old observations", async () => {
    const core=await import("../packages/core/competencies") as any;
    expect(core.LEGACY_COMPETENCIES).toBeDefined();
    expect(competencyModelSchema.safeParse(core.LEGACY_COMPETENCIES).success).toBe(true);
    expect(exerciseCriteria(core.LEGACY_COMPETENCIES,"roleplay").some(c=>c.competencyId==="team")).toBe(true);
  });
  it("makes all 24 Holding indicators available for exercise/interview observation with explicit null status", () => {
    for(const type of ["group","roleplay","presentation","facts","interview"]) {
      const criteria=exerciseCriteria(DEFAULT_COMPETENCIES,type);
      expect(criteria).toHaveLength(24);
      expect(criteria.every(c=>c.allowNotObserved)).toBe(true);
      expect(criteria.map(c=>c.id)).toEqual(sourceIndicators.map(r=>r[3]));
    }
  });
});

// DB/provider defaults are fenced: these unit tests must never reach a remote service.
const store=vi.hoisted(()=>({ models:[] as any[], consensus:[] as any[], people:[] as any[], exercises:[] as any[], allUnobserved:false }));
vi.mock("../apps/api/src/auth",()=>({auth:{api:{getSession:()=>{throw new Error("No auth transport in model unit tests")}}}}));
vi.mock("better-auth/crypto",()=>({hashPassword:async()=>"test-only-hash"}));
vi.mock("../apps/api/src/report-lifecycle",()=>({queueCompletedAssessment:async()=>{}}));
vi.mock("../apps/api/src/db",()=>{
  const match=(row:any,where:any)=>Object.entries(where||{}).every(([k,v])=>row[k]===v);
  const subject=()=>({id:"participant",userId:"participant-user",organizationId:"holding-test",role:"employee",status:"active",profileRow:55,block:"РФ",targetLevelModel:"В",organization:{id:"holding-test",purpose:"assessment"},user:{id:"participant-user",platformAdmin:false},createdAt:new Date()});
  const db:any={
    $queryRaw:async(sql:TemplateStringsArray,...values:any[])=>/FROM (users|memberships)/.test(sql.join(""))?[{id:values[0]}]:[],
    organization:{findMany:async()=>[{id:"holding-test"}]},
    competencyModel:{
      findFirst:async({where}:any)=>store.models.filter(r=>match(r,where)).at(-1)||null,
      count:async()=>store.models.length,
      create:async({data}:any)=>{const row={id:`model-${store.models.length+1}`,...structuredClone(data)};store.models.push(row);return row},
    },
    assessmentExercise:{findMany:async()=>store.exercises.filter(e=>e.active),update:async({where,data}:any)=>Object.assign(store.exercises.find(e=>e.id===where.id),data),create:async({data}:any)=>{const row={id:`exercise-${store.exercises.length}`,active:true,...data};store.exercises.push(row);return row}},
    membership:{findFirst:async()=>subject(),findUnique:async()=>subject(),findMany:async(args:any)=>args?.select?.userId?[{id:"participant",userId:"participant-user"}]:[{id:"expert-1",user:{name:"One"}},{id:"expert-2",user:{name:"Two"}}],count:async()=>1,create:async({data}:any)=>{const row={id:"new-person",...structuredClone(data),user:{name:"Test Person"}};store.people.push(row);return row}},
    user:{findUnique:async()=>null,create:async({data}:any)=>({id:"user-person",...data})},account:{create:async()=>({})},organizationUnit:{upsert:async()=>({})},
    campaign:{create:async({data}:any)=>({id:"campaign",country:null,...data})},
    testAssignment:{findMany:async()=>[],count:async()=>1},
    expertObservation:{findMany:async()=>["expert-1","expert-2"].map((expertId,i)=>({id:`observation-${i}`,expertId,exerciseId:"exercise",notes:"Пример поведения",indicatorExamples:{"C1.1":"Подтвердил срок задачи"},scores:{"C1.1":store.allUnobserved?null:i?4:2,"C1.2":null},criteriaSnapshot:{type:"interview",name:{ru:"Интервью"},criteria:[{id:"C1.1",competencyId:"C1",name:"C1.1"},{id:"C1.2",competencyId:"C1",name:"C1.2"}]}}))},
    competencyConsensus:{findFirst:async({where}:any)=>store.consensus.filter(r=>match(r,where)).at(-1)||null,create:async({data}:any)=>{const row={id:`consensus-${store.consensus.length+1}`,...structuredClone(data)};store.consensus.push(row);return row}},
    auditLog:{create:async()=>({})},
  };
  db.$transaction=async(fn:any)=>fn(db);
  return {db,json:(v:any)=>JSON.parse(JSON.stringify(v)),audit:async()=>({})};
});
const peopleApi=await import("../apps/api/src/people");
const competencyApi=await import("../apps/api/src/competencies");
const ctx:any={role:"expert",user:{id:"user-expert"},member:{id:"expert-1"},org:{id:"holding-test",employeeLimit:100}};

describe("Holding backend roundtrip contract",()=>{
  it("stores a campaign country only when explicitly supplied; legacy remains unknown",async()=>{
    const explicit=await peopleApi.createCampaign({...ctx,role:"admin"},{name:"Проверка страны",endsAt:"2099-01-01T00:00:00.000Z",country:"Казахстан"});
    expect(explicit.country).toBe("Казахстан");
    const legacy=await peopleApi.createCampaign({...ctx,role:"admin"},{name:"Проверка страны",endsAt:"2099-01-01T00:00:00.000Z"});
    expect(legacy.country).toBeNull();
  });

  it("rejects profile tokens with leading zeroes or non-literal numeric notation",()=>{
    for(const profileRow of ["01","1.0","1e1"," 1 "]) expect(peopleApi.personSchema.safeParse({name:"Test Person",email:"test@example.test",profileRow,unit:"Office"}).success).toBe(false);
  });
  it("binds numbered profiles to authoritative literals, not caller-provided labels",async()=>{
    expect(peopleApi.personSchema.safeParse({name:"Test Person",email:"Test@example.test",profileRow:56,unit:"WRONG",position:"WRONG"}).success).toBe(false);
    const parsed=peopleApi.personSchema.parse({name:"Test Person",email:"Test@example.test",profileRow:56}) as any;
    expect(parsed).toMatchObject({profileRow:56,block:"РФ",unit:"РФ по г.Алматы",position:"Заместитель директора филиала",targetLevelModel:"В"});
    const created=await peopleApi.createPerson({...ctx,role:"admin"},{name:"Test Person",email:"Test@example.test",profileRow:56});
    expect(created).toMatchObject({profileRow:56,block:"РФ",unit:"РФ по г.Алматы",position:"Заместитель директора филиала",targetLevelModel:"В"});
    expect(peopleApi.personSchema.safeParse({name:"Test Person",email:"test@example.test",profileRow:66,unit:"X"}).success).toBe(false);
    expect(peopleApi.personSchema.safeParse({name:"Test Person",email:"test@example.test",role:"expert",unit:"Office"}).success).toBe(true);
  });
  it("appends one active Holding version and new exercise versions without touching history, then is idempotent",async()=>{
    const legacy=(await import("../packages/core/competencies")).LEGACY_COMPETENCIES;
    store.models=[{id:"legacy-model",organizationId:"holding-test",version:1,content:legacy}];
    store.exercises=[{id:"old-exercise",organizationId:"holding-test",type:"interview",version:1,active:true,name:{ru:"Interview"},criteria:[{id:"old"}]}];
    const old=structuredClone(store.models[0]);
    await competencyApi.initializeCompetencies();
    expect(store.models).toHaveLength(2);
    expect(store.models[0]).toEqual(old);
    expect(store.models[1].content.holdingModelVersion).toBe("holding-2026-11-21");
    expect(store.exercises).toHaveLength(2);
    expect(store.exercises[0].criteria).toEqual([{id:"old"}]);
    await competencyApi.initializeCompetencies();
    expect(store.models).toHaveLength(2);
    expect(store.exercises).toHaveLength(2);
  });
  it("creates and reads append-only consensus snapshots with profile/criticality/null-target and independent assessor evidence",async()=>{
    store.models=[{id:"holding-model",organizationId:"holding-test",version:2,content:DEFAULT_COMPETENCIES}];
    store.consensus=[];
    const ratings=DEFAULT_COMPETENCIES.competencies.map(c=>({competencyId:c.id,value:c.id==="C1"?3:null,notObserved:c.id!=="C1",reason:"Источники и наблюдения проверены",evidenceText:"Согласовал срок следующего шага",evidenceIds:c.id==="C1"?["observation-0","observation-1"]:[]}));
    const data={campaignId:"campaign",modelId:"holding-model",roleId:"holding-profile-55",ratings};
    await competencyApi.saveConsensus(ctx,"participant",data);
    const first=structuredClone(store.consensus[0]);
    await competencyApi.saveConsensus(ctx,"participant",data);
    expect(store.consensus).toHaveLength(2);
    expect(store.consensus[0]).toEqual(first);
    const read=await competencyApi.competencyEvidence(ctx,"participant","campaign");
    const snapshot=(read.consensus!.scores as any);
    expect(snapshot).toMatchObject({participantId:"participant",profileRow:55,block:"РФ",targetLevelModel:"В",holdingModelVersion:"holding-2026-11-21"});
    expect(snapshot.ratings[0]).toMatchObject({competencyCode:"C1",score:3,targetScore:null,criticality:2,notObserved:false,evidenceText:"Согласовал срок следующего шага"});
    expect(snapshot.ratings[0].assessorScores.map((r:any)=>[r.assessorId,r.scores[0].score])).toEqual([["expert-1",2],["expert-2",4]]);
    expect(snapshot.ratings[1]).toMatchObject({score:null,notObserved:true,targetScore:null});
    expect(read.roleId).toBe("holding-profile-55");
  });
  it("retains unobserved evidence for reading without counting it as an observed assessment method",async()=>{
    store.allUnobserved=true;
    try {
      const evidence=await competencyApi.competencyEvidence(ctx,"participant","campaign");
      const card=evidence.cards.find(c=>c.id==="C1")!;
      expect(card.sources).toHaveLength(2);
      expect(card.methodCount).toBe(0);
      expect(card.sources.every(s=>s.notObserved===true)).toBe(true);
    } finally { store.allUnobserved=false; }
  });
  it("rejects contradictory not-observed scores and changing a participant's bound profile",async()=>{
    const ratings=DEFAULT_COMPETENCIES.competencies.map(c=>({competencyId:c.id,value:1,notObserved:true,reason:"Источники и наблюдения проверены",evidenceIds:["observation-0"]}));
    await expect(competencyApi.saveConsensus(ctx,"participant",{campaignId:"campaign",modelId:"holding-model",roleId:"holding-profile-55",ratings})).rejects.toThrow();
    ratings.forEach(r=>{(r as any).value=null});
    await expect(competencyApi.saveConsensus(ctx,"participant",{campaignId:"campaign",modelId:"holding-model",roleId:"holding-profile-56",ratings})).rejects.toThrow();
  });
});

vi.mock("../apps/web/components/ui",()=>({
  useApp:()=>({t:(ru:string)=>ru,loc:(v:any)=>v?.ru||"",notify:()=>{},me:{role:"expert"},campaign:"campaign"}),
  useData:()=>({data:{content:DEFAULT_COMPETENCIES},loading:false,error:null,refresh:async()=>{}}),
  Panel:({children,title}:any)=>React.createElement("section",null,React.createElement("h2",null,title),children),
  Field:({children,label}:any)=>React.createElement("label",null,label,children),
  Button:({children,busy,...props}:any)=>React.createElement("button",props,children),
  LoadState:({children}:any)=>React.createElement("div",null,children),
  post:async()=>({}),
}));
describe("Holding importer safety",()=>{
  it("requires an explicit tenant and refuses every remote apply before loading database code",async()=>{
    const importer=await import("../scripts/import-holding").catch(()=>({})) as any;
    expect(typeof importer.parseHoldingImportArguments).toBe("function");
    const parse=importer.parseHoldingImportArguments;
    expect(()=>parse([],"postgresql://localhost/holding_test")).toThrow();
    expect(parse(["--org-id","org"],"postgresql://localhost/holding_test")).toMatchObject({organizationId:"org",dryRun:true});
    expect(parse(["--org-id","org","--apply"],"postgresql://127.0.0.1/holding_test").dryRun).toBe(false);
    expect(()=>parse(["--org-id","org","--apply"],"postgresql://remote.example/holding_test")).toThrow();
    expect(parse(["--org-id","org","--dry-run"],"postgresql://remote.example/holding_test").dryRun).toBe(true);
    expect(()=>parse(["--org-id","org","--apply"],"postgresql://localhost/holding_test?host=remote.example")).toThrow();
  });
});
describe("Holding reachable UI and schema contract",()=>{
  it("renders exact 65 profiles and all 24 indicators with criticality/null-target/source-language labels",async()=>{
    const {renderToStaticMarkup}=await import("react-dom/server");
    const {createElement}=await import("react");
    // Transpile the actual TSX independently of Next's jsx:preserve tsconfig.
    const ts=await import("typescript"), {runInNewContext}=await import("node:vm"), {createRequire}=await import("node:module");
    const realRequire=createRequire(import.meta.url), ui:any={};
    const core=await import("../packages/core/competencies");
    const code=ts.transpileModule(readFileSync("apps/web/components/competencies.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    runInNewContext(code,{exports:ui,require:(id:string)=>id==="./ui"?{useApp:()=>({t:(ru:string)=>ru,loc:(v:any)=>v.ru}),Panel:({children,title}:any)=>React.createElement("section",null,title,children)}:id.endsWith("/holding")?holding:id.endsWith("/competencies")?core:realRequire(id)});
    expect(typeof ui.HoldingModelReference).toBe("function");
    const html=renderToStaticMarkup(createElement(ui.HoldingModelReference));
    expect((html.match(/data-profile-row=/g)||[])).toHaveLength(65);
    expect((html.match(/data-indicator-id=/g)||[])).toHaveLength(24);
    expect(html).toContain("Целевой уровень модели: В");
    expect(html).toContain("Критичность — не вес и не требуемый балл");
    expect(html).toContain("Целевой балл не согласован");
    expect(html).toContain("Исходный язык: RU");
    for(const r of sourceIndicators) expect(html).toContain(r[4]);
  });
  it("exposes authoritative numbered profile selection on the real employee creation form",async()=>{
    const ts=await import("typescript"), {runInNewContext}=await import("node:vm"), {createRequire}=await import("node:module");
    const {renderToStaticMarkup}=await import("react-dom/server"), ui:any={}, realRequire=createRequire(import.meta.url);
    const code=ts.transpileModule(readFileSync("apps/web/components/organization.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const box=({children,label}:any)=>React.createElement("div",null,label,children);
    runInNewContext(code,{exports:ui,require:(id:string)=>id==="./ui"?{useApp:()=>({t:(ru:string)=>ru,notify:()=>{}}),Modal:box,Field:box,Button:box}:id==="./pilot-permission"?{}:id.endsWith("/holding")?holding:id.endsWith("/assessment-policy")?{}:id.endsWith("/method-passports")?{}:id.endsWith("/analytics-privacy")?{}:realRequire(id)});
    const html=renderToStaticMarkup(React.createElement(ui.AddPerson,{onClose:()=>{},onSaved:()=>{}}));
    expect(html).toContain('name="profileRow"');
    expect((html.match(/value="(?:[1-9]|[1-5][0-9]|6[0-5])"/g)||[])).toHaveLength(65);
    expect(html).toContain("РФ по г.Алматы");
    expect(html).toContain("№ 55");
    expect(html).toContain("№ 56");
  });
  it("renders the live SJT question count and preserves the literal primary/additional mapping reference",async()=>{
    const ts=await import("typescript"), {runInNewContext}=await import("node:vm"), {createRequire}=await import("node:module");
    const {renderToStaticMarkup}=await import("react-dom/server"), ui:any={}, realRequire=createRequire(import.meta.url);
    const code=ts.transpileModule(readFileSync("apps/web/components/expert-setup.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const box=({children,title,label}:any)=>React.createElement("div",null,title,label,children);
    runInNewContext(code,{exports:ui,require:(id:string)=>id==="./ui"?{useApp:()=>({t:(ru:string)=>ru,loc:(v:any)=>v.ru,notify:()=>{}}),useData:()=>({loading:false,data:{questions:holding.HOLDING_SJT_CASES.map((c:any)=>({id:c.questionId,text:{ru:c.questionId},options:[]})),ratings:{}}}),Panel:box,LoadState:box,Button:box,Field:box}:id.endsWith("/holding")?holding:realRequire(id)});
    const html=renderToStaticMarkup(React.createElement(ui.SjtExpertSetup));
    expect(html).toContain("Открыть 14 ситуаций для оценки");
    expect(html).toContain("Ключ не утверждён экспертной панелью");
    expect((html.match(/data-holding-case=/g)||[])).toHaveLength(14);
  });
  it("wires Analytics through the privacy helper and discloses no small-group labels or method strata",async()=>{
    const ts=await import("typescript"), {runInNewContext}=await import("node:vm"), {createRequire}=await import("node:module");
    const {renderToStaticMarkup}=await import("react-dom/server"), ui:any={}, realRequire=createRequire(import.meta.url), privacy=await import("../packages/core/analytics-privacy");
    const rows=[...Array.from({length:4},(_,i)=>({id:`small-${i}`,role:"employee",unit:"SECRET_SMALL_GROUP",status:"completed",results:[{name:{ru:"SECRET_SMALL_METHOD"},testVersionId:"small-v",scoringKeyId:"k",language:"ru",score:{algorithm:"cognitive",total:1,maximum:2}}]})),...Array.from({length:5},(_,i)=>({id:`large-${i}`,role:"employee",unit:"VISIBLE_GROUP",status:"completed",results:[{name:{ru:"VISIBLE_METHOD"},testVersionId:"large-v",scoringKeyId:"k",language:"ru",score:{algorithm:"cognitive",total:1,maximum:2}}]}))];
    const code=ts.transpileModule(readFileSync("apps/web/components/organization.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const box=({children,title,label}:any)=>React.createElement("div",null,title,label,children);
    runInNewContext(code,{exports:ui,require:(id:string)=>id==="./ui"?{useApp:()=>({t:(ru:string)=>ru,loc:(v:any)=>v?.ru||"",notify:()=>{},campaign:"c"}),useData:()=>({loading:false,data:rows}),Panel:box,PageTitle:box,LoadState:box,Button:box}:id==="./pilot-permission"?{}:id.endsWith("/holding")?holding:id.endsWith("/assessment-policy")?{}:id.endsWith("/method-passports")?{}:id.endsWith("/analytics-privacy")?privacy:realRequire(id)});
    const html=renderToStaticMarkup(React.createElement(ui.Analytics));
    expect(html).not.toContain("SECRET_SMALL_GROUP");
    expect(html).not.toContain("SECRET_SMALL_METHOD");
    expect(html).toContain("VISIBLE_GROUP");
    expect(html).toContain("VISIBLE_METHOD");
    expect(html).toContain("Группы менее 5 участников не отображаются");
  });
  it("has additive membership binding/data-mode columns and tenant-fenced consensus storage",()=>{
    const schema=readFileSync("prisma/schema.prisma","utf8");
    expect(schema).toMatch(/profileRow\s+Int\?/);
    expect(schema).toMatch(/targetLevelModel\s+String\s+@default\("В"\)/);
    expect(schema).toMatch(/dataMode\s+String\s+@default\("real"\)/);
    expect(schema).toMatch(/country\s+String\?/);
    expect(schema).toMatch(/demoOnly\s+Boolean\s+@default\(false\)/);
    const sql=readFileSync("prisma/migrations/202611210001_holding_model/migration.sql","utf8");
    expect(sql).toContain('"profileRow"');
    expect(sql).toContain('"dataMode"');
    const baseline=readFileSync("prisma/migrations/202611170001_assessment_quality/migration.sql","utf8");
    expect(baseline).toContain('REFERENCES memberships(id,"organizationId") ON DELETE CASCADE');
    for(const existing of ["competency_models_organizationId_fkey","competency_consensus_membershipId_organizationId_fkey","competency_consensus_campaignId_organizationId_fkey"])
      expect(sql).not.toContain(`ADD CONSTRAINT "${existing}"`);
    expect(sql).toContain('ADD CONSTRAINT "competency_consensus_modelId_organizationId_fkey"');
    expect(schema).toContain('onDelete:NoAction,onUpdate:NoAction,map:"competency_consensus_modelId_fkey"');
    expect(sql).not.toMatch(/DELETE FROM|UPDATE "test_results"|UPDATE "expert_observations"/);
  });
});
