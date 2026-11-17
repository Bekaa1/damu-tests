import { createHash } from "node:crypto";
import { db, audit, json } from "./db";
import { type Context } from "./access";
import {
  generatedContentSchema,
  reportMetrics,
  reportLoc,
  type GeneratedContent,
  type ReportSnapshot,
} from "../../../packages/core/reporting";
// A data-based report remains available if the language-model provider is unavailable.
// No assessor score or observation is fabricated by this fallback.
export function fallbackReport(
  snapshot: ReportSnapshot,
  language: "ru" | "kk",
): GeneratedContent {
  const t = (ru: string, kk: string) => (language === "ru" ? ru : kk);
  const metrics = reportMetrics(snapshot, language).filter(
    (m) => m.testId !== "personality" || m.scale.length === 1,
  );
  const evidenceIds = metrics.map((m) => m.id).slice(0, 5);
  if (!evidenceIds.length)
    evidenceIds.push(
      ...snapshot.people
        .flatMap((p) =>
          p.results
            .map((r) => r.resultId)
            .filter((v): v is string => Boolean(v)),
        )
        .slice(0, 5),
    );
  const statement = (text: string) => ({ text, evidenceIds });
  const actions = [
    [
      t("Анализ решений", "Шешімдерді талдау"),
      t(
        "Перед важным решением запишите факты, два варианта действий, риски и критерий выбора. Раз в неделю разберите одно принятое решение с руководителем.",
        "Маңызды шешім алдында фактілерді, екі әрекет нұсқасын, тәуекелдерді және таңдау критерийін жазыңыз. Аптасына бір рет қабылданған шешімді басшымен талқылаңыз.",
      ),
      t("Разбор рабочих задач", "Жұмыс міндеттерін талдау"),
      t("4 недели", "4 апта"),
      t(
        "Четыре решения с письменным обоснованием и оценкой результата",
        "Жазбаша негіздемесі мен нәтижесі бағаланған төрт шешім",
      ),
    ],
    [
      t("Управление исполнением", "Орындалуды басқару"),
      t(
        "Для одной текущей задачи согласуйте результат, срок, ответственного и промежуточную проверку. На еженедельной встрече фиксируйте факт выполнения и препятствия.",
        "Бір ағымдағы міндет үшін нәтижені, мерзімді, жауаптыны және аралық тексеруді келісіңіз. Апталық кездесуде орындалу фактісі мен кедергілерді тіркеңіз.",
      ),
      t("Практика на рабочем месте", "Жұмыс орнындағы тәжірибе"),
      t("30 дней", "30 күн"),
      t(
        "У каждой задачи есть ответственный, срок и зафиксированный итог",
        "Әр міндеттің жауаптысы, мерзімі және тіркелген нәтижесі бар",
      ),
    ],
    [
      t("Обратная связь", "Кері байланыс"),
      t(
        "Проведите три беседы с сотрудниками по схеме: конкретное действие, его результат, согласованный следующий шаг. Запишите договорённости и проверьте их выполнение.",
        "Қызметкерлермен нақты әрекет, оның нәтижесі, келісілген келесі қадам үлгісі бойынша үш әңгіме өткізіңіз. Келісімдерді жазып, орындалуын тексеріңіз.",
      ),
      t("Беседы и саморефлексия", "Әңгімелер және өзіндік рефлексия"),
      t("6 недель", "6 апта"),
      t(
        "Три беседы с конкретными договорённостями и проверкой прогресса",
        "Нақты келісімдер және ілгерілеуді тексеру бар үш әңгіме",
      ),
    ],
  ];
  const measured = metrics
    .filter((m) => ["verbal", "numerical", "logical"].includes(m.testId))
    .sort((a, b) => a.mean / a.max - b.mean / b.max);
  if (measured[0]) {
    const m = measured[0];
    actions[0][0] = m.name;
    actions[0][1] =
      `${t("Текущий результат", "Ағымдағы нәтиже")}: ${m.mean.toFixed(2)} / ${m.max}. ` +
      actions[0][1];
  }
  const competencyGaps = snapshot.people.flatMap((p) => {
    const profile = p.competencyProfile,
      role = profile?.model.content.roles.find(
        (r: any) => r.id === profile.consensus?.scores?.roleId,
      );
    return (profile?.consensus?.scores?.ratings || [])
      .filter(
        (r: any) =>
          typeof r.value === "number" &&
          role?.targets[r.competencyId] > r.value,
      )
      .map((r: any) => ({
        name: reportLoc(
          profile.model.content.competencies.find(
            (c: any) => c.id === r.competencyId,
          )?.name,
          language,
        ),
        value: r.value,
        target: role.targets[r.competencyId],
      }));
  });
  if (competencyGaps[0]) {
    const gap = competencyGaps[0];
    actions[1][0] = gap.name;
    actions[1][1] =
      `${t("Экспертная оценка", "Сарапшы бағасы")}: ${gap.value}/5; ${t("целевой уровень", "мақсатты деңгей")}: ${gap.target}/5. ` +
      actions[1][1];
  }
  const rows = (ids: string[]) =>
    metrics
      .filter((m) => ids.includes(m.testId))
      .slice(0, 6)
      .map((m) => ({
        text: `${m.name}: ${m.mean.toFixed(2)} / ${m.max}. ${t("Диапазон шкалы", "Шкала ауқымы")}: ${m.min}–${m.max}.`,
        evidenceIds: [m.id],
      }));
  return generatedContentSchema.parse({
    summary: [
      statement(
        t(
          "Отчёт объединяет завершённые результаты участника. Числовые показатели представлены по каждой методике; оценки компетенций и примеры поведения приведены по сохранённым данным экспертов.",
          "Есеп қатысушының аяқталған нәтижелерін біріктіреді. Сандық көрсеткіштер әр әдістеме бойынша көрсетілген; құзырет бағалары мен мінез-құлық мысалдары сарапшылар сақтаған деректерге негізделген.",
        ),
      ),
    ],
    analytical: rows(["verbal", "numerical", "logical"]),
    personality: rows(["personality"]),
    motivation: rows(["motivation"]),
    management: rows(["situations", "sjt"]),
    competencies: [],
    potential: [],
    strengths: [],
    development: [],
    risks: [],
    recommendations: actions.map((a) => statement(`${a[0]}. ${a[1]}`)),
    developmentPlan: actions.map((a) => ({
      focus: a[0],
      action: a[1],
      format: a[2],
      timeframe: a[3],
      success: a[4],
      evidenceIds,
    })),
    limitations: [],
  });
}
const rendering = new Map<string, Promise<void>>();
export async function persistReportPdf(
  id: string,
  content: GeneratedContent,
  mode = "ai",
) {
  if (rendering.has(id)) return rendering.get(id);
  const task = (async () => {
    const report = await db.generatedReport.findUniqueOrThrow({
      where: { id },
    });
    if (report.readyAt) return;
    const { professionalReportTemplate, reportCss } =
      await import("./report-layout");
    const { renderPdf } = await import("./exports");
    const rendered = professionalReportTemplate(
      report.snapshot as unknown as ReportSnapshot,
      content,
      {
        kind: report.kind as "individual" | "team",
        language: report.language as "ru" | "kk",
        createdAt: report.createdAt,
      },
    );
    const bytes = await renderPdf(
      rendered.html,
      rendered.label,
      report.language,
      reportCss,
    );
    const readyAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM generated_reports WHERE id = ${id} FOR UPDATE`;
      const current = await tx.generatedReport.findUniqueOrThrow({
        where: { id },
      });
      if (current.readyAt) return;
      await tx.reportArtifact.create({
        data: {
          reportId: id,
          bytes: new Uint8Array(bytes),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      });
      await tx.generatedReport.update({
        where: { id },
        data: {
          status: "completed",
          content: json(content),
          readyAt,
          generationMode: mode,
          error: null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: report.organizationId,
          actorId: null,
          action: "report.available",
          entityId: id,
          detail: json({
            completedAt: report.assessmentCompletedAt,
            readyAt,
            elapsedMs: report.assessmentCompletedAt
              ? readyAt.getTime() - report.assessmentCompletedAt.getTime()
              : null,
            mode,
            bytes: bytes.length,
          }),
        },
      });
    });
  })();
  rendering.set(id, task);
  try {
    await task;
  } finally {
    rendering.delete(id);
  }
}
export async function makeFallbackAvailable(id: string) {
  const report = await db.generatedReport.findUnique({ where: { id } });
  if (!report || report.readyAt) return;
  await persistReportPdf(
    id,
    fallbackReport(
      report.snapshot as unknown as ReportSnapshot,
      report.language as "ru" | "kk",
    ),
    "data",
  );
}
export async function queueCompletedAssessment(
  organizationId: string,
  campaignId: string,
  membershipId: string,
) {
  const tasks = await db.testAssignment.findMany({
    where: { organizationId, campaignId, membershipId },
    include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } },
  });
  if (!tasks.length || tasks.some((t) => t.attempts[0]?.status !== "completed"))
    return;
  const member = await db.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: { organization: true, user: true },
  });
  if (!member) return;
  const ctx: Context = {
    org: member.organization,
    user: member.user,
    member,
    role: "admin",
  };
  const { createGeneratedReport } = await import("./generated-reports");
  await createGeneratedReport(
    ctx,
    {
      campaignId,
      membershipId,
      kind: "individual",
      language: member.user.locale === "kk" ? "kk" : "ru",
    },
    true,
  );
}
export function startReportWatchdog() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      // Recovery after a process restart or a queue/provider outage. Leave 60s for PDF rendering.
      const stuck = await db.generatedReport.findMany({
        where: {
          readyAt: null,
          createdAt: { lte: new Date(Date.now() - 210000) },
        },
        select: { id: true },
        take: 20,
      });
      await Promise.allSettled(stuck.map((r) => makeFallbackAvailable(r.id)));
      // The completion audit is committed with the score. Recover a trigger lost
      // between that commit and enqueueing (for example during an API restart).
      const recent = await db.auditLog.findMany({
        where: {
          action: "attempt.completed",
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { entityId: true },
      });
      const attempts = await db.testAttempt.findMany({
        where: {
          id: { in: recent.flatMap((r) => (r.entityId ? [r.entityId] : [])) },
        },
        include: { assignment: true },
      });
      const seen = new Set<string>();
      for (const a of attempts) {
        const t = a.assignment,
          key = `${t.organizationId}:${t.campaignId}:${t.membershipId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const report = await db.generatedReport.findFirst({
          where: {
            organizationId: t.organizationId,
            campaignId: t.campaignId,
            membershipId: t.membershipId,
            kind: "individual",
            createdAt: { gte: a.submittedAt ?? a.startedAt },
          },
          select: { id: true },
        });
        if (!report)
          await queueCompletedAssessment(
            t.organizationId,
            t.campaignId,
            t.membershipId,
          ).catch(console.error);
      }
    } catch (e) {
      console.error("Report availability recovery", e);
    } finally {
      busy = false;
    }
  }, 10000);
  timer.unref();
  return timer;
}
