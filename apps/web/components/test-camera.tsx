"use client";
import { useEffect, useRef, useState } from "react";
import type { LocalVideoTrack, Room } from "livekit-client";
import { api, Button, isNetworkErrorMessage, post, useApp } from "./ui";

type Connection = {
  room?: Room;
  track?: LocalVideoTrack;
  id?: string;
  closed: boolean;
  health?: ReturnType<typeof setTimeout>;
};
type Token = { url: string; token: string; id: string };
const cameraMessages = {
  offline: [
    "Нет подключения к интернету. Оставьте страницу открытой. Когда связь восстановится, нажмите «Подключить камеру».",
    "Интернет байланысы жоқ. Бетті ашық қалдырыңыз. Байланыс қалпына келгенде «Камераны қосу» түймесін басыңыз.",
  ],
  unreachable: [
    "Не удалось связаться с сервером. Проверьте интернет и нажмите «Подключить камеру» ещё раз.",
    "Серверге қосылу мүмкін болмады. Интернет байланысын тексеріп, «Камераны қосу» түймесін қайта басыңыз.",
  ],
  interrupted: [
    "Видеосвязь прервана. Подключите камеру снова.",
    "Бейнебайланыс үзілді. Камераны қайта қосыңыз.",
  ],
  permission: [
    "Разрешите доступ к камере в настройках браузера.",
    "Браузерде камераға рұқсат беріңіз.",
  ],
  device: [
    "Камера недоступна. Подключите её и закройте другие приложения, использующие камеру.",
    "Камера қолжетімсіз. Оны қосып, камераны пайдаланатын өзге қолданбаларды жабыңыз.",
  ],
} satisfies Record<string, [string, string]>;
type CameraFailure = keyof typeof cameraMessages | { message: string };

function cameraFailure(error: unknown): CameraFailure {
  const { name, message } = error instanceof Error ? error : { name: "", message: "" };
  if (name === "NotAllowedError") return "permission";
  if (name === "NotFoundError" || name === "NotReadableError") return "device";
  if (!navigator.onLine) return "offline";
  if (["ChunkLoadError", "NetworkError", "ConnectionError"].includes(name) ||
      isNetworkErrorMessage(message)) {
    return "unreachable";
  }
  return message ? { message } : "interrupted";
}

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
  timerRunning,
}: {
  attempt: string;
  ready: (id: string) => Promise<void>;
  timerRunning: boolean;
}) {
  const { t } = useApp();
  const [state, setState] = useState<
    "idle" | "connecting" | "recording" | "lost"
  >("idle");
  const [error, setError] = useState<CameraFailure | null>(null);
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
  async function connect(allowH264 = true): Promise<void> {
    if (current.current) close(current.current);
    const c: Connection = { closed: false };
    current.current = c;
    setState("connecting");
    setError(null);
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
      const lost = (failure: CameraFailure) => {
        if (c.closed) return;
        close(c);
        setState("lost");
        setError(failure);
      };
      const disconnected = () => lost(navigator.onLine ? "interrupted" : "offline");
      c.track.mediaStreamTrack.addEventListener("ended", () => lost("device"), { once: true });
      room.on(RoomEvent.Disconnected, disconnected).on(RoomEvent.Reconnecting, disconnected);
      await room.connect(access.url, access.token);
      if (c.closed) {
        close(c);
        return;
      }
      const supportsH264 = allowH264 && RTCRtpSender.getCapabilities?.("video")?.codecs.some(
        (codec) => codec.mimeType.toLowerCase() === "video/h264",
      );
      try {
        await room.localParticipant.publishTrack(c.track, {
          videoCodec: supportsH264 ? "h264" : "vp8",
          backupCodec: false,
          simulcast: false,
          videoEncoding: { maxBitrate: 350000, maxFramerate: 12 },
        });
      } catch (e) {
        if (supportsH264 && !c.closed && room.state === "connected" && navigator.onLine)
          return connect(false);
        throw e;
      }
      const publishedAt = Date.now();
      const until = publishedAt + 70000;
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
                  disconnected();
                  return;
                }
              } catch (e) {
                lost(cameraFailure(e));
                return;
              }
              if (!c.closed) c.health = setTimeout(monitor, 15000);
            }
            c.health = setTimeout(monitor, 15000);
          }
          return;
        }
        if (!["connecting", "starting"].includes(check.state)) break;
        if (supportsH264 && Date.now() - publishedAt >= 15000 && c.track.sender) {
          const stats = await c.track.sender.getStats();
          const streams = Array.from(stats.values()).filter(s => s.type === "outbound-rtp");
          if (!c.closed && streams.length && streams.every(s => s.framesEncoded === 0))
            return connect(false);
        }
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      if (supportsH264 && !c.closed && room.state === "connected" && navigator.onLine)
        return connect(false);
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
      setError(cameraFailure(e));
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
        {error && (
          <p role="alert">
            {typeof error === "string" ? t(...cameraMessages[error]) : error.message}
            {timerRunning && (error === "offline" || error === "unreachable" || error === "interrupted") &&
              " " + t("Таймер теста продолжает идти.", "Тест уақытының есебі жалғасады.")}
          </p>
        )}
        {(state === "idle" || state === "lost") && (
          <Button onClick={() => void connect()}>
            {t("Подключить камеру", "Камераны қосу")}
          </Button>
        )}
      </div>
    </section>
  );
}
