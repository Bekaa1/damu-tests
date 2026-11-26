"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { cacheParticipantSchedule } from "./offline-session";
import { api, Button, post, type Locale } from "./ui";

export type Schedule = {
  campaignId: string;
  campaign: { name: string };
  scheduledAt: string;
  revision: number;
  acknowledgedAt: string | null;
};

export function ParticipantScheduleFrame({ children, locale, cabinet, initial, membershipId }: {
  children: ReactNode; locale: Locale; cabinet: boolean; initial?: Schedule[]; membershipId: string;
}) {
  const [slots, setSlots] = useState<Schedule[]>(initial ?? []);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const version = useRef(0);
  const saving = useRef(false);
  const remember = useCallback((result: Schedule[]) => {
    setSlots(result);
    try { cacheParticipantSchedule(localStorage, membershipId, result); } catch { /* Storage can be unavailable. */ }
  }, [membershipId]);
  useEffect(() => {
    if (!initial) return;
    async function refresh() {
      if (document.hidden || saving.current) return;
      const current = ++version.current;
      try {
        const result = await api<Schedule[]>("/me/schedule");
        if (current === version.current) remember(result);
      } catch {
        // Keep a visible reminder during a connection interruption.
      }
    }
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      version.current++;
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [initial, remember]);

  async function acknowledge(slot: Schedule) {
    if (saving.current) return;
    saving.current = true;
    const current = ++version.current;
    setBusy(true);
    setFailed(false);
    try {
      const result = await post<Schedule[]>("/me/schedule/acknowledge", {
        campaignId: slot.campaignId, revision: slot.revision,
      });
      if (current === version.current) {
        remember(result);
        setExpanded(false);
      }
    } catch {
      if (current === version.current) setFailed(true);
    } finally {
      saving.current = false;
      if (current === version.current) setBusy(false);
    }
  }

  const pending = slots.find(slot => !slot.acknowledgedAt);
  const visible = Boolean(pending || (cabinet && slots.length));
  const ru = locale === "ru";
  const format = new Intl.DateTimeFormat(ru ? "ru-KZ" : "kk-KZ", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Almaty",
  });
  return (
    <>
      {children}
      {visible && <aside className="schedule-dock" aria-label={ru ? "Мой график" : "Менің кестем"}>
        {pending || expanded ? (
          <div className="schedule-card">
            <span className={"schedule-icon" + (pending ? " unread" : "")}><CalendarClock size={20} aria-hidden="true" /></span>
            <div className="schedule-details" aria-live="polite">
              <strong>{ru ? "Ваше тестирование" : "Сіздің тестілеуіңіз"}</strong>
              {(pending ? [pending] : slots).map(slot => (
                <p key={slot.campaignId}>
                  {slots.length > 1 && <span>{slot.campaign.name} · </span>}
                  <time dateTime={slot.scheduledAt}>{format.format(new Date(slot.scheduledAt))}</time>
                  <small>{ru ? "по времени Казахстана" : "Қазақстан уақытымен"}</small>
                </p>
              ))}
              {failed && pending && <p role="alert">{ru ? "Не удалось сохранить. Попробуйте ещё раз." : "Сақталмады. Қайталап көріңіз."}</p>}
            </div>
            {pending ? (
              <Button busy={busy} onClick={() => void acknowledge(pending)}>{ru ? "График увидел" : "Кестені көрдім"}</Button>
            ) : (
              <Button variant="secondary" onClick={() => setExpanded(false)}>{ru ? "Свернуть" : "Жию"}</Button>
            )}
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setExpanded(true)}><CalendarClock size={16} />{ru ? "Мой график" : "Менің кестем"}</Button>
        )}
      </aside>}
    </>
  );
}
