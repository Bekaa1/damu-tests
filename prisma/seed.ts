import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { readFileSync } from "node:fs";
import { calculateScore, type QuestionInput } from "../packages/core/scoring";
import { defaultMatrix, DEFAULT_AI_PROMPT } from "../packages/core/contracts";
const db = new PrismaClient();
const J = (x: unknown) => JSON.parse(JSON.stringify(x));
const demo = process.env.DEMO_MODE === "true";
const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
for (const item of catalog) {
  await db.test.upsert({
    where: { id: item.id },
    update: {},
    create: {
      id: item.id,
      name: item.name,
      description: item.description,
      direction: item.direction,
      source: item.source,
      licenseStatus: item.licenseStatus,
      scientificBasis: item.scientificBasis,
    },
  });
  const id = `${item.id}-v1`;
  if (!(await db.testVersion.findUnique({ where: { id } }))) {
    await db.testVersion.create({
      data: {
        id,
        testId: item.id,
        version: "1.0-draft",
        status: demo ? "published" : "draft",
        durationMinutes: item.durationMinutes,
        instructions: item.instructions,
        limitations: item.limitations,
        approvedBy: demo ? "DEMO_ONLY" : null,
        translationStatus: "draft",
        questions: {
          create: item.questions.map((q: QuestionInput, i: number) => ({
            id: q.id,
            position: i,
            type: q.type,
            text: q.text,
            imageUrl: q.imageUrl,
            options: {
              create: q.options.map((o, j) => ({ ...o, position: j })),
            },
          })),
        },
        keys: {
          create: {
            id: `${item.id}-key-v1`,
            version: "1.0-preliminary",
            algorithm: item.algorithm,
            config: item.config,
            source:
              item.id === "situations"
                ? "ТЗ 2.0, предварительный разбор Jobzilla; порядок 123test сохранён"
                : item.source,
            controlExamples: item.controlExamples,
          },
        },
      },
    });
    await db.licenseRecord.create({
      data: {
        testId: item.id,
        source: item.source,
        status: item.licenseStatus,
        notes:
          item.id === "situations"
            ? "Владелец подтвердил разрешение в переписке. Переводы подготовлены, методологическое утверждение ожидается."
            : "Источник записан. Переводы и отдельные формы ожидают методологического утверждения.",
      },
    });
  }
}
await db.platformSettings.upsert({
  where: { id: "default" },
  update: {},
  create: {
    aiPrompt: DEFAULT_AI_PROMPT,
    aiPromptVersion: "2.0",
    aiProviderAllowlist: [],
    aiModel: process.env.OPENROUTER_MODEL || "",
  },
});
if (!demo) {
  console.log(
    "Method drafts prepared. Run the owner provisioning script to create an administrator.",
  );
  await db.$disconnect();
  process.exit(0);
}
const orgId = "demo-organization";
if (await db.organization.findUnique({ where: { id: orgId } })) {
  console.log("Demo already exists. Existing records were preserved.");
  await db.$disconnect();
  process.exit(0);
}
const org = await db.organization.create({
  data: {
    id: orgId,
    name: "Демо-организация",
    slug: "demo",
    employeeLimit: 100,
    assessmentLimit: 1000,
    showPreliminary: true,
    matrixConfig: J(defaultMatrix),
  },
});
const password = await hashPassword(
  process.env.SEED_PASSWORD || "AssessFlow!2026",
);
async function user(
  id: string,
  name: string,
  email: string,
  role: string,
  position: string,
  unit: string,
  platformAdmin = false,
) {
  const u = await db.user.create({
    data: {
      id,
      name,
      email,
      emailVerified: true,
      mustChangePassword: false,
      platformAdmin,
      accounts: {
        create: { providerId: "credential", accountId: id, password },
      },
    },
  });
  return db.membership.create({
    data: {
      id: `member-${id}`,
      organizationId: org.id,
      userId: u.id,
      role,
      position,
      unit,
      category: "Руководитель",
      consentAt: new Date(),
      consentVersion: "1.0-demo",
    },
  });
}
await user(
  "admin",
  "Алия Нурланова",
  "admin@assessflow.local",
  "admin",
  "Администратор организации",
  "Головной офис",
);
await user(
  "owner",
  "Владелец платформы",
  "owner@assessflow.local",
  "admin",
  "Суперадминистратор",
  "Головной офис",
  true,
);
const expert = await user(
  "expert",
  "Елена Соколова",
  "expert@assessflow.local",
  "expert",
  "Эксперт по оценке персонала",
  "Головной офис",
);
const units = [
  "Головной офис",
  "Филиал · Алматы",
  "Филиал · Астана",
  "Филиал · Шымкент",
  "Филиал · Караганда",
];
for (const name of units)
  await db.organizationUnit.create({ data: { organizationId: org.id, name } });
