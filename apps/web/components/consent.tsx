"use client";
import { useState, useEffect } from "react";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
} from "../../../packages/core/assessment-policy";
import { Button, Modal, useApp, post, type Locale } from "./ui";
export function ConsentRecord({ member }: { member: any }) {
  const { t, locale } = useApp();
  const [open, setOpen] = useState(false);
  const current =
    member?.consentAt && member?.consentVersion === CONSENT_VERSION;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {t("Согласие на обработку данных", "Деректерді өңдеуге келісім")}
      </Button>
      {open && (
        <Modal
          title={t(
            "Согласие на обработку данных",
            "Деректерді өңдеуге келісім",
          )}
          onClose={() => setOpen(false)}
        >
          <p>
            {current
              ? t("Согласие подтверждено", "Келісім расталды")
              : t(
                  "Актуальное согласие ещё не подтверждено",
                  "Өзекті келісім әлі расталмаған",
                )}
          </p>
          {member?.consentAt && (
            <p>
              {t("Дата подтверждения", "Растау күні")}:{" "}
              {new Date(member.consentAt).toLocaleString(
                locale === "kk" ? "kk-KZ" : "ru-RU",
              )}{" "}
              · {t("Редакция", "Нұсқа")}: {member.consentVersion}
            </p>
          )}
          <p>{CONSENT_TEXT[locale]}</p>
          <small>
            {t("Текущая редакция", "Қазіргі нұсқа")}: {CONSENT_VERSION}
          </small>
        </Modal>
      )}
    </>
  );
}
export function Consent({
  locale,
  onDone,
}: {
  locale: Locale;
  onDone: () => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const t = (ru: string, kk: string) => (locale === "ru" ? ru : kk);
  return (
    <main className="consent-screen">
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post("/me/consent", {
              accepted: true,
              version: CONSENT_VERSION,
            });
            await onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>
          {t("Согласие на обработку данных", "Деректерді өңдеуге келісім")}
        </h1>
        <p>{CONSENT_TEXT[locale]}</p>
        <small>
          {t("Редакция", "Нұсқа")}: {CONSENT_VERSION}
        </small>
        <label className="row">
          <input
            type="checkbox"
            required
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          {t("Я прочитал(а) и согласен(на)", "Оқыдым және келісемін")}
        </label>
        {error && <p role="alert">{error}</p>}
        <Button disabled={!accepted} busy={busy}>
          {t("Принять и продолжить", "Қабылдап, жалғастыру")}
        </Button>
      </form>
    </main>
  );
}
// Pending answer delivery also works after navigating back to the cabinet.
export function AnswerRecovery({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let busy = false,
      cancelled = false;
    const sync = async () => {
      if (busy || !navigator.onLine) return;
      busy = true;
      try {
        for (const key of Object.keys(localStorage).filter((k) =>
          k.startsWith("assessflow.answers."),
        )) {
          if (cancelled) return;
          const id = key.slice("assessflow.answers.".length);
          let pending: any;
          try {
            pending = JSON.parse(localStorage.getItem(key) || "{}");
          } catch {
            continue;
          }
          for (const [questionId, entry] of Object.entries(pending) as [
            string,
            any,
          ][]) {
            if (!entry.answeredAt) continue;
            try {
              await post(`/attempts/${id}/answers`, { questionId, ...entry });
              const current = JSON.parse(localStorage.getItem(key) || "{}");
              if (current[questionId]?.answeredAt === entry.answeredAt) {
                delete current[questionId];
                if (Object.keys(current).length)
                  localStorage.setItem(key, JSON.stringify(current));
                else localStorage.removeItem(key);
              }
            } catch {
              break;
            }
          }
        }
        for (const key of Object.keys(localStorage).filter((k) =>
          k.startsWith("assessflow.presence."),
        )) {
          const id = key.slice("assessflow.presence.".length);
          let events: any[] = [];
          try {
            events = JSON.parse(localStorage.getItem(key) || "[]");
          } catch {
            continue;
          }
          for (const event of events) {
            try {
              await post(`/attempts/${id}/presence`, event);
              const current = JSON.parse(localStorage.getItem(key) || "[]");
              localStorage.setItem(
                key,
                JSON.stringify(
                  current.filter((e: any) => e.eventId !== event.eventId),
                ),
              );
            } catch {
              break;
            }
          }
        }
      } finally {
        busy = false;
      }
    };
    const online = () => void sync(),
      timer = setInterval(online, 5000);
    window.addEventListener("online", online);
    online();
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [enabled]);
  return null;
}
