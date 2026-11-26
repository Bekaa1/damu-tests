"use client";
import { useEffect, useState } from "react";
import { Button, Field, Panel, useApp, useData } from "./ui";
import type { BrowserObservation } from "../../../packages/core/attempt-journal";

const labels = {
  offline: ["Браузер сообщил о потере сети", "Браузер желі байланысының үзілгенін хабарлады"],
  online: ["Браузер сообщил о восстановлении сети", "Браузер желі байланысының қалпына келгенін хабарлады"],
  no_response: ["Запрос остался без ответа", "Сұрауға жауап келмеді"],
  http_error: ["Получен ответ с ошибкой", "Қате жауабы алынды"],
  request_recovered: ["Запрос снова выполнен успешно", "Сұрау қайтадан сәтті орындалды"],
  copy_blocked: ["Заблокирована команда копирования или вырезания", "Көшіру немесе қиып алу пәрмені бұғатталды"],
  presence: ["Проверка связи", "Байланысты тексеру"],
  answers: ["Сохранение ответа", "Жауапты сақтау"],
  submit: ["Сдача теста", "Тестті аяқтау"],
  camera: ["Подключение камеры", "Камераны қосу"],
  leave: ["Уход со страницы", "Беттен шығу"],
  return: ["Возврат на страницу", "Бетке оралу"],
  "attempt.started": ["Попытка открыта", "Тапсыру беті ашылды"],
  "attempt.timer_started": ["Таймер запущен", "Таймер іске қосылды"],
  "attempt.completed": ["Попытка зачтена", "Тест нәтижесі есепке алынды"],
  "answer.saved": ["Ответ сохранён", "Жауап сақталды"],
  "attempt.insufficient_answers": ["Недостаточно ответов для зачёта", "Тестті есептеу үшін жауаптар жеткіліксіз"],
  "incident.time_added": ["Администратор добавил время", "Әкімші уақыт қосты"],
  "attempt.heartbeat_gap": ["Перерыв между сигналами на сервере", "Серверге келген сигналдар арасындағы үзіліс"],
} satisfies Record<string, [string, string]>;

type Attempt = { id: string; attemptNumber: number; assignment: { testVersion: { test: { name: unknown } } } };
type JournalEvent = { id: string; action: string; createdAt: string; detail: {
  kind?: BrowserObservation["kind"]; operation?: "answers" | "presence" | "submit" | "camera";
  at?: string; previousAt?: string; resumedAt?: string; completedAt?: string; status?: number;
  action?: string; seconds?: number; requestId?: string; question?: number; revision?: number;
} | null };
type Journal = { asOf: string; active: boolean; lastHeartbeatAt: string | null; pendingGapSeconds: number | null; events: JournalEvent[] };

export function AttemptJournal({ attempts, participant }: { attempts: Attempt[]; participant: string }) {
  const { t, loc } = useApp();
  const [selected, setSelected] = useState("");
  const attempt = attempts.find(a => a.id === selected) || attempts[0];
  const title = t("Протокол прохождения", "Тест тапсыру хаттамасы");
  return <Panel title={title}><div className="panel-body form-stack">
    {!attempt ? <p>{t("Попыток пока нет.", "Әзірге тапсыру әрекеттері жоқ.")}</p> : <>
      <Field label={t("Тест и попытка", "Тест және тапсыру реті")}>
        <select value={attempt.id} onChange={e => setSelected(e.target.value)}>
          {attempts.map(a => <option key={a.id} value={a.id}>{loc(a.assignment.testVersion.test.name)} · №{a.attemptNumber}</option>)}
        </select>
      </Field>
      <JournalTable key={attempt.id} attempt={attempt} participant={participant} />
    </>}
  </div></Panel>;
}