const campaign = await db.campaign.create({
  data: {
    id: "demo-campaign",
    organizationId: org.id,
    name: "Руководители · осень 2026",
    description:
      "Демонстрационная кампания. Все участники и результаты вымышлены.",
    startsAt: new Date("2026-10-01"),
    endsAt: new Date("2026-12-15"),
  },
});
const exerciseTypes = [
  ["group", "Групповое упражнение", "Топтық жаттығу"],
  ["roleplay", "Ролевая игра", "Рөлдік ойын"],
  ["presentation", "Аналитическая презентация", "Талдау таныстырылымы"],
  ["interview", "Структурированное интервью", "Құрылымдалған сұхбат"],
  ["facts", "Поиск фактов", "Деректерді іздеу"],
];
const criteria = [
  {
    id: "criterion-1",
    name: "Компетенция для настройки",
    indicators: ["Добавьте наблюдаемый поведенческий индикатор"],
    scale: [
      { value: 1, description: "Низкая выраженность индикатора" },
      { value: 2, description: "Выражен в отдельных случаях" },
      { value: 3, description: "Проявляется на базовом уровне" },
      { value: 4, description: "Проявляется устойчиво" },
      {
        value: 5,
        description: "Проявляется последовательно в сложных ситуациях",
      },
    ],
    allowNotObserved: true,
  },
];
for (const [type, ru, kk] of exerciseTypes)
  await db.assessmentExercise.create({
    data: {
      id: `exercise-${type}`,
      organizationId: org.id,
      type,
      name: { ru, kk },
      criteria: J(criteria),
    },
  });
