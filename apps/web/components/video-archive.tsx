"use client";
import { useEffect, useRef, useState } from "react";
import { api, Button, post, useApp } from "./ui";

type Row = {
  id: string;
  name: string;
  test: Record<string, string>;
  state: "ready" | "recording";
  started: string;
  ended?: string;
  expires?: string;
};
function Stream({ id }: { id: string }) {
  const { t } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    async function open() {
      const [{ Room, RoomEvent, Track }, access] = await Promise.all([
        import("livekit-client"),
        post("/video/" + id + "/watch"),
      ]);
      if (cancelled) return;
      const room = new Room();
      stop = () => {
        void room.disconnect();
      };
      room
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (!cancelled && video.current && track.kind === Track.Kind.Video)
            track.attach(video.current);
        })
        .on(RoomEvent.Disconnected, () => {
          if (!cancelled) setError("ended");
        });
      await room.connect(access.url, access.token);
      if (cancelled) stop();
    }
    void open().catch((e: Error) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [id]);
  return (
    <>
      {error && (
        <p role="status">
          {error === "ended" ? t("Эфир завершён", "Эфир аяқталды") : error}
        </p>
      )}
      <video
        ref={video}
        muted
        playsInline
        autoPlay
        controls
        style={{ width: "100%", maxWidth: 640, background: "#142631" }}
      />
    </>
  );
}
export function VideoArchive() {
  const { me, t, loc, locale, campaign } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await api<Row[]>(
          "/video?campaignId=" + encodeURIComponent(campaign),
        );
        if (!closed) {
          setRows(data);
          setError("");
          setSelected((id) =>
            data.some((r) => r.id === id && r.state === "recording") ? id : "",
          );
        }
      } catch (e) {
        if (!closed) setError((e as Error).message);
      } finally {
        if (!closed) {
          setLoading(false);
          timer = setTimeout(refresh, 5000);
        }
      }
    }
    void refresh();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [campaign]);
  const date = (value: string) =>
    new Date(value).toLocaleString(locale === "ru" ? "ru-KZ" : "kk-KZ");
  return (
    <div className="stack">
      <h1>{t("Видеозаписи тестов", "Тест бейнежазбалары")}</h1>
      {error && <p role="alert">{error}</p>}
      {selected && (
        <section className="panel stack">
          <h2>{rows.find((r) => r.id === selected)?.name}</h2>
          <Stream key={selected} id={selected} />
          <Button variant="secondary" onClick={() => setSelected("")}>
            {t("Закрыть эфир", "Эфирді жабу")}
          </Button>
        </section>
      )}
      <section className="panel">
        {loading ? (
          <p>{t("Загрузка…", "Жүктелуде…")}</p>
        ) : !rows.length ? (
          <p>
            {t(
              "В этой кампании пока нет видеозаписей.",
              "Бұл науқанда әзірге бейнежазбалар жоқ.",
            )}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  {[
                    t("Участник", "Қатысушы"),
                    t("Тест", "Тест"),
                    t("Начало", "Басталуы"),
                    t("Хранится до", "Сақтау мерзімі"),
                    t("Видео", "Бейне"),
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{loc(r.test)}</td>
                    <td>{date(r.started)}</td>
                    <td>{r.expires ? date(r.expires) : "—"}</td>
                    <td>
                      {r.state === "recording" ? (
                        <Button onClick={() => setSelected(r.id)}>
                          {t("Смотреть эфир", "Эфирді көру")}
                        </Button>
                      ) : (
                        <a
                          className="text-link"
                          href={
                            "/api/video/" +
                            r.id +
                            "/download?organization=" +
                            encodeURIComponent(me.organization.id)
                          }
                          download
                        >
                          {t("Скачать запись", "Жазбаны жүктеу")}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