function JournalTable({ attempt, participant }: { attempt: Attempt; participant: string }) {
  const { t, loc, locale } = useApp();
  const { data, loading, error, refresh, refreshSilently } = useData<Journal>("/attempts/" + attempt.id + "/journal");
  useEffect(() => {
    if (!data?.active) return;
    const timer = setInterval(() => { if (!document.hidden) void refreshSilently(); }, 15_000);
    return () => clearInterval(timer);
  }, [data?.active, refreshSilently]);
  const formatter = new Intl.DateTimeFormat(locale === "ru" ? "ru-KZ" : "kk-KZ", {
    timeZone: "Asia/Almaty", dateStyle: "short", timeStyle: "medium",
  });
  const headers = [t("Время события", "Оқиға уақыты"), t("Получено сервером", "Серверге келген уақыт"),
    t("Источник", "Дереккөз"), t("Событие", "Оқиға")];
  const rows = (data?.events || []).map(e => {
    const d = e.detail || {};
    const browser = e.action === "attempt.browser_event" || e.action === "attempt.presence";
    const key = (d.kind ?? (e.action === "attempt.presence" ? d.action : e.action)) as keyof typeof labels;
    const parts = [labels[key] ? t(...labels[key]) : key];
    if (d.operation) parts.push(t(...labels[d.operation]));
    if (d.status) parts.push("HTTP " + d.status);
    if (d.requestId) parts.push("ID " + d.requestId);
    if (d.question) parts.push(t("Задание", "Тапсырма") + " №" + d.question);
    if (d.revision) parts.push(t("Последняя версия", "Соңғы нұсқа") + " " + d.revision);
    if (d.previousAt && d.resumedAt) {
      const seconds = Math.round((Date.parse(d.resumedAt) - Date.parse(d.previousAt)) / 1000);
      parts.push(formatter.format(new Date(d.previousAt)) + " → " + formatter.format(new Date(d.resumedAt)) + " (" + seconds + " " + t("с", "с") + ")");
    }
    if (d.seconds) parts.push("+" + d.seconds / 60 + " " + t("мин", "мин"));
    return { id: e.id, at: d.at || d.completedAt || e.createdAt, received: e.createdAt,
      source: browser ? t("Браузер", "Браузер") : t("Сервер", "Сервер"), description: parts.join(" · ") };
  }).sort((a,b) => Date.parse(a.at) - Date.parse(b.at) || Date.parse(a.received) - Date.parse(b.received));
  const download = () => {
    const quote = (s: string) => '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
    if (!data) return;
    const records = [[t("Сотрудник", "Қызметкер"), participant], [t("Тест", "Тест"), loc(attempt.assignment.testVersion.test.name)],
      [t("Попытка", "Тапсыру реті"), String(attempt.attemptNumber), attempt.id],
      [t("Данные на (UTC)", "Деректер уақыты (UTC)"), data.asOf],
      [t("Последний сигнал (UTC)", "Соңғы сигнал (UTC)"), data.lastHeartbeatAt || "—"],
      [headers[0] + " (UTC)", headers[1] + " (UTC)", ...headers.slice(2)],
      ...rows.map(r => [r.at, r.received, r.source, r.description])];
    const file = new Blob(["\uFEFF", records.map(r => r.map(quote).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file), link = document.createElement("a");
    link.href = url; link.download = "AssessFlow-" + attempt.id + ".csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <div className="row"><Button variant="secondary" onClick={refresh} busy={loading}>{t("Обновить", "Жаңарту")}</Button>
      {data && <Button variant="secondary" onClick={download}>{t("Скачать протокол CSV", "Хаттаманы CSV түрінде жүктеу")}</Button>}</div>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p>{t("Время Казахстана (UTC+5). Последний сигнал на сервере", "Қазақстан уақыты (UTC+5). Сервердегі соңғы сигнал")}: {data.lastHeartbeatAt ? formatter.format(new Date(data.lastHeartbeatAt)) : "—"}</p>
      {data.pendingGapSeconds !== null && <p className="notice warning">{t(
        `На ${formatter.format(new Date(data.asOf))} сервер не получал сигнал от этой попытки ${data.pendingGapSeconds} с.`,
        `${formatter.format(new Date(data.asOf))} уақытындағы дерек бойынша сервер осы тапсырудан ${data.pendingGapSeconds} секунд бойы сигнал алған жоқ.`,
      )}</p>}
      <p>{t("Время событий браузера зависит от часов устройства. При потере связи они поступают позже. Перерыв между сигналами сам по себе не указывает причину сбоя.",
        "Браузер оқиғаларының уақыты құрылғы сағатына байланысты. Байланыс үзілсе, олар кейінірек жеткізіледі. Сигналдар арасындағы үзіліс ақаудың себебін өздігінен көрсетпейді.")}</p>
      {rows.length ? <div className="table-wrap"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td>{formatter.format(new Date(r.at))}</td><td>{formatter.format(new Date(r.received))}</td>
          <td>{r.source}</td><td>{r.description}</td></tr>)}</tbody></table></div> : <p>{t("Событий пока нет.", "Әзірге оқиғалар жоқ.")}</p>}
    </>}
  </>;
}