const first = [
  "Айдар",
  "Дана",
  "Руслан",
  "Аружан",
  "Марат",
  "Алия",
  "Ерлан",
  "Жанна",
  "Тимур",
  "Сауле",
  "Нурлан",
  "Мадина",
  "Арман",
];
const last = [
  "Сериков",
  "Омарова",
  "Ибраев",
  "Ахметова",
  "Муратов",
  "Касымова",
  "Толеубаев",
  "Алиева",
  "Исмаилов",
  "Кенжеева",
  "Бекетов",
  "Нуртаева",
  "Рахимов",
];
const positions = [
  "Руководитель департамента",
  "Начальник отдела",
  "Директор филиала",
  "Руководитель направления",
];
const ordered = [
  "verbal",
  "numerical",
  "logical",
  "personality",
  "motivation",
  "situations",
].map((id) => catalog.find((x: any) => x.id === id));
for (let n = 0; n < 65; n++) {
  const id = n === 64 ? "employee" : `employee-${n + 1}`;
  const member = await user(
    id,
    `${first[n % 13]} ${last[(n + Math.floor(n / 13)) % 13]}`,
    n === 64
      ? "employee@assessflow.local"
      : `participant${n + 1}@assessflow.local`,
    "employee",
    positions[n % 4],
    units[n < 22 ? 0 : n < 35 ? 1 : n < 47 ? 2 : n < 57 ? 3 : 4],
  );
  const resultIds: string[] = [];
  for (let t = 0; t < ordered.length; t++) {
    const method = ordered[t];
    const a = await db.testAssignment.create({
      data: {
        organizationId: org.id,
        campaignId: campaign.id,
        membershipId: member.id,
        testVersionId: `${method.id}-v1`,
        expertId: expert.id,
      },
    });
    const completed = n < 28 || (n < 50 && t < (n % 4) + 1);
    const started = completed || (n < 50 && t === (n % 4) + 1);
    if (!started) continue;
    const answers: Record<string, unknown> = {};
    method.questions.forEach((q: QuestionInput, i: number) => {
      const key = method.config.items[q.id];
      const correct = (n + i) % 5 !== 0;
      answers[q.id] =
        method.algorithm === "scales"
          ? 1 + ((n + i) % method.config.max)
          : method.algorithm === "sjt"
            ? {
                most: correct
                  ? key.most
                  : q.options.find(
                      (o) => o.id !== key.most && o.id !== key.least,
                    )!.id,
                least: key.least,
              }
            : typeof key.correct === "number"
              ? correct
                ? key.correct
                : key.correct + 1
              : correct
                ? key.correct
                : q.options.find((o) => o.id !== key.correct)!.id;
    });
    const time = new Date(Date.UTC(2026, 9, 15 + (n % 7), 8 + t));
    const attempt = await db.testAttempt.create({
      data: {
        organizationId: org.id,
        assignmentId: a.id,
        language: "ru",
        scoringKeyId: `${method.id}-key-v1`,
        status: completed ? "completed" : "in_progress",
        startedAt: time,
        submittedAt: completed ? time : null,
      },
    });
    const entries = Object.entries(answers);
    const save = completed
      ? entries
      : entries.slice(0, Math.max(1, Math.floor(entries.length / 3)));
    await db.userAnswer.createMany({
      data: save.map(([questionId, value]) => ({
        organizationId: org.id,
        attemptId: attempt.id,
        questionId,
        value: J(value),
      })),
    });
    if (completed) {
      const score = calculateScore(
        method.algorithm,
        method.config,
        method.questions,
        answers,
      );
      const r = await db.testResult.create({
        data: {
          organizationId: org.id,
          attemptId: attempt.id,
          scoringKeyId: `${method.id}-key-v1`,
          result: J(score),
          createdAt: time,
        },
      });
      resultIds.push(r.id);
    }
  }
  if (n < 28) {
    await db.aiReport.create({
      data: {
        organizationId: org.id,
        campaignId: campaign.id,
        membershipId: member.id,
        status: "awaiting_configuration",
        model: "",
        promptVersion: "1.0",
        inputHash: `demo-${n}`,
        resultIds,
      },
    });
    if (n < 18)
      await db.finalReport.create({
        data: {
          organizationId: org.id,
          campaignId: campaign.id,
          membershipId: member.id,
          authorId: "expert",
          version: 1,
          status: "approved",
          approvedAt: new Date("2026-10-21"),
          resultIds,
          observationIds: [],
          matrixX: 1 + (n % 3),
          matrixY: 1 + (Math.floor(n / 3) % 3),
          matrixReason:
            "Демонстрационное расположение для проверки интерфейса матрицы. Не является оценкой реального человека.",
          content: J({
            conclusion:
              "Демонстрационное заключение. Представленные результаты созданы для проверки платформы и не относятся к реальному сотруднику. Для рабочей оценки эксперт сопоставляет первичные баллы, наблюдения в упражнениях и данные интервью.",
            strengths:
              "Подлежит заполнению экспертом на основании конкретных результатов и наблюдений.",
            development:
              "Для определения направлений развития необходимы поведенческие примеры из практических упражнений.",
            risks:
              "Отсутствуют локальные нормативы. Переводы и выбранные формы ожидают методологической проверки.",
            recommendations:
              "Провести структурированное интервью и практические упражнения по согласованным критериям.",
            developmentPlan: [
              {
                goal: "Сформировать обоснованный план развития",
                action:
                  "Обсудить результаты с экспертом и согласовать 2–3 измеримые цели",
                deadline: "После экспертной проверки",
                success:
                  "Для каждой цели определены действие, срок и показатель результата",
              },
            ],
          }),
        },
      });
  }
  if (n % 10 === 0) console.log(`Demo participants: ${n + 1}/65`);
}
for (const [i, action] of [
  "campaign.created",
  "tests.assigned",
  "attempt.completed",
  "report.approved",
  "demo.initialized",
].entries())
  await db.auditLog.create({
    data: {
      organizationId: org.id,
      actorId: "admin",
      action,
      createdAt: new Date(Date.now() - (4 - i) * 3600000),
    },
  });
console.log(
  "Demo ready: admin / expert / employee / owner @assessflow.local. Password: AssessFlow!2026 (local demo only).",
);
await db.$disconnect();
