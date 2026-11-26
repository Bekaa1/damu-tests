"use client";
import { TestCamera } from "./test-camera";
import { monitorAttempt } from "../lib/attempt-journal";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { AssessmentComplete } from "./assessment-complete";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
import {
  useApp,
  useData,
  isNetworkErrorMessage,
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
  const { t } = useApp();
  return (
    <div className="test-material">
      {text.split("\n\n").map((part, i) =>
        part.includes(" | ") ? (
          <div className="material-table" key={i}>
            <small className="material-scroll-hint">
              {t(
                "Таблицу можно прокрутить вправо →",
                "Кестені оңға қарай жылжытуға болады →",
              )}
            </small>
            <table>
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
  const { t, loc, me } = useApp();
  function requestMessage(detail: string, pendingAnswers = false) {
    if (!isNetworkErrorMessage(detail)) return detail;
    return pendingAnswers
      ? t(
          "Не удалось отправить ответы. Оставьте страницу открытой. Когда связь восстановится, ответы отправятся автоматически.",
          "Жауаптарды жіберу мүмкін болмады. Бетті ашық қалдырыңыз. Байланыс қалпына келгенде жауаптар автоматты түрде жіберіледі.",
        )
      : t(
          "Не удалось связаться с сервером. Проверьте подключение и повторите попытку.",
          "Серверге қосылу мүмкін болмады. Байланысты тексеріп, қайталап көріңіз.",
        );
  }
  const { data: remoteData, loading, error } = useData<any>(`/attempts/${id}`);
  const [cachedData, setCachedData] = useState<any>(null);
  const data = remoteData || cachedData;
  const videoRequired = data?.videoRequired || Boolean(me.video?.campaign && me.video.campaign === data?.campaignId);
  const [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<Record<string, any>>({}),
    [saved, setSaved] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false),
    [retryRequired, setRetryRequired] = useState(false),
    [running, setRunning] = useState(false),
    [cameraRequested, setCameraRequested] = useState(false),
    [cameraAdmitted, setCameraAdmitted] = useState(false),
    [deadline, setDeadline] = useState<number | null>(null),
    [remaining, setRemaining] = useState<number | null>(null),
    [offline, setOffline] = useState(false),
    [confirm, setConfirm] = useState(false),
    [practice, setPractice] = useState(-1),
    [trial, setTrial] = useState<any>(null),
    [feedback, setFeedback] = useState(false),
    [initialized, setInitialized] = useState(false),
    [autoNext, setAutoNext] = useState(true);
  const hydrated = useRef(false),
    serverHydrated = useRef(false),
    revisions = useRef<Record<string, number>>({}),
    queue = useRef<
      Record<
        string,
        { value: any; durationMs: number; answeredAt: string; revision: number }
      >
    >({}),
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
  const memberId = me.member?.id;
  useEffect(() => {
    if (memberId && !done) return monitorAttempt(id, memberId);
  }, [id, memberId, done]);
  function applyLifecycle(snapshot: any, fresh: boolean) {
    const active = Boolean(snapshot.timerStartedAt);
    setRunning(active);
    runningRef.current = active;
    const completed = ["completed", "retry_required", "expired"].includes(
      snapshot.status,
    );
    setRetryRequired(["retry_required", "expired"].includes(snapshot.status));
    setDone(completed);
    finished.current = completed;
    setDeadline(
      snapshot.expiresAt ? new Date(snapshot.expiresAt).getTime() : null,
    );
    if (!snapshot.expiresAt) setRemaining(null);
    if (fresh && snapshot.serverTime)
      timerOffset.current =
        new Date(snapshot.serverTime).getTime() - Date.now();
    else if (!fresh)
      timerOffset.current = Number.isFinite(snapshot.clockOffsetMs)
        ? snapshot.clockOffsetMs
        : 0;
    if (fresh) {
      try {
        const cached =
          JSON.parse(
            localStorage.getItem(`assessflow.cached.${id}`) || "null",
          ) || data;
        if (cached)
          localStorage.setItem(
            `assessflow.cached.${id}`,
            JSON.stringify({
              ...cached,
              timerStartedAt: snapshot.timerStartedAt,
              expiresAt: snapshot.expiresAt,
              status: snapshot.status,
              clockOffsetMs: timerOffset.current,
            }),
          );
      } catch {}
    }
  }
  const completion = useData<any[]>(
    done && data?.campaignId
      ? `/my/assignments?campaignId=${data.campaignId}`
      : null,
  );
  const allDone =
    Boolean(completion.data?.length) &&
    completion.data!.every(
      (assignment) => assignment.attempts[0]?.status === "completed",
    );
  const complete = (q: any, v: any) =>
    v !== undefined &&
    (q.type !== "sjt" || Boolean(v?.most && v?.least)) &&
    (q.type !== "ranking" || (v?.top?.length === 3 && v?.bottom?.length === 3));
  const recordQueue = () => {
    try {
      if (Object.keys(queue.current).length)
        localStorage.setItem(storage, JSON.stringify(queue.current));
      else localStorage.removeItem(storage);
    } catch {
      setMessage(
        t(
          "Недостаточно места для сохранения ответов. Не закрывайте страницу.",
          "Жауаптарды сақтауға орын жеткіліксіз. Бетті жаппаңыз.",
        ),
      );
    }
  };
  async function flush() {
    if (working.current) return;
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
            revision: entry.revision ?? revisions.current[qid] ?? 0,
            answeredAt: entry.answeredAt,
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
        else if (queue.current[qid]) queue.current[qid].revision = r.revision;
        try {
          const cached = JSON.parse(
            localStorage.getItem(`assessflow.cached.${id}`) || "null",
          );
          if (cached) {
            cached.answers = Object.entries(answersRef.current).map(
              ([questionId, value]) => ({
                questionId,
                value,
                revision: revisions.current[questionId] || 0,
                durationMs: spent.current[questionId] || 0,
              }),
            );
            localStorage.setItem(
              `assessflow.cached.${id}`,
              JSON.stringify(cached),
            );
          }
        } catch {}
        setSaved({ ...revisions.current });
        recordQueue();
      }
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
      if (
        !(e as Error).message.includes("другой вкладке") &&
        !(e as Error).message.includes("после завершения")
      ) {
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
    if (
      finished.current ||
      (deadline !== null && Date.now() + timerOffset.current >= deadline)
    )
      return;
    answersRef.current = { ...answersRef.current, [q.id]: value };
    setAnswers(answersRef.current);
    const durationMs =
      (spent.current[q.id] || 0) + Math.max(0, Date.now() - opened.current);
    spent.current[q.id] = durationMs;
    opened.current = Date.now();
    queue.current[q.id] = {
      value,
      durationMs,
      answeredAt: new Date(Date.now() + timerOffset.current).toISOString(),
      revision: revisions.current[q.id] || 0,
    };
    recordQueue();
    void flush();
    if (autoNext && q.type === "scale" && data?.questions.length === 126) {
      setIndex((i) => Math.min(i + 1, data.questions.length - 1));
      opened.current = Date.now();
    }
  }
  useEffect(() => {
    try {
      setCachedData(
        JSON.parse(localStorage.getItem(`assessflow.cached.${id}`) || "null"),
      );
    } catch {}
  }, [id]);
  useEffect(() => {
    if (remoteData)
      try {
        localStorage.setItem(
          `assessflow.cached.${id}`,
          JSON.stringify({
            ...remoteData,
            clockOffsetMs: remoteData.serverTime
              ? new Date(remoteData.serverTime).getTime() - Date.now()
              : 0,
          }),
        );
      } catch {}
  }, [remoteData, id]);
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
    applyLifecycle(data, Boolean(remoteData));
    setInitialized(true);
  }, [data]);
  useEffect(() => {
    if (!remoteData || !hydrated.current) return;
    const fresh = Object.fromEntries(
      remoteData.answers.map((x: any) => [x.questionId, x.value]),
    );
    for (const x of remoteData.answers)
      revisions.current[x.questionId] = x.revision;
    for (const [questionId, entry] of Object.entries(queue.current))
      fresh[questionId] = entry.value;
    answersRef.current = fresh;
    setAnswers(fresh);
    setSaved({ ...revisions.current });
    // Cached answers can hydrate first; server lifecycle must still win afterwards.
    applyLifecycle(remoteData, true);
    if (!serverHydrated.current) {
      serverHydrated.current = true;
      setIndex(
        Math.max(
          0,
          remoteData.questions.findIndex((q: any) => !complete(q, fresh[q.id])),
        ),
      );
    }
  }, [remoteData]);
  async function heartbeat() {
    if (!runningRef.current) return;
    try {
      await flushRef.current();
      if (Object.keys(queue.current).length) return;
      const a = await post(`/attempts/${id}/presence`, {
        action: document.visibilityState === "visible" ? "return" : "heartbeat",
      });
      // An earlier heartbeat may arrive after a successful submission.
      if (finished.current && a.status === "in_progress") return;
      offlineRef.current = false;
      if (offline) opened.current = Date.now();
      setOffline(false);
      applyLifecycle(a, true);
    } catch {
      offlineRef.current = true;
      setOffline(true);
    }
  }
  useEffect(() => {
    const eventKey = `assessflow.presence.${id}`;
    const sendEvents = async () => {
      let pending: any[] = [];
      try {
        pending = JSON.parse(localStorage.getItem(eventKey) || "[]");
      } catch {}
      for (const event of pending) {
        try {
          await post(`/attempts/${id}/presence`, event);
          const current = JSON.parse(localStorage.getItem(eventKey) || "[]");
          localStorage.setItem(
            eventKey,
            JSON.stringify(
              current.filter((e: any) => e.eventId !== event.eventId),
            ),
          );
        } catch {
          return;
        }
      }
    };
    const presence = (action: "leave" | "return") => {
      if (!runningRef.current || finished.current) return;
      const event = {
        action,
        eventId: crypto.randomUUID(),
        at: new Date(Date.now() + timerOffset.current).toISOString(),
      };
      try {
        const pending = JSON.parse(localStorage.getItem(eventKey) || "[]");
        localStorage.setItem(eventKey, JSON.stringify([...pending, event]));
      } catch {}
      const org = localStorage.getItem("assessflow.org");
      void fetch(`/api/attempts/${id}/presence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(org ? { "x-organization-id": org } : {}),
        },
        body: JSON.stringify(event),
        keepalive: true,
      }).catch(() => {});
    };
    const leave = () => presence("leave");
    const visibility = () =>
      presence(document.visibilityState === "hidden" ? "leave" : "return");
    const lost = () => {
      offlineRef.current = true;
      setOffline(true);
    };
    const online = () => {
      void sendEvents();
      void heartbeat();
    };
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
    document.addEventListener("visibilitychange", visibility);
    void sendEvents();
    const timer = setInterval(() => {
      void sendEvents();
      void heartbeat();
    }, 5000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("offline", lost);
      window.removeEventListener("online", online);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("visibilitychange", visibility);
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
      if (["completed", "retry_required", "expired"].includes(r.status)) {
        finished.current = true;
        setDone(true);
        setRetryRequired(r.status !== "completed");
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
  async function begin(videoSession?: string) {
    if (videoRequired && !videoSession) { setCameraRequested(true); return; }
    setBusy(true);
    try {
      const a = await post(`/attempts/${id}/presence`, { action: "begin", videoSession });
      if (videoSession) setCameraAdmitted(true);
      applyLifecycle(a, true);
      opened.current = Date.now();
    } catch (e) {
      if (videoSession) throw e;
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <LoadState
        loading={completion.loading || (!completion.data && !completion.error)}
        error={requestMessage(completion.error)}
      >
        {allDone && !retryRequired ? (
          <AssessmentComplete />
        ) : (
          <Panel>
            <Empty
              icon={
                retryRequired ? (
                  <Clock3 size={30} />
                ) : (
                  <CheckCircle2 size={30} />
                )
              }
              title={
                retryRequired
                  ? t("Необходимо пройти заново", "Қайта өту қажет")
                  : t("Тестирование завершено", "Тестілеу аяқталды")
              }
              description={
                retryRequired
                  ? t(
                      "Недостаточно полностью отвеченных заданий. Этот результат не учитывается в отчётах и аналитике. Если есть ответы, сохранённые без интернета, дождитесь их отправки. Новую попытку можно начать в кабинете.",
                      "Толық жауап берілген тапсырмалар жеткіліксіз. Бұл нәтиже есептер мен талдауға кірмейді. Интернетсіз сақталған жауаптар болса, жіберілгенін күтіңіз. Жаңа әрекетті жеке кабинетте бастауға болады.",
                    )
                  : t(
                      "Ответы сохранены, результаты рассчитаны.",
                      "Жауаптар сақталды, нәтижелер есептелді.",
                    )
              }
              action={
                <Link className="button primary" href="/cabinet">
                  {t("Вернуться в кабинет", "Кабинетке оралу")}
                </Link>
              }
            />
          </Panel>
        )}
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
        data-test-material
        disabled={remaining === 0}
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
                disabled={remaining === 0}
                onClick={() => choose(q, o.id)}
              >
                {o.imageUrl ? (
                  <img src={o.imageUrl} alt={loc(o.text)} />
                ) : (
                  <span className="option-letter">
                    {String.fromCharCode(65 + i)}
                  </span>
                )}
                <span>
                  {q.type === "image"
                    ? t(`Вариант ${i + 1}`, `Нұсқа ${i + 1}`)
                    : loc(o.text)}
                </span>
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
                        remaining === 0
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
    <LoadState
      loading={
        (!data && loading) ||
        Boolean(data && !initialized) ||
        Boolean(
          !remoteData && loading && cachedData && !cachedData.timerStartedAt,
        )
      }
      error={data ? "" : requestMessage(error)}
    >
      {data && (
        <div className="test-workspace">
          <div className="test-topline">
            <Link href="/cabinet" className="text-link">
              <ArrowLeft size={16} />
              {t("Мой кабинет", "Жеке кабинет")}
            </Link>
            <h2>{loc(data.name)}</h2>
          </div>
          {videoRequired && remaining !== 0 && (cameraRequested || running) && (
            <TestCamera attempt={id} ready={begin} timerRunning={running && Boolean(data.timeLimitSeconds)} />
          )}
          {videoRequired && (cameraRequested || running) && !cameraAdmitted ? null : !running ? (
            <Panel>
              <div className="question-panel" data-test-material={p ? true : undefined}>
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
                    <p className="notice">
                      {data.timeLimitSeconds
                        ? t(
                            `Для зачёта необходимо полностью ответить минимум на ${Math.ceil(data.questions.length * 0.8)} из ${data.questions.length} заданий (80%). Иначе тест необходимо пройти заново; результат не попадёт в отчёт и аналитику.`,
                            `Есепке алу үшін ${data.questions.length} тапсырманың кемінде ${Math.ceil(data.questions.length * 0.8)} тапсырмасына (80%) толық жауап беру қажет. Әйтпесе тестті қайта өту керек; нәтиже есеп пен талдауға кірмейді.`,
                          )
                        : t(
                            "Для зачёта необходимо ответить на все задания.",
                            "Есепке алу үшін барлық тапсырмаға жауап беру қажет.",
                          )}
                    </p>
                    {data.questions.length === 49 && (
                      <p>
                        {t(
                          "Пример: «Комфортный и современный офис». Если это немного повышает желание работать, выберите 4; если не влияет — 3.",
                          "Мысал: «Жайлы әрі заманауи кеңсе». Егер бұл жұмыс істеуге деген ынтаны аздап арттырса, 4-ті; әсер етпесе, 3-ті таңдаңыз.",
                        )}
                      </p>
                    )}
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
                            <span>
                              {String.fromCharCode(65 + i)}. {loc(o)}
                            </span>
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
                            className={`answer-option ${trial === i ? "selected" : ""} ${feedback && i === p.correct ? "practice-correct" : ""} ${feedback && trial === i && i !== p.correct ? "practice-incorrect" : ""}`}
                            aria-pressed={trial === i}
                            onClick={() => {
                              setTrial(i);
                              setFeedback(true);
                            }}
                          >
                            {p.images && <img src={p.images[i]} alt={loc(o)} />}
                            <span>
                              {String.fromCharCode(65 + i)}
                              {!p.images && `. ${loc(o)}`}
                              {feedback && i === p.correct && (
                                <> — {t("Правильный ответ", "Дұрыс жауап")}</>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {feedback && (
                      <>
                        <div
                          className="notice info mt practice-feedback"
                          role="status"
                        >
                          {p.correct !== undefined && (
                            <strong>
                              {trial === p.correct
                                ? t("Верно. ", "Дұрыс. ")
                                : t("Неверно. ", "Қате. ")}
                            </strong>
                          )}
                          {p.correct !== undefined && (
                            <strong>
                              {t("Правильный ответ", "Дұрыс жауап")}:{" "}
                              {String.fromCharCode(65 + p.correct)}.{" "}
                            </strong>
                          )}
                          {p.type === "sjt" &&
                            p.correctMost !== undefined &&
                            p.correctLeast !== undefined && (
                              <strong>
                                {trial?.most === p.correctMost &&
                                trial?.least === p.correctLeast
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
                {data.timeLimitSeconds ? (
                  <strong className="test-timer">
                    <Clock3 size={16} />
                    {remaining === null
                      ? t("Синхронизация…", "Синхрондау…")
                      : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}
                  </strong>
                ) : (
                  <span>
                    {t("Без ограничения времени", "Уақыт шектелмеген")}
                  </span>
                )}
              </div>
              {offline && (
                <div className="notice warning">
                  {t(
                    "Нет связи, не закрывайте страницу. Ответы сохраняются на устройстве и отправятся автоматически.",
                    "Байланыс жоқ, бетті жаппаңыз. Жауаптар құрылғыда сақталып, автоматты жіберіледі.",
                  )}
                  {data.timeLimitSeconds &&
                    t(" Таймер продолжает идти.", " Таймер жүріп жатыр.")}
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
                            "Ответы ожидают отправки",
                            "Жауаптар жіберуді күтуде",
                          )
                        : null}
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
                  {requestMessage(message, Object.keys(queue.current).length > 0)}
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
                            "Если полностью отвечено меньше 80% заданий, тест необходимо пройти заново: результат не учитывается. При достижении порога пропущенные вопросы получают 0 баллов. После завершения ответы изменить нельзя.",
                            "Тапсырмалардың 80%-ынан азына толық жауап берілсе, тестті қайта өту қажет: нәтиже есепке алынбайды. Шекке жеткенде өткізіп жіберілген сұрақтарға 0 балл беріледі. Аяқтағаннан кейін жауаптарды өзгерту мүмкін емес.",
                          )
                        : t(
                            "Перед завершением ответьте на все задания опросника.",
                            "Аяқтамас бұрын сауалнаманың барлық тапсырмаларына жауап беріңіз.",
                          )}
                    </p>
                    <Button
                      busy={busy}
                      disabled={
                        !data.timeLimitSeconds &&
                        !data.questions.every((q: any) =>
                          complete(q, answers[q.id]),
                        )
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
