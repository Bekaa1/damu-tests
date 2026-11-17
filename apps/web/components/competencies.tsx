"use client";
import { useState, useEffect } from "react";
import { useApp, useData, post, Panel, Button, Field, LoadState } from "./ui";
import type { CompetencyConfig } from "../../../packages/core/competencies";
export function CompetencyModelEditor({ onSaved }: { onSaved: () => void }) {
  const { t, loc, notify } = useApp(),
    model = useData<any>("/competency-model");
  const [content, setContent] = useState<CompetencyConfig | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (model.data) setContent(structuredClone(model.data.content));
  }, [model.data]);
  const update = () => setContent(content ? structuredClone(content) : null);
  async function save(approve: boolean) {
    if (!content) return;
    setBusy(true);
    try {
      await post("/competency-model", { content, approve });
      await model.refresh();
      onSaved();
      notify(
        t("Модель сохранена новой версией", "Модель жаңа нұсқамен сақталды"),
      );
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title={t(
        "Модель управленческих компетенций",
        "Басқарушылық құзыреттер моделі",
      )}
    >
      <LoadState loading={model.loading} error={model.error}>
        {content && (
          <div className="panel-body form-stack">
            <p className="notice">
              {model.data?.status === "approved"
                ? t("Модель утверждена экспертом", "Модельді сарапшы бекітті")
                : t(
                    "Черновик для согласования с заказчиком: индикаторы, источники и целевые уровни редактируются ниже.",
                    "Тапсырыс берушімен келісуге арналған жоба: индикаторлар, дереккөздер және мақсатты деңгейлер төменде өңделеді.",
                  )}
            </p>
            {content.competencies.map((c) => (
              <details className="competency-config" key={c.id}>
                <summary>{loc(c.name)}</summary>
                <div className="form-stack">
                  <div className="form-grid">
                    {(["ru", "kk"] as const).map((lang) => (
                      <Field key={lang} label={lang.toUpperCase()}>
                        <input
                          value={c.name[lang]}
                          onChange={(e) => {
                            c.name[lang] = e.target.value;
                            update();
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                  {c.indicators.map((i) => (
                    <div className="form-grid" key={i.id}>
                      {(["ru", "kk"] as const).map((lang) => (
                        <Field
                          key={lang}
                          label={`${t("Индикатор", "Индикатор")} · ${lang.toUpperCase()}`}
                        >
                          <textarea
                            rows={2}
                            value={i.text[lang]}
                            onChange={(e) => {
                              i.text[lang] = e.target.value;
                              update();
                            }}
                          />
                        </Field>
                      ))}
                    </div>
                  ))}
                  <div className="row">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={c.indicators.length >= 5}
                      onClick={() => {
                        c.indicators.push({
                          id: `${c.id}-${crypto.randomUUID()}`,
                          text: { ru: "Новый индикатор", kk: "Жаңа индикатор" },
                        });
                        update();
                      }}
                    >
                      {t("Добавить индикатор", "Индикатор қосу")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={c.indicators.length <= 3}
                      onClick={() => {
                        c.indicators.pop();
                        update();
                      }}
                    >
                      {t("Убрать последний", "Соңғысын жою")}
                    </Button>
                  </div>
                  <h3>{t("Связанные источники", "Байланысты дереккөздер")}</h3>
                  <div className="source-options">
                    {[
                      [
                        "test",
                        "verbal",
                        t("Вербальный анализ", "Вербалды талдау"),
                      ],
                      [
                        "test",
                        "numerical",
                        t("Числовой анализ", "Сандық талдау"),
                      ],
                      [
                        "test",
                        "logical",
                        t("Логическое мышление", "Логикалық ойлау"),
                      ],
                      ["test", "personality", t("Личность", "Тұлға")],
                      ["test", "motivation", t("Мотивация", "Мотивация")],
                      [
                        "test",
                        "situations",
                        t("Управленческие ситуации", "Басқарушылық жағдайлар"),
                      ],
                      [
                        "exercise",
                        "roleplay",
                        t("Ролевая игра", "Рөлдік ойын"),
                      ],
                      [
                        "exercise",
                        "group",
                        t("Групповое упражнение", "Топтық жаттығу"),
                      ],
                      [
                        "exercise",
                        "facts",
                        t("Анализ фактов", "Фактілерді талдау"),
                      ],
                      [
                        "exercise",
                        "presentation",
                        t("Презентация", "Таныстырылым"),
                      ],
                      ["exercise", "interview", t("Интервью", "Сұхбат")],
                    ].map(([kind, id, name]) => {
                      const s = c.sources.find(
                        (s) => s.kind === kind && s.id === id,
                      );
                      return (
                        <div key={`${kind}:${id}`}>
                          <label className="row">
                            <input
                              type="checkbox"
                              checked={Boolean(s)}
                              onChange={(e) => {
                                c.sources = e.target.checked
                                  ? [
                                      ...c.sources,
                                      {
                                        kind: kind as "test" | "exercise",
                                        id,
                                        scales: [],
                                      },
                                    ]
                                  : c.sources.filter(
                                      (s) => s.kind !== kind || s.id !== id,
                                    );
                                update();
                              }}
                            />
                            {name}
                          </label>
                          {s?.kind === "test" && (
                            <input
                              aria-label={`${name}: ${t("ID шкал / кейсов через запятую", "Шкала / кейс ID үтір арқылы")}`}
                              placeholder={t(
                                "ID шкал / кейсов через запятую (пусто — весь тест)",
                                "Шкала / кейс ID үтір арқылы (бос — бүкіл тест)",
                              )}
                              value={s.scales.join(", ")}
                              onChange={(e) => {
                                s.scales = e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean);
                                update();
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            ))}
            <h3>{t("Шкала оценки 1–5", "1–5 бағалау шкаласы")}</h3>
            {content.scale.map((s) => (
              <div className="form-grid" key={s.value}>
                {(["ru", "kk"] as const).map((lang) => (
                  <Field
                    key={lang}
                    label={`${s.value} · ${lang.toUpperCase()}`}
                  >
                    <input
                      value={s.description[lang]}
                      onChange={(e) => {
                        s.description[lang] = e.target.value;
                        update();
                      }}
                    />
                  </Field>
                ))}
              </div>
            ))}
            <h3>
              {t(
                "Целевые уровни по должностям",
                "Лауазымдар бойынша мақсатты деңгейлер",
              )}
            </h3>
            {content.roles.map((r) => (
              <div className="form-grid" key={r.id}>
                {(["ru", "kk"] as const).map((lang) => (
                  <Field
                    key={lang}
                    label={`${t("Название должностного профиля", "Лауазымдық бейін атауы")} · ${lang.toUpperCase()}`}
                  >
                    <input
                      value={r.name[lang]}
                      onChange={(e) => {
                        r.name[lang] = e.target.value;
                        update();
                      }}
                    />
                  </Field>
                ))}
              </div>
            ))}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("Компетенция", "Құзырет")}</th>
                    {content.roles.map((r) => (
                      <th key={r.id}>{loc(r.name)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {content.competencies.map((c) => (
                    <tr key={c.id}>
                      <td>{loc(c.name)}</td>
                      {content.roles.map((r) => (
                        <td key={r.id}>
                          <input
                            type="number"
                            min={1}
                            max={5}
                            aria-label={`${loc(c.name)} · ${loc(r.name)}`}
                            value={r.targets[c.id]}
                            onChange={(e) => {
                              r.targets[c.id] = Number(e.target.value);
                              update();
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <Button busy={busy} onClick={() => void save(false)}>
                {t("Сохранить черновик", "Жобаны сақтау")}
              </Button>
              <Button
                variant="secondary"
                busy={busy}
                onClick={() => void save(true)}
              >
                {t(
                  "Утвердить модель и целевые уровни",
                  "Модель мен мақсатты деңгейлерді бекіту",
                )}
              </Button>
            </div>
          </div>
        )}
      </LoadState>
    </Panel>
  );
}
export function CompetencyConsensus({
  id,
  editable,
}: {
  id: string;
  editable: boolean;
}) {
  const { t, loc, campaign, notify } = useApp(),
    evidence = useData<any>(
      campaign
        ? `/participants/${id}/competencies?campaignId=${campaign}`
        : null,
    );
  const [ratings, setRatings] = useState<Record<string, any>>({}),
    [roleId, setRoleId] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (evidence.data) {
      setRatings(
        Object.fromEntries(
          (evidence.data.consensus?.scores?.ratings || []).map((r: any) => [
            r.competencyId,
            r,
          ]),
        ),
      );
      setRoleId(evidence.data.roleId || "");
    }
  }, [evidence.data]);
  const config = evidence.data?.model.content as CompetencyConfig | undefined;
  return (
    <LoadState loading={evidence.loading} error={evidence.error}>
      {config && (
        <Panel
          title={t(
            "Согласование оценок компетенций",
            "Құзырет бағаларын келісу",
          )}
        >
          <form
            className="panel-body form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await post(`/participants/${id}/consensus`, {
                  campaignId: campaign,
                  modelId: evidence.data.model.id,
                  roleId,
                  ratings: config.competencies.map((c) => ({
                    competencyId: c.id,
                    ...ratings[c.id],
                  })),
                });
                await evidence.refresh();
                notify(
                  t(
                    "Итоговые оценки сохранены. Создаётся новая версия отчёта.",
                    "Қорытынды бағалар сақталды. Есептің жаңа нұсқасы жасалуда.",
                  ),
                );
              } catch (e) {
                notify((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {t(
                "Итоговый балл выставляет эксперт по совокупности источников. Оценки разных ассессоров сохраняются отдельно.",
                "Қорытынды балды сарапшы дереккөздер жиынтығы бойынша қояды. Әртүрлі бағалаушылардың бағалары бөлек сақталады.",
              )}
            </p>
            <Field label={t("Должностной профиль", "Лауазымдық бейін")}>
              <select
                required
                disabled={!editable}
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
              >
                <option value="">
                  {t("Выберите профиль", "Бейінді таңдаңыз")}
                </option>
                {config.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {loc(r.name)}
                  </option>
                ))}
              </select>
            </Field>
            {evidence.data.cards.map((c: any) => {
              const rating = ratings[c.id] || {
                value: null,
                reason: "",
                evidenceIds: [],
              };
              const set = (value: any) =>
                setRatings((prev) => ({
                  ...prev,
                  [c.id]: { ...rating, ...value },
                }));
              const selectedMethods = new Set(
                c.sources
                  .filter((s: any) => rating.evidenceIds.includes(s.id))
                  .map((s: any) => s.method),
              ).size;
              return (
                <section className="consensus-card" key={c.id}>
                  <h3>{loc(c.name)}</h3>
                  <p
                    className={
                      selectedMethods < 2 ? "notice warning" : "text-muted"
                    }
                  >
                    {t("Независимых методов", "Тәуелсіз әдістер")}:{" "}
                    {selectedMethods} /{" "}
                    {t("минимум 2; доступно", "кемінде 2; қолжетімді")}{" "}
                    {c.methodCount}
                    {selectedMethods < 2
                      ? ` · ${t("Нужно минимум два", "Кемінде екі әдіс керек")}`
                      : ""}
                  </p>
                  {c.sources.map((s: any) => (
                    <details key={s.id}>
                      <summary>
                        {loc(s.name)}
                        {s.expertName ? ` · ${s.expertName}` : ""}
                      </summary>
                      {s.kind === "test" ? (
                        <p>
                          {s.score.total !== undefined
                            ? `${s.score.total} / ${s.score.maximum}`
                            : Object.values(s.score.scales || {})
                                .map(
                                  (v: any) =>
                                    `${loc(v.name)}: ${v.mean.toFixed(2)}`,
                                )
                                .join(" · ")}
                        </p>
                      ) : (
                        <>
                          <p>{s.notes}</p>
                          {s.scores.map((v: any) => (
                            <p key={v.id}>
                              {v.name}: {v.score}/5 — {v.example}
                            </p>
                          ))}
                        </>
                      )}
                      <label className="row">
                        <input
                          disabled={!editable}
                          type="checkbox"
                          checked={rating.evidenceIds.includes(s.id)}
                          onChange={(e) =>
                            set({
                              evidenceIds: e.target.checked
                                ? [...rating.evidenceIds, s.id]
                                : rating.evidenceIds.filter(
                                    (id: string) => id !== s.id,
                                  ),
                            })
                          }
                        />
                        {t(
                          "Использовать в обосновании",
                          "Негіздемеде пайдалану",
                        )}
                      </label>
                    </details>
                  ))}
                  <div className="form-grid">
                    <Field label={t("Итоговая оценка", "Қорытынды баға")}>
                      <select
                        disabled={!editable}
                        value={rating.value ?? ""}
                        onChange={(e) =>
                          set({
                            value: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                      >
                        <option value="">
                          {t("Не оценено", "Бағаланбаған")}
                        </option>
                        {config.scale.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.value} · {loc(s.description)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label={t(
                        "Обоснование итогового балла",
                        "Қорытынды балдың негіздемесі",
                      )}
                    >
                      <textarea
                        required
                        minLength={10}
                        disabled={!editable}
                        value={rating.reason}
                        onChange={(e) => set({ reason: e.target.value })}
                      />
                    </Field>
                  </div>
                </section>
              );
            })}
            {editable && (
              <Button busy={busy}>
                {t(
                  "Сохранить итоговое согласование",
                  "Қорытынды келісуді сақтау",
                )}
              </Button>
            )}
          </form>
        </Panel>
      )}
    </LoadState>
  );
}
export function AttemptIncidents({
  data,
  onSaved,
}: {
  data: any;
  onSaved: () => void;
}) {
  const { t, loc, me, notify } = useApp(),
    [selected, setSelected] = useState(""),
    [minutes, setMinutes] = useState(5),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Panel
      title={t("Время и качество прохождения", "Тапсыру уақыты мен сапасы")}
    >
      <div className="panel-body form-stack">
        {data.assignments.map((a: any) => {
          const attempt = a.attempts[0];
          return (
            attempt && (
              <div key={a.id} className="consensus-card">
                <strong>{loc(a.testVersion.test.name)}</strong>
                <p>
                  {t("Уходов со страницы", "Беттен кету саны")}:{" "}
                  {attempt.departures} ·{" "}
                  {t("Общее время отсутствия", "Жалпы болмаған уақыт")}:{" "}
                  {Math.round(attempt.awayMs / 1000)} {t("сек", "сек")}
                </p>
                <p>
                  {t("Дедлайн", "Аяқталу мерзімі")}:{" "}
                  {attempt.expiresAt
                    ? new Date(attempt.expiresAt).toLocaleString()
                    : "—"}{" "}
                  · {t("Добавлено", "Қосылды")}: {attempt.extraSeconds / 60}{" "}
                  {t("мин", "мин")}
                </p>
                {me.role !== "expert" &&
                  attempt.timerStartedAt &&
                  !attempt.manuallySubmittedAt && (
                    <Button
                      variant="secondary"
                      onClick={() => setSelected(attempt.id)}
                    >
                      {t("Добавить время", "Уақыт қосу")}
                    </Button>
                  )}
              </div>
            )
          );
        })}
        {selected && (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await post(`/attempts/${selected}/extend`, {
                  seconds: minutes * 60,
                  reason,
                });
                setSelected("");
                setReason("");
                onSaved();
                notify(
                  t(
                    "Время добавлено. Причина записана в журнал.",
                    "Уақыт қосылды. Себеп журналға жазылды.",
                  ),
                );
              } catch (e) {
                notify((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={t("Добавить минут", "Минут қосу")}>
              <input
                required
                type="number"
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </Field>
            <Field label={t("Причина инцидента", "Оқиға себебі")}>
              <textarea
                required
                minLength={10}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button busy={busy}>{t("Добавить время", "Уақыт қосу")}</Button>
          </form>
        )}
        {data.incidents?.length > 0 && (
          <details>
            <summary>{t("Журнал инцидентов", "Оқиғалар журналы")}</summary>
            {data.incidents.map((i: any) => (
              <p key={i.id}>
                {new Date(i.createdAt).toLocaleString()} · {i.detail.reason} · +
                {i.detail.seconds / 60} {t("мин", "мин")}
              </p>
            ))}
          </details>
        )}
      </div>
    </Panel>
  );
}
export function AssessorAssignment({
  id,
  data,
  onSaved,
}: {
  id: string;
  data: any;
  onSaved: () => void;
}) {
  const { t, campaign, me, notify } = useApp(),
    people = useData<any[]>(
      me.role === "expert" ? null : `/people?campaignId=${campaign}`,
    );
  const [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const a = data.assignments[0];
    setIds(
      a?.assessorIds?.length ? a.assessorIds : a?.expertId ? [a.expertId] : [],
    );
  }, [data.assignments]);
  if (me.role === "expert") return null;
  return (
    <Panel title={t("Назначенные ассессоры", "Тағайындалған бағалаушылар")}>
      <div className="panel-body form-stack">
        {people.data
          ?.filter((p) => p.role === "expert")
          .map((p) => (
            <label className="row" key={p.id}>
              <input
                type="checkbox"
                checked={ids.includes(p.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, p.id]
                      : ids.filter((id) => id !== p.id),
                  )
                }
              />
              {p.user.name}
            </label>
          ))}
        <Button
          disabled={!ids.length}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/people/${id}/assessors`, {
                campaignId: campaign,
                expertIds: ids,
              });
              onSaved();
              notify(t("Ассессоры назначены", "Бағалаушылар тағайындалды"));
            } catch (e) {
              notify((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("Сохранить назначения", "Тағайындауларды сақтау")}
        </Button>
      </div>
    </Panel>
  );
}
