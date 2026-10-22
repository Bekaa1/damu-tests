"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  BookOpen,
  ClipboardList,
  ShieldCheck,
  Info,
  Save,
  Download,
  Brain,
  Calculator,
  Shapes,
  Heart,
  Compass,
  MessageSquare,
  CalendarDays,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import {
  useApp,
  useData,
  post,
  download,
  Button,
  PageTitle,
  Panel,
  LoadState,
  Empty,
  Badge,
  Progress,
  Modal,
  Field,
} from "./ui";
const icons: Record<string, typeof Brain> = {
  verbal: MessageSquare,
  numerical: Calculator,
  logical: Shapes,
  personality: Brain,
  motivation: Heart,
  situations: Compass,
};
function ProfileScaleRows({
  scales,
  loc,
}: {
  scales: [string, any][];
  loc: (value: any) => string;
}) {
  return (
    <div className="score-profile-scales">
      {scales.map(([id, scale]) => {
        const min = Number(scale.min ?? 1);
        const max = Number(scale.max ?? 5);
        const mean = Number(scale.mean);
        const width =
          Number.isFinite(mean) && max > min
            ? Math.max(0, Math.min(100, ((mean - min) / (max - min)) * 100))
            : 0;
        return (
          <div className="score-profile-item" key={id}>
            <span className="score-profile-name">{loc(scale.name)}</span>
            <div className="score-profile-track" aria-hidden="true">
              <span style={{ width: `${width}%` }} />
            </div>
            <strong className="score-profile-value">
              {Number.isFinite(mean) ? mean.toFixed(2) : String.fromCharCode(8212)} / {max}
            </strong>
          </div>
        );
      })}
    </div>
  );
}
export function EmployeeHome({ catalog = false }: { catalog?: boolean }) {
  const { t, loc, locale, me, campaign, campaigns, setCampaign, reload, notify } = useApp(),
    router = useRouter();
  const { data, loading, error } = useData<any[]>(
    campaign ? `/my/assignments?campaignId=${campaign}` : null,
  );
  const [selected, setSelected] = useState<any>(null),
    [language, setLanguage] = useState(locale),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [startError, setStartError] = useState("");
  const completed = (data || []).filter(
    (a) => a.attempts[0]?.status === "completed",
  ).length;
  const begin = async () => {
    setBusy(true);
    setStartError("");
    try {
      if (!me.member.consentAt) {
        await post("/me/consent", { accepted: consent });
        await reload();
      }
      const a = await post(`/assignments/${selected.id}/start`, { language });
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
                value={data?.length ? (completed / data.length) * 100 : 0}
              />
            </div>
            <div className="welcome-counter">
              <strong>
                {completed}
                <span style={{ fontSize: 19, color: "#819aa9" }}>
                  {" "}
                  / {data?.length || 0}
                </span>
              </strong>
              <small>{t("направлений пройдено", "бағыт аяқталды")}</small>
            </div>
          </div>
        )}
        {data?.length && completed === data.length ? (
          <div className="notice success" style={{ marginBottom: 24 }}>
            <CheckCircle2 size={19} />
            <div>
              <strong>
                {t(
                  "Все назначенные тесты завершены",
                  "Барлық тағайындалған тесттер аяқталды",
                )}
              </strong>
              <p>
                {t(
                  "Результаты сохранены и доступны для экспертной проверки.",
                  "Нәтижелер сақталды және сараптамалық тексеруге дайын.",
                )}
              </p>
              <Link href="/my-results" className="text-link">
                {t("Перейти к результатам", "Нәтижелерге өту")}
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        ) : null}
        <div className="test-grid">
          {(data || []).map((a) => {
            const v = a.testVersion,
              attempt = a.attempts[0],
              status = attempt?.status || "not_started",
              Icon = icons[v.test.direction] || BookOpen;
            return (
              <div className="test-card" key={a.id}>
                <div className="test-card-top">
                  <div className="test-icon">
                    <Icon size={22} />
                  </div>
                  <Badge status={status} />
                </div>
                <div>
                  <h3>{loc(v.test.name)}</h3>
                  <p style={{ marginTop: 9 }}>{loc(v.test.description)}</p>
                </div>
                <div className="test-meta">
                  <span>
                    <ClipboardList size={13} />
                    {v._count.questions} {t("заданий", "тапсырма")}
                  </span>
                  <span>
                    <Clock3 size={13} />
                    {v.durationMinutes} {t("мин", "мин")}
                  </span>
                </div>
                {attempt && (
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
                    setLanguage(locale);
                  }}
                >
                  {status === "completed"
                    ? t("Завершено", "Аяқталды")
                    : attempt
                      ? t("Продолжить", "Жалғастыру")
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
        {!data?.length && (
          <Empty
            title={t("Тесты пока не назначены", "Тесттер әлі тағайындалмады")}
            description={t(
              "После назначения администратором они появятся здесь.",
              "Әкімші тағайындағаннан кейін олар осында пайда болады.",
            )}
          />
        )}
      </LoadState>
      {selected && (
        <Modal
          title={loc(selected.testVersion.test.name)}
          onClose={() => setSelected(null)}
          className="test-start-modal"
        >
          <div className="modal-body form-stack">
            {!selected.attempts.length && (
              <Field label={t("Язык тестирования", "Тестілеу тілі")}>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as any)}
                >
                  <option value="ru">Русский</option>
                  <option value="kk">Қазақша</option>
                </select>
              </Field>
            )}
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
              {t("Перейти к заданиям", "Тапсырмаларға өту")}
              <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function TestRunner({ id }: { id: string }) {
  const { t, notify } = useApp(),
    router = useRouter();
  const { data, loading, error } = useData<any>(`/attempts/${id}`);
  const [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<Record<string, any>>({}),
    [revisions, setRevisions] = useState<Record<string, number>>({}),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [pending, setPending] = useState(false),
    [confirm, setConfirm] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [done, setDone] = useState(false),
    [autoAdvance, setAutoAdvance] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionsRef = useRef<Record<string, number>>({});
  const pendingRef = useRef(false);
  useEffect(() => {
    if (data) {
      const a = Object.fromEntries(
        data.answers.map((a: any) => [a.questionId, a.value]),
      );
      const r = Object.fromEntries(
        data.answers.map((a: any) => [a.questionId, a.revision]),
      );
      setAnswers(a);
      setRevisions(r);
      revisionsRef.current = r;
      setIndex(
        Math.max(
          0,
          data.questions.findIndex((q: any) => a[q.id] === undefined),
        ),
      );
      setDone(data.status === "completed");
    }
  }, [data]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (pendingRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("beforeunload", before);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);
  const q = data?.questions[index];
  const loc = (x: any) => x?.[data?.language] || x?.ru || "";
  const persist = async (questionId: string, value: unknown) => {
    setSaving(true);
    setSaveError("");
    try {
      const r = await post(`/attempts/${id}/answers`, {
        questionId,
        value,
        revision: revisionsRef.current[questionId] || 0,
      });
      revisionsRef.current = {
        ...revisionsRef.current,
        [questionId]: r.revision,
      };
      setRevisions(revisionsRef.current);
      setPending(false);
      pendingRef.current = false;
      if (
        autoAdvance &&
        data.questions[index]?.type === "scale" &&
        index < data.questions.length - 1
      )
        setIndex((i) => i + 1);
    } catch (e) {
      setSaveError((e as Error).message);
      setPending(true);
      pendingRef.current = true;
    } finally {
      setSaving(false);
    }
  };
  const choose = (value: any) => {
    if (saving) return;
    setAnswers((prev) => ({ ...prev, [q.id]: value }));
    setPending(true);
    pendingRef.current = true;
    if (q.type === "sjt" && (!value.most || !value.least)) return;
    void persist(q.id, value);
  };
  const numeric = (value: string) => {
    setAnswers((prev) => ({ ...prev, [q.id]: value }));
    setPending(true);
    pendingRef.current = true;
    setSaveError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (value.trim())
      saveTimer.current = setTimeout(() => void persist(q.id, value), 700);
  };
  if (done)
    return (
      <Panel>
        <Empty
          icon={<CheckCircle2 size={30} />}
          title={t("Тестирование завершено", "Тестілеу аяқталды")}
          description={t(
            "Ответы сохранены, баллы рассчитаны. Вы можете перейти к следующему направлению.",
            "Жауаптар сақталды, балдар есептелді. Келесі бағытқа өтуіңізге болады.",
          )}
          action={
            <Button onClick={() => router.push("/cabinet")}>
              {t("К моим тестам", "Менің тесттеріме")}
              <ArrowRight size={16} />
            </Button>
          }
        />
      </Panel>
    );
  return (
    <LoadState loading={loading} error={error}>
      <div className="test-workspace">
        {data && q && (
          <>
            <div className="test-topline">
              <Link
                href="/cabinet"
                onClick={(e) => {
                  if (pending || saving) {
                    e.preventDefault();
                    notify(
                      t(
                        "Дождитесь сохранения ответа",
                        "Жауаптың сақталуын күтіңіз",
                      ),
                      "error",
                    );
                  }
                }}
                className="text-link"
              >
                <ArrowLeft size={14} />
                {t("Мои тесты", "Менің тесттерім")}
              </Link>
              <h2>{loc(data.name)}</h2>
              <span className="save-status">
                <ShieldCheck size={14} />
                {t("Автосохранение", "Автоматты сақтау")}
              </span>
            </div>
            <div className="test-progress">
              <Progress
                value={
                  (Object.keys(revisions).length / data.questions.length) * 100
                }
              />
              <span>
                {Object.keys(revisions).length} / {data.questions.length}{" "}
                {t("сохранено", "сақталды")}
              </span>
            </div>
            <Panel>
              <div className="question-panel">
                <div className="question-number" aria-live="polite">
                  {t("ВОПРОС", "СҰРАҚ")} {index + 1} {t("ИЗ", "/")}{" "}
                  {data.questions.length}
                </div>
                <h1 className="question-text">{loc(q.text)}</h1>
                {q.imageUrl && (
                  <img
                    src={q.imageUrl}
                    alt={t(
                      "Графическая матрица с отсутствующим последним элементом",
                      "Соңғы элементі жоқ графикалық матрица",
                    )}
                    className="matrix-question"
                  />
                )}
                {(q.type === "single" || q.type === "image") && (
                  <div
                    className={
                      q.type === "image" ? "image-options" : "answer-options"
                    }
                  >
                    {q.options.map((o: any, i: number) => (
                      <button
                        disabled={saving}
                        key={o.id}
                        className={`answer-option ${answers[q.id] === o.id ? "selected" : ""}`}
                        onClick={() => choose(o.id)}
                        aria-pressed={answers[q.id] === o.id}
                      >
                        {o.imageUrl ? (
                          <img src={o.imageUrl} alt={loc(o.text)} />
                        ) : (
                          <span className="option-letter">
                            {"ABCDEFGHIJ"[i]}
                          </span>
                        )}
                        <span>{loc(o.text)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {q.type === "number" && (
                  <div className="numeric-answer">
                    <Field
                      label={t("Ваш ответ", "Сіздің жауабыңыз")}
                      hint={t(
                        "Введите число без знака %.",
                        "% белгісінсіз сан енгізіңіз.",
                      )}
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={t("Числовой ответ", "Сандық жауап")}
                        value={answers[q.id] ?? ""}
                        disabled={saving}
                        onChange={(e) => numeric(e.target.value)}
                      />
                    </Field>
                  </div>
                )}
                {q.type === "scale" && (
                  <>
                    <label
                      className="row text-small text-muted"
                      style={{ marginBottom: 18 }}
                    >
                      <input
                        type="checkbox"
                        checked={autoAdvance}
                        onChange={(e) => setAutoAdvance(e.target.checked)}
                      />
                      {t(
                        "Переходить дальше после сохранения ответа",
                        "Жауап сақталғаннан кейін келесі сұраққа өту",
                      )}
                    </label>
                    <div
                      className={`scale-options ${data.responseScale.max === 5 ? "five" : ""}`}
                    >
                      {Array.from(
                        { length: data.responseScale.max },
                        (_, i) => i + 1,
                      ).map((n) => (
                        <button
                          key={n}
                          disabled={saving}
                          className={answers[q.id] === n ? "selected" : ""}
                          aria-pressed={answers[q.id] === n}
                          onClick={() => choose(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className="scale-legend">
                      <span>
                        {t("Совершенно не согласен", "Мүлдем келіспеймін")}
                      </span>
                      <span>{t("Полностью согласен", "Толық келісемін")}</span>
                    </div>
                  </>
                )}
                {q.type === "sjt" && (
                  <div className="answer-options">
                    <div className="sjt-head">
                      <span />
                      <span>
                        MOST
                        <br />
                        {t("Скорее да", "Ең ықтимал")}
                      </span>
                      <span>
                        LEAST
                        <br />
                        {t("Скорее нет", "Аз ықтимал")}
                      </span>
                    </div>
                    {q.options.map((o: any, i: number) => (
                      <div className="sjt-option" key={o.id}>
                        <span>
                          <b style={{ color: "#8a9da6", marginRight: 9 }}>
                            {"ABCD"[i]}
                          </b>
                          {loc(o.text)}
                        </span>
                        {["most", "least"].map((kind) => (
                          <label key={kind}>
                            <input
                              type="radio"
                              name={`${q.id}-${kind}`}
                              aria-label={`${kind.toUpperCase()}: ${loc(o.text)}`}
                              checked={answers[q.id]?.[kind] === o.id}
                              disabled={
                                saving ||
                                answers[q.id]?.[
                                  kind === "most" ? "least" : "most"
                                ] === o.id
                              }
                              onChange={() =>
                                choose({ ...answers[q.id], [kind]: o.id })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {saveError && (
                  <div className="notice error mt">
                    <div>
                      {saveError}
                      <button
                        className="text-link"
                        style={{ display: "block", marginTop: 8 }}
                        disabled={saving}
                        onClick={() => persist(q.id, answers[q.id])}
                      >
                        {t("Повторить сохранение", "Сақтауды қайталау")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="question-footer">
                <Button
                  variant="secondary"
                  disabled={index === 0 || saving || pending}
                  onClick={() => setIndex((i) => i - 1)}
                >
                  <ArrowLeft size={14} />
                  {t("Назад", "Артқа")}
                </Button>
                <span className="save-status">
                  {saving ? <Clock3 size={14} /> : <CheckCircle2 size={14} />}{" "}
                  {saving
                    ? t("Сохраняем…", "Сақталуда…")
                    : pending
                      ? t("Ожидает сохранения", "Сақталуын күтуде")
                      : t(
                          "Все изменения сохранены",
                          "Барлық өзгерістер сақталды",
                        )}
                </span>
                {index === data.questions.length - 1 ? (
                  <Button
                    disabled={saving || pending}
                    onClick={() => setConfirm(true)}
                  >
                    {t("Завершить тест", "Тестті аяқтау")}
                    <CheckCircle2 size={15} />
                  </Button>
                ) : (
                  <Button
                    disabled={saving || pending || !revisions[q.id]}
                    onClick={() => setIndex((i) => i + 1)}
                  >
                    {t("Следующий вопрос", "Келесі сұрақ")}
                    <ArrowRight size={15} />
                  </Button>
                )}
              </div>
            </Panel>
            <div
              className="question-dots"
              aria-label={t(
                "Навигация по вопросам",
                "Сұрақтар бойынша навигация",
              )}
            >
              {data.questions.map((q: any, i: number) => (
                <button
                  key={q.id}
                  disabled={saving || pending}
                  className={`${revisions[q.id] ? "done" : ""} ${i === index ? "current" : ""}`}
                  onClick={() => setIndex(i)}
                  aria-label={`${t("Вопрос", "Сұрақ")} ${i + 1}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </>
        )}
        {confirm && (
          <Modal
            title={t("Завершить тестирование?", "Тестілеуді аяқтайсыз ба?")}
            onClose={() => setConfirm(false)}
            className="test-finish-modal"
          >
            <div className="modal-body form-stack">
              <p>
                {t(
                  `Сохранено ответов: ${Object.keys(revisions).length} из ${data.questions.length}. После завершения изменить ответы нельзя.`,
                  `${data.questions.length} жауаптың ${Object.keys(revisions).length}-і сақталған. Аяқтағаннан кейін жауаптарды өзгерту мүмкін емес.`,
                )}
              </p>
              {Object.keys(revisions).length < data.questions.length ? (
                <Button
                  onClick={() => {
                    setIndex(
                      data.questions.findIndex((q: any) => !revisions[q.id]),
                    );
                    setConfirm(false);
                  }}
                >
                  {t(
                    "Перейти к пропущенному вопросу",
                    "Өткізілген сұраққа өту",
                  )}
                </Button>
              ) : (
                <Button
                  busy={submitting}
                  onClick={async () => {
                    setSubmitting(true);
                    try {
                      await post(`/attempts/${id}/submit`);
                      setDone(true);
                      setConfirm(false);
                    } catch (e) {
                      notify((e as Error).message, "error");
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  {t("Подтвердить завершение", "Аяқтауды растау")}
                </Button>
              )}
            </div>
          </Modal>
        )}
      </div>
    </LoadState>
  );
}
export function MyResults() {
  const { t, me, campaign, campaigns, setCampaign, loc, notify } = useApp();
  const { data, loading, error, refreshSilently } = useData<any>(
    campaign ? `/people/${me.member.id}?campaignId=${campaign}` : null,
  );
  const [aiBusy, setAiBusy] = useState(false);
  const aiRefreshRef = useRef(refreshSilently);
  const completedAi = data?.ai?.find((report: any) => report.status === "completed");
  const latestAi = data?.ai?.[0];
  const aiInProgress = Boolean(
    data?.ai?.some((report: any) => ["pending", "processing"].includes(report.status)),
  );
  useEffect(() => {
    aiRefreshRef.current = refreshSilently;
  }, [refreshSilently]);
  useEffect(() => {
    if (!aiInProgress) return;
    const timer = window.setInterval(() => aiRefreshRef.current(), 2500);
    return () => window.clearInterval(timer);
  }, [aiInProgress]);
  return (
    <>
      <PageTitle
        className="my-results-title"
        title={t("Мои результаты", "Менің нәтижелерім")}
        description={t(
          "Результаты тестирования и экспертное заключение.",
          "Тестілеу нәтижелері мен сараптамалық қорытынды.",
        )}
      />
      <div className="campaign-switch mobile-campaign employee-campaign-switch">
        <CalendarDays size={16} aria-hidden="true" />
        <span>{t("\u041a\u0430\u043c\u043f\u0430\u043d\u0438\u044f", "\u041d\u0430\u0443\u049b\u0430\u043d")}</span>
        <select
          aria-label={t("\u041a\u0430\u043c\u043f\u0430\u043d\u0438\u044f \u043e\u0446\u0435\u043d\u043a\u0438", "\u0411\u0430\u0493\u0430\u043b\u0430\u0443 \u043d\u0430\u0443\u049b\u0430\u043d\u044b")}
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
      <LoadState loading={loading} error={error}>
        {!data?.allDone ? (
          <Panel>
            <Empty
              icon={<Clock3 size={28} />}
              title={t(
                "Завершите назначенные тесты",
                "Тағайындалған тесттерді аяқтаңыз",
              )}
              description={t(
                "Результаты появятся после завершения всех направлений, если это разрешено организацией.",
                "Ұйым рұқсат етсе, барлық бағыттар аяқталғаннан кейін нәтижелер көрсетіледі.",
              )}
              action={
                <Link href="/cabinet" className="btn primary">
                  {t("К тестированиям", "Тесттерге өту")}
                </Link>
              }
            />
          </Panel>
        ) : (
          <div className="stack">
            {data.reports?.length > 0 ? (
              <Panel title={t("Утверждённый отчёт", "Бекітілген есеп")}>
                <div className="panel-body">
                  <p className="report-text">
                    {data.reports[0].content.conclusion}
                  </p>
                  <Button
                    className="mt"
                    onClick={() =>
                      download(
                        `/reports/${data.reports[0].id}/pdf`,
                        "my-report.pdf",
                      ).catch((e) => notify(e.message, "error"))
                    }
                  >
                    <Download size={16} />
                    {t("Скачать PDF", "PDF жүктеу")}
                  </Button>
                </div>
              </Panel>
            ) : (
              <div className="notice">
                <ShieldCheck size={19} />
                {t(
                  "Экспертное заключение будет доступно после утверждения и открытия доступа администратором.",
                  "Сараптамалық қорытынды бекітіліп, әкімші рұқсат бергеннен кейін қолжетімді болады.",
                )}
              </div>
            )}
            {data.assignments?.length > 0 && (
              <details className="primary-results-collapse">
                <summary>
                  <span>{t("\u041f\u0435\u0440\u0432\u0438\u0447\u043d\u044b\u0435 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u044b", "\u0411\u0430\u0441\u0442\u0430\u043f\u049b\u044b \u043d\u04d9\u0442\u0438\u0436\u0435\u043b\u0435\u0440")}</span>
                  <ChevronDown className="primary-results-chevron" size={19} aria-hidden="true" />
                </summary>
              <Panel title={t("Первичные результаты", "Бастапқы нәтижелер")}>
                <div className="score-list">
                  {data.assignments.map((a: any) => {
                    const score = a.attempts[0]?.results[0]?.result;
                    const scales = score?.scales
                      ? (Object.entries(score.scales) as [string, any][])
                      : [];
                    const isPersonality = a.testVersion.testId === "personality";
                    const coreScales = isPersonality
                      ? scales.filter(([id]) => id.length === 1)
                      : scales;
                    const visibleScales = coreScales.length ? coreScales : scales;
                    const additionalScales = isPersonality
                      ? scales.filter(([id]) => id.length > 1)
                      : [];
                    return (
                      <div
                        key={a.id}
                        className={`score-row ${visibleScales.length ? "score-row-profile" : ""}`}
                      >
                        <span>{loc(a.testVersion.test.name)}</span>
                        {visibleScales.length ? (
                          <div className="score-profile-content">
                            <ProfileScaleRows scales={visibleScales} loc={loc} />
                            {additionalScales.length > 0 && (
                              <details className="score-profile-details">
                                <summary>
                                  {t("\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u0445\u0430\u0440\u0430\u043a\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043a\u0438", "\u049a\u043e\u0441\u044b\u043c\u0448\u0430 \u0441\u0438\u043f\u0430\u0442\u0442\u0430\u043c\u0430\u043b\u0430\u0440")}
                                  {" "}({additionalScales.length})
                                </summary>
                                <ProfileScaleRows scales={additionalScales} loc={loc} />
                              </details>
                            )}
                          </div>
                        ) : (
                          <>
                            <Progress value={score?.percent ?? 0} />
                            <strong>
                              {score?.total !== undefined
                                ? `${score.total} / ${score.maximum}`
                                : String.fromCharCode(8212)}
                            </strong>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>
              </details>
            )}
            {data.canSelfGenerateAi && completedAi ? (
              <Panel title={t("\u041f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0439 AI-\u0430\u043d\u0430\u043b\u0438\u0437", "\u0410\u043b\u0434\u044b\u043d AI-\u0442\u0430\u043b\u0434\u0430\u0443")}>
                <div className="panel-body stack">
                  {Object.entries(completedAi.content).map(([section, items]: [string, any]) => (
                    <section key={section}>
                      <h3>{({
                        generalProfile: t("\u041e\u0431\u0449\u0438\u0439 \u043f\u0440\u043e\u0444\u0438\u043b\u044c", "\u0416\u0430\u043b\u043f\u044b \u0431\u0435\u0439\u0456\u043d"),
                        analyticalAbilities: t("\u0410\u043d\u0430\u043b\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0441\u043f\u043e\u0441\u043e\u0431\u043d\u043e\u0441\u0442\u0438", "\u0422\u0430\u043b\u0434\u0430\u0443 \u049b\u0430\u0431\u0456\u043b\u0435\u0442\u0442\u0435\u0440\u0456"),
                        personality: t("\u041b\u0438\u0447\u043d\u043e\u0441\u0442\u043d\u044b\u0435 \u0445\u0430\u0440\u0430\u043a\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043a\u0438", "\u0422\u04b1\u043b\u0493\u0430\u043b\u044b\u049b \u0435\u0440\u0435\u043a\u0448\u0435\u043b\u0456\u043a\u0442\u0435\u0440"),
                        motivation: t("\u041c\u043e\u0442\u0438\u0432\u0430\u0446\u0438\u043e\u043d\u043d\u044b\u0439 \u043f\u0440\u043e\u0444\u0438\u043b\u044c", "\u0423\u04d9\u0436\u0434\u0435\u043c\u0435\u043b\u0456\u043a \u0431\u0435\u0439\u0456\u043d"),
                        situations: t("\u0423\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0447\u0435\u0441\u043a\u0438\u0435 \u0441\u0438\u0442\u0443\u0430\u0446\u0438\u0438", "\u0411\u0430\u0441\u049b\u0430\u0440\u0443 \u0436\u0430\u0493\u0434\u0430\u0439\u043b\u0430\u0440\u044b"),
                        strengths: t("\u0421\u0438\u043b\u044c\u043d\u044b\u0435 \u0441\u0442\u043e\u0440\u043e\u043d\u044b", "\u041a\u04af\u0448\u0442\u0456 \u0436\u0430\u049b\u0442\u0430\u0440\u044b"),
                        developmentAreas: t("\u0417\u043e\u043d\u044b \u0440\u0430\u0437\u0432\u0438\u0442\u0438\u044f", "\u0414\u0430\u043c\u044b\u0442\u0443 \u0431\u0430\u0493\u044b\u0442\u0442\u0430\u0440\u044b"),
                        recommendations: t("\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0446\u0438\u0438", "\u04b0\u0441\u044b\u043d\u044b\u0441\u0442\u0430\u0440"),
                        limitations: t("\u041e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u0438\u044f", "\u0428\u0435\u043a\u0442\u0435\u0443\u043b\u0435\u0440"),
                      } as Record<string, string>)[section] || section}</h3>
                      {items.map((item: any, index: number) => (
                        <div key={index}>
                          <p className="report-text">{typeof item === "string" ? item : item.text}</p>
                        </div>
                      ))}
                    </section>
                  ))}
                  <div className="notice"><Info size={18} />{t("\u042d\u0442\u043e \u043f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0439 AI-\u0430\u043d\u0430\u043b\u0438\u0437. \u042d\u043a\u0441\u043f\u0435\u0440\u0442 \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442 \u0438 \u0443\u0442\u0432\u0435\u0440\u0434\u0438\u0442 \u0438\u0442\u043e\u0433\u043e\u0432\u043e\u0435 \u0437\u0430\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435.", "\u0411\u04b1\u043b \u0430\u043b\u0434\u044b\u043d AI-\u0442\u0430\u043b\u0434\u0430\u0443. \u0421\u0430\u0440\u0430\u043f\u0448\u044b \u0442\u04af\u043f\u043a\u0456\u043b\u0456\u043a \u049b\u043e\u0440\u044b\u0442\u044b\u043d\u0434\u044b\u043d\u044b \u0442\u0435\u043a\u0441\u0435\u0440\u0456\u043f, \u0431\u0435\u043a\u0456\u0442\u0435\u0434\u0456.")}</div>
                </div>
              </Panel>
            ) : data.canSelfGenerateAi ? (
              <Panel title={t("\u041f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0439 AI-\u0430\u043d\u0430\u043b\u0438\u0437", "\u0410\u043b\u0434\u044b\u043d AI-\u0442\u0430\u043b\u0434\u0430\u0443")}>
                <div className="panel-body stack">
                  <div className="notice">
                    {aiInProgress ? <Clock3 size={18} /> : <Info size={18} />}
                    {aiInProgress
                      ? t("AI-\u0430\u043d\u0430\u043b\u0438\u0437 \u0433\u043e\u0442\u043e\u0432\u0438\u0442\u0441\u044f. \u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u0437\u0434\u0435\u0441\u044c \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438.", "AI-\u0442\u0430\u043b\u0434\u0430\u0443 \u0434\u0430\u0439\u044b\u043d\u0434\u0430\u043b\u044b\u043f \u0436\u0430\u0442\u044b\u0440. \u041d\u04d9\u0442\u0438\u0436\u0435 \u043e\u0441\u044b \u0436\u0435\u0440\u0434\u0435 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0442\u044b \u0442\u04af\u0440\u0434\u0435 \u043a\u04e9\u0440\u0441\u0435\u0442\u0456\u043b\u0435\u0434\u0456.")
                      : latestAi?.status === "awaiting_configuration"
                        ? t("\u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0430\u044f \u043f\u043e\u043f\u044b\u0442\u043a\u0430 \u043d\u0435 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u043b\u0430\u0441\u044c. \u041d\u0430\u0436\u043c\u0438\u0442\u0435 \u043a\u043d\u043e\u043f\u043a\u0443, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0430\u043d\u0430\u043b\u0438\u0437.", "\u0410\u043b\u0434\u044b\u04a3\u0493\u044b \u04d9\u0440\u0435\u043a\u0435\u0442 \u0456\u0441\u043a\u0435 \u049b\u043e\u0441\u044b\u043b\u043c\u0430\u0434\u044b. \u0422\u0430\u043b\u0434\u0430\u0443\u0434\u044b \u0430\u043b\u0443 \u04af\u0448\u0456\u043d \u0442\u04af\u0439\u043c\u0435\u043d\u0456 \u0431\u0430\u0441\u044b\u04a3\u044b\u0437.")
                        : latestAi?.status === "failed"
                          ? t("\u0410\u043d\u0430\u043b\u0438\u0437\u0434\u0456 \u049b\u04b1\u0440\u0443 \u043a\u0435\u0437\u0456\u043d\u0434\u0435 \u049b\u0430\u0442\u0435 \u0448\u044b\u049b\u0442\u044b. \u049a\u0430\u0439\u0442\u0430 \u0442\u044b\u0440\u044b\u0441\u044b\u043f \u043a\u04e9\u0440\u0456\u04a3\u0456\u0437.", "\u0422\u0430\u043b\u0434\u0430\u0443 \u043a\u0435\u0437\u0456\u043d\u0434\u0435 \u049b\u0430\u0442\u0435 \u0442\u0443\u044b\u043d\u0434\u0430\u0434\u044b. \u049a\u0430\u0439\u0442\u0430 \u0441\u044b\u043d\u0430\u043f \u043a\u04e9\u0440\u0456\u04a3\u0456\u0437.")
                          : t("\u0421\u0444\u043e\u0440\u043c\u0438\u0440\u0443\u0439\u0442\u0435 \u043f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0439 AI-\u0430\u043d\u0430\u043b\u0438\u0437 \u043f\u043e \u0432\u0441\u0435\u043c \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u044b\u043c \u0442\u0435\u0441\u0442\u0430\u043c. \u041e\u043d \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u043e\u0434\u0438\u043d \u0440\u0430\u0437 \u0437\u0430 \u043a\u0430\u043c\u043f\u0430\u043d\u0438\u044e.", "\u0411\u0430\u0440\u043b\u044b\u049b \u0442\u0435\u0441\u0442\u0442\u0435\u0440\u0434\u0456 \u0430\u044f\u049b\u0442\u0430\u0493\u0430\u043d\u043d\u0430\u043d \u043a\u0435\u0439\u0456\u043d \u0430\u043b\u0434\u044b\u043d AI-\u0442\u0430\u043b\u0434\u0430\u0443\u0434\u044b \u0436\u0430\u0441\u0430\u04a3\u044b\u0437. \u041e\u043b \u0431\u0456\u0440 \u043d\u0430\u0443\u049b\u0430\u043d\u0434\u0430 \u0431\u0456\u0440 \u0440\u0435\u0442 \u049b\u0430\u043b\u044b\u043f\u0442\u0430\u0441\u0430\u0434\u044b.")}
                  </div>
                  {aiInProgress && (
                    <div className="ai-progress-wrap">
                      <div
                        className="ai-progress-track"
                        role="progressbar"
                        aria-label={t("\u0413\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f AI-\u0430\u043d\u0430\u043b\u0438\u0437\u0430", "AI-\u0442\u0430\u043b\u0434\u0430\u0443\u0434\u044b \u0436\u0430\u0441\u0430\u0443")}
                        aria-valuetext={t("\u041e\u0436\u0438\u0434\u0430\u043d\u0438\u0435 \u043e\u0442\u0432\u0435\u0442\u0430 AI-\u043c\u043e\u0434\u0435\u043b\u0438", "AI-\u043c\u043e\u0434\u0435\u043b\u0456\u043d\u0456\u04a3 \u0436\u0430\u0443\u0430\u0431\u044b\u043d \u043a\u04af\u0442\u0443")}
                      >
                        <span />
                      </div>
                      <p className="ai-progress-label">
                        {latestAi?.status === "processing"
                          ? t("AI-\u043c\u043e\u0434\u0435\u043b\u044c \u0444\u043e\u0440\u043c\u0438\u0440\u0443\u0435\u0442 \u0430\u043d\u0430\u043b\u0438\u0437", "AI-\u043c\u043e\u0434\u0435\u043b\u044c \u0442\u0430\u043b\u0434\u0430\u0443\u0434\u044b \u049b\u04b1\u0440\u0430\u0441\u0442\u044b\u0440\u044b\u043f \u0436\u0430\u0442\u044b\u0440")
                          : t("\u0417\u0430\u043f\u0440\u043e\u0441 \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u0438, \u043e\u0436\u0438\u0434\u0430\u0435\u043c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0438", "\u0421\u04b1\u0440\u0430\u043d\u044b\u0441 \u043a\u0435\u0437\u0435\u043a\u0442\u0435, \u04e9\u04a3\u0434\u0435\u043b\u0443\u0456\u043d \u043a\u04af\u0442\u0456\u04a3\u0456\u0437")}
                      </p>
                    </div>
                  )}
                  {!aiInProgress && (
                    <Button variant="secondary" busy={aiBusy} onClick={async () => {
                      setAiBusy(true);
                      try {
                        const result = await post<{ status: string }>("/ai/generate", { membershipId: me.member.id, campaignId: campaign });
                        if (result.status === "awaiting_configuration") notify(t("AI \u0435\u0449\u0451 \u043d\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0451\u043d. \u041e\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044c \u043a \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0443.", "AI \u04d9\u043b\u0456 \u049b\u043e\u0441\u044b\u043b\u043c\u0430\u0493\u0430\u043d. \u04d8\u043a\u0456\u043c\u0448\u0456\u0433\u0435 \u0445\u0430\u0431\u0430\u0440\u043b\u0430\u0441\u044b\u04a3\u044b\u0437."), "error");
                        else if (result.status === "completed") notify(t("\u0410\u043d\u0430\u043b\u0438\u0437 \u0434\u043b\u044f \u044d\u0442\u043e\u0439 \u043a\u0430\u043c\u043f\u0430\u043d\u0438\u0438 \u0443\u0436\u0435 \u0441\u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u043d.", "\u0411\u04b1\u043b \u043d\u0430\u0443\u049b\u0430\u043d\u0434\u0430\u0493\u044b \u0442\u0430\u043b\u0434\u0430\u0443 \u0431\u04b1\u0440\u044b\u043d \u049b\u0430\u043b\u044b\u043f\u0442\u0430\u0441\u049b\u0430\u043d."));
                        else if (["pending", "processing"].includes(result.status)) notify(t("\u0410\u043d\u0430\u043b\u0438\u0437 \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u0438. \u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u0437\u0434\u0435\u0441\u044c.", "\u0422\u0430\u043b\u0434\u0430\u0443 \u043a\u0435\u0437\u0435\u043a\u043a\u0435 \u049b\u043e\u0441\u044b\u043b\u0434\u044b. \u041d\u04d9\u0442\u0438\u0436\u0435 \u043e\u0441\u044b \u0436\u0435\u0440\u0434\u0435 \u043a\u04e9\u0440\u0456\u043d\u0435\u0434\u0456."));
                        else notify(t("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0430\u043d\u0430\u043b\u0438\u0437. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u0437\u0436\u0435.", "\u0422\u0430\u043b\u0434\u0430\u0443\u0434\u044b \u0456\u0441\u043a\u0435 \u049b\u043e\u0441\u0443 \u043c\u04af\u043c\u043a\u0456\u043d \u0431\u043e\u043b\u043c\u0430\u0434\u044b. \u041a\u0435\u0439\u0456\u043d\u0456\u0440\u0435\u043a \u049b\u0430\u0439\u0442\u0430 \u0441\u044b\u043d\u0430\u043f \u043a\u04e9\u0440\u0456\u04a3\u0456\u0437."), "error");
                        await refreshSilently();
                      } catch (e) { notify((e as Error).message, "error"); }
                      finally { setAiBusy(false); }
                    }}>
                      <Sparkles size={16} />
                      {latestAi?.status === "failed"
                        ? t("\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c", "\u049a\u0430\u0439\u0442\u0430 \u0441\u044b\u043d\u0430\u0443")
                        : latestAi?.status === "awaiting_configuration"
                          ? t("\u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0430\u043d\u0430\u043b\u0438\u0437 \u043f\u043e \u0442\u0435\u0441\u0442\u0430\u043c", "\u0422\u0435\u0441\u0442\u0442\u0435\u0440 \u0431\u043e\u0439\u044b\u043d\u0448\u0430 \u0442\u0430\u043b\u0434\u0430\u0443 \u0430\u043b\u0443")
                          : t("\u0421\u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u0442\u044c AI-\u0430\u043d\u0430\u043b\u0438\u0437", "AI-\u0442\u0430\u043b\u0434\u0430\u0443\u0434\u044b \u0436\u0430\u0441\u0430\u0443")}
                    </Button>
                  )}
                  <p className="text-small text-muted">{t("\u041f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0439 \u0430\u043d\u0430\u043b\u0438\u0437 \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u043e\u0434\u0438\u043d \u0440\u0430\u0437 \u0437\u0430 \u043a\u0430\u043c\u043f\u0430\u043d\u0438\u044e. \u041f\u0440\u0438 \u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u043e\u0439 \u043e\u0448\u0438\u0431\u043a\u0435 \u043c\u043e\u0436\u043d\u043e \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c.", "\u0410\u043b\u0434\u044b\u043d \u0442\u0430\u043b\u0434\u0430\u0443\u0434\u044b \u0431\u0456\u0440 \u043d\u0430\u0443\u049b\u0430\u043d\u0434\u0430 \u0431\u0456\u0440 \u0440\u0435\u0442 \u0436\u0430\u0441\u0430\u0443\u0493\u0430 \u0431\u043e\u043b\u0430\u0434\u044b. \u0422\u0435\u0445\u043d\u0438\u043a\u0430\u043b\u044b\u049b \u049b\u0430\u0442\u0435 \u043a\u0435\u0437\u0456\u043d\u0434\u0435 \u049b\u0430\u0439\u0442\u0430 \u0441\u044b\u043d\u0430\u0443\u0493\u0430 \u0431\u043e\u043b\u0430\u0434\u044b.")}</p>
                </div>
              </Panel>
            ) : null}
          </div>
        )}
      </LoadState>
    </>
  );
}
