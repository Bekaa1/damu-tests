"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { AssessmentComplete } from "./assessment-complete";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
import {
  useApp,
  useData,
  post,
  api,
  Button,
  Panel,
  LoadState,
  Modal,
  Progress,
  Empty,
} from "./ui";
export function Material({ text }: { text: string }) {
  const {t}=useApp();
  return (
    <div className="test-material">
      {text.split("\n\n").map((part, i) =>
        part.includes(" | ") ? (
          <div className="material-table" key={i}>
            <small className="material-scroll-hint">{t('Таблицу можно прокрутить вправо →','Кестені оңға қарай жылжытуға болады →')}</small><table>
              <tbody>
                {part.split("\n").map((r, j) => (
                  <tr key={j}>
                    {r
                      .split(" | ")
                      .map((c, k) =>
                        j === 0 ? <th key={k}>{c}</th> : <td key={k}>{c}</td>,
                      )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p key={i}>{part}</p>
        ),
      )}
    </div>
  );
}
export function TestRunner({ id }: { id: string }) {
  const { t, loc } = useApp();
  const { data, loading, error } = useData<any>(`/attempts/${id}`);
  const [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<Record<string, any>>({}),
    [saved, setSaved] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false),
    [running, setRunning] = useState(false),
    [deadline, setDeadline] = useState<number | null>(null),
    [remaining, setRemaining] = useState<number | null>(null),
    [offline, setOffline] = useState(false),
    [confirm, setConfirm] = useState(false),
    [practice, setPractice] = useState(-1),
    [trial, setTrial] = useState<any>(null),
    [feedback, setFeedback] = useState(false),
    [autoNext, setAutoNext] = useState(true);
  const hydrated = useRef(false),
    revisions = useRef<Record<string, number>>({}),
    queue = useRef<Record<string, { value: any; durationMs: number }>>({}),
    working = useRef(false),
    answersRef = useRef<Record<string, any>>({}),
    opened = useRef(Date.now()),
    spent = useRef<Record<string, number>>({}),
    timerOffset = useRef(0),
    offlineRef = useRef(false),
    finished = useRef(false),
    runningRef = useRef(false),
    flushRef = useRef<() => Promise<void>>(async () => {});
  const storage = `assessflow.answers.${id}`;
  const completion = useData<any[]>(
    done && data?.campaignId ? `/my/assignments?campaignId=${data.campaignId}` : null,
  );
  const allDone = Boolean(completion.data?.length) &&
    completion.data!.every((assignment) => assignment.attempts[0]?.status === "completed");
  const complete = (q: any, v: any) =>
    v !== undefined &&
    (q.type !== "sjt" || Boolean(v?.most && v?.least)) &&
    (q.type !== "ranking" || (v?.top?.length === 3 && v?.bottom?.length === 3));
  const recordQueue = () => {
    try {
      if (Object.keys(queue.current).length)
        localStorage.setItem(storage, JSON.stringify(queue.current));
      else localStorage.removeItem(storage);
    } catch {}
  };
  async function flush() {
    if (working.current || finished.current) return;
    working.current = true;
    setBusy(true);
    try {
      while (Object.keys(queue.current).length) {
        const qid = Object.keys(queue.current)[0];
        const entry = queue.current[qid];
        let r;
        try {
          r = await post(`/attempts/${id}/answers`, {
            questionId: qid,
            value: entry.value,
            revision: revisions.current[qid] || 0,
            durationMs: entry.durationMs,
          });
        } catch (e) {
          // A response can be lost after the server commits the answer.
          // Acknowledge that exact value without overwriting another tab's edit.
          if (!(e as Error).message.includes("другой вкладке")) throw e;
          const current = await api<any>(`/attempts/${id}`);
          const persisted = current.answers.find(
            (x: any) => x.questionId === qid,
          );
          if (
            !persisted ||
            JSON.stringify(persisted.value) !== JSON.stringify(entry.value)
          )
            throw e;
          r = { revision: persisted.revision };
        }
        revisions.current[qid] = r.revision;
        if (queue.current[qid] === entry) delete queue.current[qid];
        setSaved({ ...revisions.current });
        recordQueue();
      }
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
      if (!navigator.onLine) {
        offlineRef.current = true;
        setOffline(true);
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  flushRef.current = flush;
  function choose(q: any, value: any) {
    answersRef.current = { ...answersRef.current, [q.id]: value };
    setAnswers(answersRef.current);
    const durationMs =
      (spent.current[q.id] || 0) + Math.max(0, Date.now() - opened.current);
    spent.current[q.id] = durationMs;
    opened.current = Date.now();
    queue.current[q.id] = { value, durationMs };
    recordQueue();
    void flush();
    if (autoNext && q.type === "scale" && data?.questions.length === 126) {
      setIndex((i) => Math.min(i + 1, data.questions.length - 1));
      opened.current = Date.now();
    }
  }
  useEffect(() => {
    if (!data || hydrated.current) return;
    hydrated.current = true;
    const a = Object.fromEntries(
      data.answers.map((x: any) => [x.questionId, x.value]),
    );
    spent.current = Object.fromEntries(
      data.answers.map((x: any) => [x.questionId, x.durationMs || 0]),
    );
    revisions.current = Object.fromEntries(
      data.answers.map((x: any) => [x.questionId, x.revision]),
    );
    try {
      queue.current = JSON.parse(localStorage.getItem(storage) || "{}");
    } catch {}
    for (const [k, v] of Object.entries(queue.current)) a[k] = v.value;
    answersRef.current = a;
    setAnswers(a);
    setSaved({ ...revisions.current });
    setIndex(
      Math.max(
        0,
        data.questions.findIndex((q: any) => !complete(q, a[q.id])),
      ),
    );
    setRunning(Boolean(data.timerStartedAt));
    runningRef.current = Boolean(data.timerStartedAt);
    setDone(data.status === "completed");
    finished.current = data.status === "completed";
    if (data.serverTime)
      timerOffset.current = new Date(data.serverTime).getTime() - Date.now();
    if (data.expiresAt) setDeadline(new Date(data.expiresAt).getTime());
    if (data.pausedAt) {
      offlineRef.current = true;
      setOffline(true);
    }
    if (data.timerStartedAt && data.status === "in_progress") void heartbeat();
  }, [data]);
  async function heartbeat() {
    if (!runningRef.current || finished.current) return;
    try {
      const a = await post(`/attempts/${id}/presence`, { action: "heartbeat" });
      offlineRef.current = false;
      if (offline) opened.current = Date.now();
      setOffline(false);
      if (a.serverTime)
        timerOffset.current = new Date(a.serverTime).getTime() - Date.now();
      if (a.expiresAt) setDeadline(new Date(a.expiresAt).getTime());
      if (a.status === "completed") {
        finished.current = true;
        setDone(true);
      } else await flushRef.current();
    } catch {
      offlineRef.current = true;
      setOffline(true);
    }
  }
  useEffect(() => {
    const leave = () => {
      if (!runningRef.current || finished.current) return;
      const org = localStorage.getItem("assessflow.org");
      void fetch(`/api/attempts/${id}/presence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(org ? { "x-organization-id": org } : {}),
        },
        body: JSON.stringify({ action: "leave" }),
        keepalive: true,
      }).catch(() => {});
    };
    const lost = () => {
      offlineRef.current = true;
      setOffline(true);
    };
    const online = () => void heartbeat();
    const before = (e: BeforeUnloadEvent) => {
      if (Object.keys(queue.current).length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("offline", lost);
    window.addEventListener("online", online);
    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", before);
    const timer = setInterval(() => void heartbeat(), 5000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("offline", lost);
      window.removeEventListener("online", online);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("beforeunload", before);
      leave();
    };
  }, [id]);
  async function submit() {
    if (working.current) return;
    setBusy(true);
    try {
      await flushRef.current();
      if (Object.keys(queue.current).length)
        throw Error(
          t("Дождитесь сохранения ответов", "Жауаптардың сақталуын күтіңіз"),
        );
      const r = await post(`/attempts/${id}/submit`);
      if (r.status === "completed") {
        finished.current = true;
        setDone(true);
        localStorage.removeItem(storage);
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!deadline || !running || done) return;
    let sending = false;
    const tick = () => {
      if (offlineRef.current) return;
      const sec = Math.max(
        0,
        Math.ceil((deadline - Date.now() - timerOffset.current) / 1000),
      );
      setRemaining(sec);
      if (sec === 0 && !sending && !working.current) {
        sending = true;
        void submit().finally(() => {
          sending = false;
        });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline, running, done]);
  async function begin() {
    setBusy(true);
    try {
      const a = await post(`/attempts/${id}/presence`, { action: "begin" });
      setRunning(true);
      runningRef.current = true;
      if (a.expiresAt) setDeadline(new Date(a.expiresAt).getTime());
      opened.current = Date.now();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <LoadState loading={completion.loading || (!completion.data && !completion.error)} error={completion.error}>
      {allDone ? <AssessmentComplete /> : <Panel>
        <Empty
          icon={<CheckCircle2 size={30} />}
          title={t("Тестирование завершено", "Тестілеу аяқталды")}
          description={t(
            "Ответы сохранены, результаты рассчитаны.",
            "Жауаптар сақталды, нәтижелер есептелді.",
          )}
          action={
            <Link className="button primary" href="/cabinet">
              {t("Вернуться в кабинет", "Кабинетке оралу")}
            </Link>
          }
        />
      </Panel>}
      </LoadState>
    );
  const training = data?.delivery?.practice || [],
    p = training[practice];
  const go = (n: number) => {
    setIndex(n);
    opened.current = Date.now();
  };
  const renderQuestion = (q: any) => {
    const v = answers[q.id];
    return (
      <fieldset
        disabled={offline || remaining === 0}
        key={q.id}
        className="question-panel new-question"
      >
        <h2 className="question-text">{loc(q.text)}</h2>
        {q.content?.material && <Material text={loc(q.content.material)} />}
        {q.imageUrl && (
          <img
            className="matrix-question"
            src={q.imageUrl}
            alt={t("Матрица", "Матрица")}
          />
        )}
        {["single", "image"].includes(q.type) && (
          <div
            className={q.type === "image" ? "image-options" : "answer-options"}
          >
            {q.options.map((o: any, i: number) => (
              <button
                key={o.id}
                className={`answer-option ${v === o.id ? "selected" : ""}`}
                aria-pressed={v === o.id}
                disabled={remaining === 0 || offline}
                onClick={() => choose(q, o.id)}
              >
                {o.imageUrl ? (
                  <img src={o.imageUrl} alt={loc(o.text)} />
                ) : (
                  <span className="option-letter">{"ABCDEH"[i]}</span>
                )}
                  <span>{q.type==='image'?t(`Вариант ${i+1}`,`Нұсқа ${i+1}`):loc(o.text)}</span>
              </button>
            ))}
          </div>
        )}
        {q.type === "scale" && (
          <div className="scale-options five">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-pressed={v === n}
                className={v === n ? "selected" : ""}
                onClick={() => choose(q, n)}
              >
                <strong>{n}</strong>
                <small>{loc(data.delivery.scaleLabels?.[n - 1])}</small>
              </button>
            ))}
          </div>
        )}
        {q.type === "sjt" && (
          <div className="answer-options">
            <div className="sjt-head">
              <span />
              {[
                t("Наиболее вероятно", "Ең ықтимал"),
                t("Наименее вероятно", "Ең ықтималдығы аз"),
              ].map((label) => (
                <strong key={label}>{label}</strong>
              ))}
            </div>
            {q.options.map((o: any) => (
              <div key={o.id} className="sjt-option">
                <span>{loc(o.text)}</span>
                {["most", "least"].map((kind) => (
                  <label key={kind}>
                    <input
                      type="radio"
                      name={`${q.id}-${kind}`}
                      aria-label={`${kind}: ${loc(o.text)}`}
                      checked={v?.[kind] === o.id}
                      disabled={
                        v?.[kind === "most" ? "least" : "most"] === o.id ||
                        remaining === 0 ||
                        offline
                      }
                      onChange={() =>
                        choose(q, { most: "", least: "", ...v, [kind]: o.id })
                      }
                    />
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        {q.type === "ranking" && (
          <>
            <p>
              {t(
                "Выберите ровно по три карточки в каждой группе.",
                "Әр топтан дәл үш карточка таңдаңыз.",
              )}
            </p>
            <div className="priority-grid">
              {q.options.map((o: any) => (
                <div className="priority-card" key={o.id}>
                  <strong>{loc(o.text)}</strong>
                  {["top", "bottom"].map((kind) => (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={v?.[kind]?.includes(o.id) || false}
                        disabled={
                          !v?.[kind]?.includes(o.id) &&
                          ((v?.[kind]?.length || 0) >= 3 ||
                            v?.[kind === "top" ? "bottom" : "top"]?.includes(
                              o.id,
                            ))
                        }
                        onChange={() => {
                          const a = { top: [], bottom: [], ...v };
                          choose(q, {
                            ...a,
                            [kind]: a[kind].includes(o.id)
                              ? a[kind].filter((x: string) => x !== o.id)
                              : [...a[kind], o.id],
                          });
                        }}
                      />
                      {kind === "top"
                        ? t("Наиболее важно", "Ең маңызды")
                        : t("Наименее важно", "Маңыздылығы аз")}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </fieldset>
    );
  };
  const isBatch = data?.questions.length === 49 && index < 48;
  const start = isBatch ? Math.floor(index / 6) * 6 : index;
  const end = isBatch ? start + 6 : index + 1;
  return (
    <LoadState loading={loading} error={error}>
      {data && (
        <div className="test-workspace">
          <div className="test-topline">
            <Link href="/cabinet" className="text-link">
              <ArrowLeft size={16} />
              {t("Мой кабинет", "Жеке кабинет")}
            </Link>
            <h2>{loc(data.name)}</h2>
          </div>
          {!running ? (
            <Panel>
              <div className="question-panel">
                <h1>
                  {practice < 0
                    ? t("Перед началом", "Бастамас бұрын")
                    : practice >= training.length
                      ? t("Готово к началу", "Бастауға дайын")
                      : t(
                          `Тренировка ${practice + 1} из ${training.length}`,
                          `Жаттығу ${practice + 1} / ${training.length}`,
                        )}
                </h1>
                {practice < 0 ? (
                  <>
                    <Material text={loc(data.instructions)} />
                    {data.questions.length===49&&<p>{t('Пример: «Комфортный и современный офис». Если это немного повышает желание работать, выберите 4; если не влияет — 3.','Мысал: «Жайлы әрі заманауи кеңсе». Егер бұл жұмыс істеуге деген ынтаны аздап арттырса, 4-ті; әсер етпесе, 3-ті таңдаңыз.')}</p>}
                    <Button
                      onClick={() =>
                        training.length ? setPractice(0) : void begin()
                      }
                      busy={busy}
                    >
                      {training.length
                        ? t("Перейти к тренировке", "Жаттығуға өту")
                        : t("Начать тест", "Тестті бастау")}
                    </Button>
                  </>
                ) : p ? (
                  <>
                    <Material text={loc(p.text)} />
                    {p.material && <Material text={loc(p.material)} />}{" "}
                    {p.imageUrl && (
                      <img
                        className="matrix-question"
                        src={p.imageUrl}
                        alt=""
                      />
                    )}
                    {p.type === "sjt" ? (
                      <div className="answer-options">
                        <div className="sjt-head">
                          <span />
                          <strong>
                            {t("Наиболее вероятно", "Ең ықтимал")}
                          </strong>
                          <strong>
                            {t("Наименее вероятно", "Ең ықтималдығы аз")}
                          </strong>
                        </div>
                        {p.options.map((o: any, i: number) => (
                          <div className="sjt-option" key={i}>
                            <span>{loc(o)}</span>
                            {["most", "least"].map((kind) => (
                              <label key={kind}>
                                <input
                                  type="radio"
                                  name={`practice-${kind}`}
                                  aria-label={`${kind}: ${loc(o)}`}
                                  checked={trial?.[kind] === i}
                                  disabled={
                                    trial?.[
                                      kind === "most" ? "least" : "most"
                                    ] === i
                                  }
                                  onChange={() => {
                                    setTrial({ ...trial, [kind]: i });
                                    setFeedback(false);
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        ))}
                        <Button
                          disabled={
                            trial?.most === undefined ||
                            trial?.least === undefined
                          }
                          onClick={() => setFeedback(true)}
                        >
                          {t("Проверить ответ", "Жауапты тексеру")}
                        </Button>
                      </div>
                    ) : (
                      <div
                        className={
                          p.images ? "image-options" : "answer-options"
                        }
                      >
                        {p.options.map((o: any, i: number) => (
                          <button
                            key={i}
                            className={`answer-option ${trial === i ? "selected" : ""}`}
                            onClick={() => {
                              setTrial(i);
                              setFeedback(true);
                            }}
                          >
                            {p.images && <img src={p.images[i]} alt={loc(o)} />}
                            <span>
                              {"ABCDEH"[i]}. {loc(o)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {feedback && (
                      <>
                        <div className="notice info mt">
                          {p.correct !== undefined && (
                            <strong>
                              {trial === p.correct
                                ? t("Верно. ", "Дұрыс. ")
                                : t("Неверно. ", "Қате. ")}
                            </strong>
                          )}
                          {loc(p.explanation)}
                        </div>
                        <Button
                          onClick={() => {
                            setPractice(practice + 1);
                            setFeedback(false);
                            setTrial(null);
                          }}
                        >
                          {t("Продолжить", "Жалғастыру")}
                        </Button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      {t(
                        "Тренировка завершена. Нажмите кнопку, чтобы начать основной тест.",
                        "Жаттығу аяқталды. Негізгі тестті бастау үшін батырманы басыңыз.",
                      )}
                    </p>
                    <Button onClick={() => void begin()} busy={busy}>
                      {t("Начать тест", "Тестті бастау")}
                    </Button>
                  </>
                )}
              </div>
            </Panel>
          ) : (
            <>
              <div className="test-progress">
                <Progress
                  value={
                    (100 *
                      data.questions.filter((q: any) =>
                        complete(q, answers[q.id]),
                      ).length) /
                    data.questions.length
                  }
                />
                <span>
                  {
                    data.questions.filter((q: any) =>
                      complete(q, answers[q.id]),
                    ).length
                  }{" "}
                  / {data.questions.length}
                </span>
                <strong className="test-timer">
                  <Clock3 size={16} />
                  {offline
                    ? t("Пауза: нет связи", "Үзіліс: байланыс жоқ")
                    : remaining === null
                      ? t("Без ограничения времени", "Уақыт шектелмеген")
                      : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}
                </strong>
              </div>
              {offline && (
                <div className="notice warning">
                  {t(
                    "Связь потеряна. Таймер на паузе. Сохранение возобновится автоматически после восстановления связи.",
                    "Байланыс үзілді. Таймер тоқтатылды. Байланыс қалпына келгенде сақтау автоматты түрде жалғасады.",
                  )}
                </div>
              )}
              <details className="test-instructions">
                <summary>{t("Инструкция", "Нұсқаулық")}</summary>
                <Material text={loc(data.instructions)} />
              </details>
              {data.questions.length === 126 && (
                <label className="row">
                  <input
                    type="checkbox"
                    checked={autoNext}
                    onChange={(e) => setAutoNext(e.target.checked)}
                  />
                  {t(
                    "Автоматически переходить к следующему вопросу",
                    "Келесі сұраққа автоматты өту",
                  )}
                </label>
              )}
              <Panel>
                <div
                  className="question-number"
                  style={{ padding: "20px 24px 0" }}
                >
                  {t("Задание", "Тапсырма")} {start + 1}
                  {isBatch ? `–${end}` : ""} / {data.questions.length}
                </div>
                {data.questions.slice(start, end).map(renderQuestion)}
                <div className="question-footer">
                  <Button
                    variant="secondary"
                    disabled={start === 0}
                    onClick={() => go(isBatch ? start - 6 : index - 1)}
                  >
                    <ArrowLeft size={16} />
                    {t("Назад", "Артқа")}
                  </Button>
                  <span role="status">
                    {busy
                      ? t("Сохраняем…", "Сақталуда…")
                      : Object.keys(queue.current).length
                        ? t(
                            "Есть несохранённые изменения",
                            "Сақталмаған өзгерістер бар",
                          )
                        : t("Изменения сохранены", "Өзгерістер сақталды")}
                  </span>
                  {end < data.questions.length ? (
                    <Button onClick={() => go(end)}>
                      {t("Далее", "Келесі")}
                      <ArrowRight size={16} />
                    </Button>
                  ) : (
                    <Button onClick={() => setConfirm(true)}>
                      {t("Завершить тест", "Тестті аяқтау")}
                    </Button>
                  )}
                </div>
              </Panel>
              <div className="question-dots">
                {data.questions.map((q: any, i: number) => (
                  <button
                    key={q.id}
                    className={`${complete(q, answers[q.id]) ? "done" : ""} ${i === index ? "current" : ""}`}
                    onClick={() => go(i)}
                    aria-label={`${t("Задание", "Тапсырма")} ${i + 1}`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              {message && (
                <div className="notice error" role="alert">
                  {message}
                  <Button variant="secondary" onClick={() => void flush()}>
                    {t("Повторить сохранение", "Қайта сақтау")}
                  </Button>
                </div>
              )}
              {confirm && (
                <Modal
                  title={t("Завершить тест?", "Тестті аяқтайсыз ба?")}
                  onClose={() => setConfirm(false)}
                  className="test-finish-modal"
                >
                  <div className="modal-body form-stack">
                    <p>
                      {data.timeLimitSeconds
                        ? t(
                            "Пропущенные вопросы получат 0 баллов. После завершения ответы изменить нельзя.",
                            "Өткізілген сұрақтарға 0 балл беріледі. Аяқтағаннан кейін жауаптарды өзгерту мүмкін емес.",
                          )
                        : t(
                            "Ответьте на все утверждения и завершите выбор приоритетов.",
                            "Барлық тұжырымдарға жауап беріп, басымдықтарды таңдауды аяқтаңыз.",
                          )}
                    </p>
                    <Button
                      busy={busy}
                      disabled={
                        offline ||
                        (!data.timeLimitSeconds &&
                          !data.questions.every((q: any) =>
                            complete(q, answers[q.id]),
                          ))
                      }
                      onClick={() => void submit()}
                    >
                      {t("Подтвердить завершение", "Аяқтауды растау")}
                    </Button>
                  </div>
                </Modal>
              )}
            </>
          )}
        </div>
      )}
    </LoadState>
  );
}
