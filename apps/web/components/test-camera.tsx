"use client";
import { useEffect, useRef, useState } from "react";
import type { LocalVideoTrack, Room } from "livekit-client";
import { api, Button, post, useApp } from "./ui";

type Connection = {
  room?: Room;
  track?: LocalVideoTrack;
  id?: string;
  closed: boolean;
  health?: ReturnType<typeof setTimeout>;
};
type Token = { url: string; token: string; id: string };
function close(c: Connection) {
  c.closed = true;
  clearTimeout(c.health);
  c.track?.stop();
  c.track?.detach();
  if (c.room) void c.room.disconnect();
  if (c.id) {
    void api("/video/" + c.id + "/close", {
      method: "POST",
      keepalive: true,
      body: "{}",
    }).catch(() => {});
    c.id = undefined;
  }
}

export function TestCamera({
  attempt,
  ready,
}: {
  attempt: string;
  ready: (id: string) => Promise<void>;
}) {
  const { t } = useApp();
  const [state, setState] = useState<
    "idle" | "connecting" | "recording" | "lost"
  >("idle");
  const [error, setError] = useState("");
  const current = useRef<Connection | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const stop = () => {
      if (current.current) close(current.current);
    };
    window.addEventListener("pagehide", stop);
    const restored = () => {
      if (current.current?.closed) setState("lost");
    };
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [attempt]);
  async function connect() {
    if (current.current) close(current.current);
    const c: Connection = { closed: false };
    current.current = c;
    setState("connecting");
    setError("");
    try {
      const { Room, RoomEvent, createLocalVideoTrack } =
        await import("livekit-client");
      if (c.closed) return;
      c.track = await createLocalVideoTrack({
        resolution: { width: 640, height: 360, frameRate: 12 },
        facingMode: "user",
      });
      if (c.closed) {
        close(c);
        return;
      }
      if (preview.current) c.track.attach(preview.current);
      const access = await post<Token>("/attempts/" + attempt + "/camera");
      c.id = access.id;
      if (c.closed) {
        close(c);
        return;
      }
      const room = (c.room = new Room());
      const lost = () => {
        if (c.closed) return;
        close(c);
        setState("lost");
        setError(
          t(
            "Видеосвязь прервана. Подключите камеру снова.",
            "Бейнебайланыс үзілді. Камераны қайта қосыңыз.",
          ),
        );
      };
      c.track.mediaStreamTrack.addEventListener("ended", lost, { once: true });
      room.on(RoomEvent.Disconnected, lost).on(RoomEvent.Reconnecting, lost);
      await room.connect(access.url, access.token);
      if (c.closed) {
        close(c);
        return;
      }
      await room.localParticipant.publishTrack(c.track, {
        videoCodec: "vp8",
        simulcast: false,
        videoEncoding: { maxBitrate: 350000, maxFramerate: 12 },
      });
      const until = Date.now() + 70000;
      while (!c.closed && Date.now() < until) {
        const check = await post<{ state: string }>(
          "/video/" + access.id + "/check",
        );
        if (c.closed) return;
        if (check.state === "recording") {
          await ready(access.id);
          if (!c.closed) {
            setState("recording");
            async function monitor() {
              if (c.closed) return;
              try {
                const status = await post<{ state: string }>(
                  "/video/" + access.id + "/check",
                );
                if (status.state !== "recording") {
                  lost();
                  return;
                }
              } catch {
                lost();
                return;
              }
              if (!c.closed) c.health = setTimeout(monitor, 15000);
            }
            c.health = setTimeout(monitor, 15000);
          }
          return;
        }
        if (!["connecting", "starting"].includes(check.state)) break;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      if (!c.closed)
        throw new Error(
          t(
            "Видеосервер не подтвердил запись. Попробуйте ещё раз.",
            "Бейнесервер жазбаны растамады. Қайта көріңіз.",
          ),
        );
    } catch (e) {
      if (c.closed) return;
      close(c);
      setState("lost");
      const name = (e as Error).name;
      setError(
        name === "NotAllowedError"
          ? t(
              "Разрешите доступ к камере в настройках браузера.",
              "Браузерде камераға рұқсат беріңіз.",
            )
          : name === "NotFoundError" || name === "NotReadableError"
            ? t(
                "Камера недоступна. Подключите её и закройте другие приложения, использующие камеру.",
                "Камера қолжетімсіз. Оны қосып, камераны пайдаланатын өзге қолданбаларды жабыңыз.",
              )
            : (e as Error).message,
      );
    }
  }
  return (
    <section
      className="panel camera-panel"
      aria-label={t("Веб-камера", "Веб-камера")}
    >
      <video
        ref={preview}
        hidden={state !== "recording" && state !== "connecting"}
        muted
        autoPlay
        playsInline
        width={144}
      />
      <div>
        <strong role="status">
          {state === "recording"
            ? t("Идёт видеозапись", "Бейнежазба жүріп жатыр")
            : state === "connecting"
              ? t("Проверяем камеру и запись…", "Камера мен жазба тексерілуде…")
              : t("Подключение камеры", "Камераны қосу")}
        </strong>
        {state !== "recording" && (
          <p>
            {t(
              "Для прохождения теста нужна камера. Записывается только изображение.",
              "Тесттен өту үшін камера қажет. Тек бейне жазылады.",
            )}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {(state === "idle" || state === "lost") && (
          <Button onClick={() => void connect()}>
            {t("Подключить камеру", "Камераны қосу")}
          </Button>
        )}
      </div>
    </section>
  );
}
