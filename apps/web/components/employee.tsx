"use client";
export {TestRunner} from "./test-runner";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AssessmentComplete } from "./assessment-complete";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  BookOpen,
  ClipboardList,
  Brain,
  Calculator,
  Shapes,
  Heart,
  Compass,
  MessageSquare,
  CalendarDays,
} from "lucide-react";
import {
  useApp,
  useData,
  post,
  Button,
  PageTitle,
  LoadState,
  Empty,
  Badge,
  Progress,
  Modal,
} from "./ui";
const icons: Record<string, typeof Brain> = {
  verbal: MessageSquare,
  numerical: Calculator,
  logical: Shapes,
  personality: Brain,
  motivation: Heart,
  situations: Compass,
};
const formatCountdown = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
};
export function EmployeeHome({ catalog = false }: { catalog?: boolean }) {
  const { t, loc, locale, me, campaign, campaigns, setCampaign, reload } = useApp(),
    router = useRouter();
  const { data, loading, error, refreshSilently } = useData<any[]>(
    campaign ? `/my/assignments?campaignId=${campaign}` : null,
  );
  const [clockNow, setClockNow] = useState(() => Date.now());
  const assignmentsRefresh=useRef(refreshSilently);
  useEffect(()=>{assignmentsRefresh.current=refreshSilently},[refreshSilently]);
  const hasRunning=Boolean(data?.some(a=>a.attempts[0]?.status==='in_progress'));
  useEffect(()=>{if(!hasRunning)return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void assignmentsRefresh.current()},5000);return()=>window.clearInterval(timer)},[hasRunning]);
  const latestAssignments = new Map<string, any>();
  for (const assignment of data || []) {
    const key = `${assignment.campaignId}:${assignment.testVersion.testId}`;
    const current = latestAssignments.get(key);
    if (
      !current ||
      new Date(assignment.createdAt).getTime() >=
        new Date(current.createdAt).getTime()
    ) {
      latestAssignments.set(key, assignment);
    }
  }
  const visibleAssignments = Array.from(latestAssignments.values());
  useEffect(() => {
    if (!data?.some((assignment) => assignment.attempts[0]?.status === "in_progress"))
      return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data]);
  const [selected, setSelected] = useState<any>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [startError, setStartError] = useState("");
  const completed = visibleAssignments.filter(
    (a) => a.attempts[0]?.status === "completed",
  ).length;
  const allDone = visibleAssignments.length > 0 && completed === visibleAssignments.length;
  const begin = async () => {
    setBusy(true);
    setStartError("");
    try {
      if (!me.member.consentAt) {
        await post("/me/consent", { accepted: consent });
        await reload();
      }
      const a = await post(`/assignments/${selected.id}/start`, {
        language: locale,
      });
      router.push(`/test/${a.id}`);
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {catalog ? (
        <PageTitle
          title={t("Мои тестирования", "Менің тесттерім")}
          description={t(
            "Проходите направления в удобном порядке.",
            "Бағыттарды ыңғайлы ретпен өтіңіз.",
          )}
        />
      ) : (
        <div className="page-title mobile-employee-greeting">
          <div>
            <h1>
              {t(
                `Здравствуйте, ${me.user.name.split(" ")[0]}`,
                `Сәлеметсіз бе, ${me.user.name.split(" ")[0]}`,
              )}
            </h1>
            <p>{`${me.member.position} · ${me.organization.name}`}</p>
          </div>
        </div>
      )}
      {!catalog && (
        <div className="campaign-switch mobile-campaign employee-campaign-switch">
          <CalendarDays size={16} aria-hidden="true" />
          <span>{t("Кампания", "Науқан")}</span>
          <select
            aria-label={t("Кампания оценки", "Бағалау науқаны")}
            value={campaign}
            onChange={(event) => setCampaign(event.target.value)}
          >
            {campaigns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <LoadState loading={loading} error={error}>
        {allDone ? <AssessmentComplete /> : <>
        {!catalog && (
          <div className="welcome-banner">
            <div>
              <div className="eyebrow">
                {t("ВАШ ПУТЬ РАЗВИТИЯ", "СІЗДІҢ ДАМУ ЖОЛЫҢЫЗ")}
              </div>
              <h2>
                {t(
                  "Каждый шаг — больше понимания себя",
                  "Әр қадам — өзіңізді жақсырақ түсіну",
                )}
              </h2>
              <p>
                {t(
                  "Ответы сохраняются автоматически. Между тестами можно сделать перерыв.",
                  "Жауаптар автоматты сақталады. Тесттер арасында үзіліс жасауға болады.",
                )}
              </p>
              <Progress
                value={
                  visibleAssignments.length
                    ? (completed / visibleAssignments.length) * 100
                    : 0
                }
              />
            </div>
            <div className="welcome-counter">
              <strong>
                {completed}
                <span style={{ fontSize: 19, color: "#819aa9" }}>
                  {" "}
                  / {visibleAssignments.length}
                </span>
              </strong>
              <small>{t("направлений пройдено", "бағыт аяқталды")}</small>
            </div>
          </div>
        )}
        <div className="test-grid">
          {visibleAssignments.map((a) => {
            const v = a.testVersion,
              attempt = a.attempts[0],
              questionCount = v.delivery?.questionCount ?? v._count.questions,
              remainingSeconds =
                attempt?.status === "in_progress" && attempt.expiresAt
                  ? Math.max(
                      0,
                      Math.ceil(
                        (new Date(attempt.expiresAt).getTime() - (attempt.pausedAt?new Date(attempt.pausedAt).getTime():clockNow)) /
                          1000,
                      ),
                    )
                  : null,
              timedOut =
                attempt?.status === "expired",
              status = timedOut
                ? "expired"
                : attempt?.status || "not_started",
              canResume = status === "in_progress",
              Icon = icons[v.test.direction] || BookOpen;
            return (
              <div className="test-card" key={a.id}>
                <div className="test-card-top">
                  <div className="test-icon">
                    <Icon size={22} />
                  </div>
                  <Badge status={status}>
                    {timedOut
                      ? t("Время вышло", "Уақыт аяқталды")
                      : undefined}
                  </Badge>
                </div>
                <div>
                  <h3>{loc(v.test.name)}</h3>
                  <p style={{ marginTop: 9 }}>{loc(v.test.description)}</p>
                </div>
                <div className="test-meta">
                  <span>
                    <ClipboardList size={13} />
                    {questionCount} {t("заданий", "тапсырма")}
                  </span>
                  <span>
                    <Clock3 size={13} />
                    {status === "completed"
                      ? t("Завершён", "Аяқталды")
                      : timedOut
                        ? t("Начните заново", "Қайта бастаңыз")
                    : canResume && remainingSeconds !== null
                          ? t(
                              `${attempt.pausedAt?'Пауза · ':''}Осталось ${formatCountdown(remainingSeconds)}`,
                              `${attempt.pausedAt?'Үзіліс · ':''}Қалды ${formatCountdown(remainingSeconds)}`,
                            )
                          : t(
                              v.timeLimitSeconds ? `Лимит: ${formatCountdown(v.timeLimitSeconds)}` : `Около ${v.durationMinutes} мин · без таймера`,
                              v.timeLimitSeconds ? `Уақыт: ${formatCountdown(v.timeLimitSeconds)}` : `Шамамен ${v.durationMinutes} мин · таймерсіз`,
                            )}
                  </span>
                </div>
                {attempt && !timedOut && (
                  <Progress
                    value={
                      attempt.status === "completed"
                        ? 100
                        : (attempt._count.answers / v._count.questions) * 100
                    }
                    small
                  />
                )}
                <Button
                  variant={status === "completed" ? "secondary" : "primary"}
                  disabled={status === "completed"}
                  onClick={() => {
                    setSelected(a);
                    setStartError("");
                  }}
                >
                  {status === "completed"
                    ? t("Завершено", "Аяқталды")
                    : canResume
                      ? t("Продолжить", "Жалғастыру")
                      : timedOut
                        ? t("Начать заново", "Қайта бастау")
                        : t("Начать тест", "Тестті бастау")}
                  {status === "completed" ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <ArrowRight size={15} />
                  )}
                </Button>
              </div>
            );
          })}
        </div>
        {!visibleAssignments.length && (
          <Empty
            title={t("Тесты пока не назначены", "Тесттер әлі тағайындалмады")}
            description={t(
              "После назначения администратором они появятся здесь.",
              "Әкімші тағайындағаннан кейін олар осында пайда болады.",
            )}
          />
        )}
        </>}
      </LoadState>
      {selected && (
        <Modal
          title={loc(selected.testVersion.test.name)}
          onClose={() => setSelected(null)}
          className="test-start-modal"
        >
          <div className="modal-body form-stack">
            <p className="text-small text-muted">
              {t(
                selected.testVersion.timeLimitSeconds ? `На тест отводится ${selected.testVersion.timeLimitSeconds / 60} минут. Сначала — инструкция и тренировка. При выходе время продолжает идти; при потере связи — пауза.` : `Время не ограничено. Обычно требуется ${selected.testVersion.durationMinutes} минут. Можно сделать перерыв и продолжить позже.`,
                selected.testVersion.timeLimitSeconds ? `Тестке ${selected.testVersion.timeLimitSeconds / 60} минут беріледі. Алдымен нұсқаулық пен жаттығу. Шыққанда уақыт жүреді, байланыс үзілгенде тоқтайды.` : `Уақыт шектелмеген. Әдетте ${selected.testVersion.durationMinutes} минут қажет. Үзіліс жасап, кейін жалғастыруға болады.`,
              )}
            </p>
            {!me.member.consentAt && (
              <label className="row align-start">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span className="text-small">
                  {t(
                    "Я согласен на обработку результатов оценки моей организацией и подготовку предварительного AI-анализа обезличенных показателей.",
                    "Ұйымымның бағалау нәтижелерін өңдеуіне және иесіздендірілген көрсеткіштер бойынша алдын ала AI-талдау дайындауына келісемін.",
                  )}
                </span>
              </label>
            )}
            {startError && <div className="notice error">{startError}</div>}
            <Button
              busy={busy}
              disabled={!me.member.consentAt && !consent}
              onClick={begin}
            >
              {selected.attempts[0]?.status === "in_progress" &&
              selected.attempts[0]?.expiresAt &&
              new Date(selected.attempts[0].expiresAt).getTime() > clockNow
                ? t("Продолжить тест", "Тесті жалғастыру")
                : t("Начать тест", "Тестті бастау")}
              <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
