"use client";
import { useState, useEffect } from "react";
import { videoConsentText, videoConsentVersion } from "../../../packages/core/video-policy";
import { ShieldCheck } from "lucide-react";
import { consentPolicy, hasCurrentConsent } from "../../../packages/core/pilot";
import { Button, Modal, useApp, post, type Locale } from "./ui";
export function ConsentRecord({
  member,
  inSidebar = false,
}: {
  member: any;
  inSidebar?: boolean;
}) {
  const { t, locale, me } = useApp();
  const policy = consentPolicy(me.organization);
  const [open, setOpen] = useState(false);
  const current = hasCurrentConsent(member, me.organization);
  const label = t("Согласие на обработку данных", "Деректерді өңдеуге келісім");
  return (
    <>
      {inSidebar ? (
        <button
          type="button"
          className="nav-item"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <ShieldCheck size={19} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ) : (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}
      {open && (
        <Modal title={label} onClose={() => setOpen(false)}>
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
          <p>{policy.text[locale]}</p>
          {member.videoConsentVersion === videoConsentVersion && member.videoConsentAt &&
            <details><summary>{t("Согласие на видеозапись", "Бейнежазбаға келісім")}</summary>
              <p>{new Date(member.videoConsentAt).toLocaleString(locale === "kk" ? "kk-KZ" : "ru-KZ")} · {videoConsentVersion}</p>
              {videoConsentText[locale].split("\n\n").map((part, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{part}</p>)}
            </details>}
          <small>
            {t("Текущая редакция", "Қазіргі нұсқа")}: {policy.version}
          </small>
        </Modal>
      )}
    </>
  );
}
export function Consent({
  locale,
  onDone,
  organization,
  video = false,
  onLocaleChange,
}: {
  locale: Locale;
  onDone: () => Promise<void>;
  organization?: { purpose?: string; name?: string };
  video?: boolean;
  onLocaleChange: (locale: Locale) => void;
}) {
  const policy = video ? { text: videoConsentText, version: videoConsentVersion } : consentPolicy(organization);
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
          if (!accepted || busy) return;
          setBusy(true);
          try {
            await post(video ? "/me/video-consent" : "/me/consent", {
              locale,
              accepted: true,
              version: policy.version,
            });
            await onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          {t("Язык", "Тіл")}
          <select
            value={locale}
            onChange={(e) => onLocaleChange(e.target.value as Locale)}
          >
            <option value="ru">Русский</option>
            <option value="kk">Қазақша</option>
          </select>
        </label>
        <h1>
          {video ? t("Согласие на видеозапись", "Бейнежазбаға келісім") : organization?.purpose === "pilot"
            ? t("Согласие на участие в пилоте", "Пилотқа қатысуға келісім")
            : t("Согласие на обработку данных", "Деректерді өңдеуге келісім")}
        </h1>
        {organization?.name && (
          <p className="text-muted">{organization.name}</p>
        )}
        {policy.text[locale].split("\n\n").map((paragraph, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{paragraph}</p>)}
        <small>
          {t("Редакция", "Нұсқа")}: {policy.version}
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
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post("/auth/sign-out");
              localStorage.removeItem("assessflow.offline-session");
              window.location.assign("/login");
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {t("Отказаться и выйти", "Бас тартып, шығу")}
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
