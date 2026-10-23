"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Save,
  CheckCircle2,
  Plus,
  Trash2,
  PenLine,
  Info,
  ShieldCheck,
  Sparkles,
  Copy,
  Upload,
  Settings,
  Building2,
  KeyRound,
  Lock,
  FileText,
  RefreshCw,
} from "lucide-react";
import {
  useApp,
  useData,
  api,
  post,
  patch,
  download,
  Button,
  PageTitle,
  Panel,
  Badge,
  Avatar,
  Progress,
  LoadState,
  Empty,
  Modal,
  Field,
  date,
} from "./ui";
import { AddPerson } from "./organization";
export function Participant({ id }: { id: string }) {
  const router = useRouter();
  const [removeOpen, setRemoveOpen] = useState(false),
    [confirmEmail, setConfirmEmail] = useState("");
  const { t, loc, campaign, me, notify } = useApp();
  const { data, loading, error, refresh } = useData<any>(
    campaign ? `/people/${id}?campaignId=${campaign}` : null,
  );
  const exercises = useData<any[]>("/exercises");
  const [tab, setTab] = useState("results"),
    [busy, setBusy] = useState(false),
    [credentials, setCredentials] = useState("");
  const editable = me.role === "expert" || me.role === "superadmin";
  return (
    <>
      <Link href="/people" className="text-link" style={{ marginBottom: 22 }}>
        <ArrowLeft size={13} />
        {t("Все сотрудники", "Барлық қызметкерлер")}
      </Link>
      <LoadState loading={loading} error={error}>
        {data && (
          <>
            <div className="page-title">
              <div className="profile-header">
                <Avatar name={data.member.user.name} size="large" />
                <div>
                  <h1>{data.member.user.name}</h1>
                  <p>
                    {data.member.position} · {data.member.unit}
                  </p>
                  <small className="text-muted">{data.member.user.email}</small>
                </div>
              </div>
              <div className="page-actions">
                {me.role !== "expert" && (
                  <Button
                    variant="secondary"
                    busy={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await post(`/people/${id}/reset-password`);
                        setCredentials(r.temporaryPassword);
                      } catch (e) {
                        notify((e as Error).message, "error");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <KeyRound size={14} />
                    {t("Новый пароль", "Жаңа құпиясөз")}
                  </Button>
                )}
                {me.role !== "expert" && (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        download(
                          `/people/${id}/data`,
                          "personal-data.json",
                        ).catch((e) => notify(e.message, "error"))
                      }
                    >
                      {t("Экспорт данных", "Деректерді экспорттау")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setRemoveOpen(true)}
                      aria-label={t(
                        "Удалить данные сотрудника",
                        "Қызметкер деректерін жою",
                      )}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </>
                )}
                {data.reports[0] && (
                  <Button
                    onClick={() =>
                      download(
                        `/reports/${data.reports[0].id}/pdf`,
                        "report.pdf",
                      ).catch((e) => notify(e.message, "error"))
                    }
                  >
                    <Download size={15} />
                    PDF
                  </Button>
                )}
              </div>
            </div>
            <div className="tabs">
              {[
                ["results", t("Результаты тестов", "Тест нәтижелері")],
                ["ai", t("AI-анализ", "AI-талдау")],
                ["exercises", t("Практическая оценка", "Практикалық бағалау")],
                [
                  "report",
                  t(
                    "Заключение и план развития",
                    "Қорытынды және даму жоспары",
                  ),
                ],
                ["history", t("История", "Тарих")],
              ].map(([key, label]) => (
                <button
                  className={tab === key ? "active" : ""}
                  key={key}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {removeOpen && (
              <Modal
                title={t(
                  "Удаление данных сотрудника",
                  "Қызметкер деректерін жою",
                )}
                onClose={() => setRemoveOpen(false)}
              >
                <div className="modal-body form-stack">
                  <p>
                    {t(
                      "Будут удалены ответы, результаты, отчёты и материалы сотрудника во всех кампаниях организации. Действие необратимо. Для подтверждения введите email сотрудника.",
                      "Ұйымның барлық науқандарындағы қызметкердің жауаптары, нәтижелері, есептері мен материалдары жойылады. Әрекетті кері қайтару мүмкін емес. Растау үшін қызметкердің email мекенжайын енгізіңіз.",
                    )}
                  </p>
                  <Field label="Email">
                    <input
                      type="email"
                      value={confirmEmail}
                      onChange={(e) => setConfirmEmail(e.target.value)}
                    />
                  </Field>
                  <Button
                    variant="danger"
                    busy={busy}
                    disabled={confirmEmail !== data.member.user.email}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(`/people/${id}`, {
                          method: "DELETE",
                          body: JSON.stringify({ confirmEmail }),
                        });
                        notify(t("Данные удалены", "Деректер жойылды"));
                        router.push("/people");
                      } catch (e) {
                        notify((e as Error).message, "error");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("Удалить данные", "Деректерді жою")}
                  </Button>
                </div>
              </Modal>
            )}
            {tab === "results" && (
              <div className="stack">
                <div className="notice">
                  <Info size={18} />
                  {t(
                    "Показаны первичные баллы. Высокое значение личностной шкалы не означает лучший результат.",
                    "Бастапқы балдар көрсетілген. Тұлғалық шкаланың жоғары мәні жақсы нәтиже дегенді білдірмейді.",
                  )}
                </div>
                {data.assignments.map((a: any) => {
                  const r = a.attempts[0]?.results[0],
                    s = r?.result;
                  return (
                    <Panel
                      key={a.id}
                      title={loc(a.testVersion.test.name)}
                      description={`${t("Версия", "Нұсқа")} ${a.testVersion.version}`}
                      action={
                        <Badge
                          status={a.attempts[0]?.status || "not_started"}
                        />
                      }
                    >
                      <div className="panel-body">
                        {!s ? (
                          <p className="text-muted text-small">
                            {t(
                              "Результаты появятся после завершения теста.",
                              "Нәтижелер тест аяқталғаннан кейін көрсетіледі.",
                            )}
                          </p>
                        ) : s.scales ? (
                          <>
                            <div className="score-list" style={{ padding: 0 }}>
                              {Object.entries(s.scales)
                                .filter(
                                  ([k]) =>
                                    k.length === 1 ||
                                    a.testVersion.testId === "motivation",
                                )
                                .map(([key, v]: [string, any]) => (
                                  <div className="score-row" key={key}>
                                    <span>{loc(v.name)}</span>
                                    <Progress
                                      value={
                                        ((v.mean - v.min) / (v.max - v.min)) *
                                        100
                                      }
                                    />
                                    <strong>
                                      {v.mean.toFixed(2)} / {v.max}
                                    </strong>
                                  </div>
                                ))}
                            </div>
                            {a.testVersion.testId === "personality" && (
                              <details className="mt">
                                <summary className="text-link">
                                  {t(
                                    "Показать 30 дополнительных характеристик",
                                    "30 қосымша сипаттаманы көрсету",
                                  )}
                                </summary>
                                <div className="score-list mt">
                                  {Object.entries(s.scales)
                                    .filter(([k]) => k.length > 1)
                                    .map(([k, v]: [string, any]) => (
                                      <div className="score-row" key={k}>
                                        <span>{loc(v.name)}</span>
                                        <Progress
                                          value={
                                            ((v.mean - v.min) /
                                              (v.max - v.min)) *
                                            100
                                          }
                                        />
                                        <strong>{v.mean.toFixed(2)}</strong>
                                      </div>
                                    ))}
                                </div>
                              </details>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="row between">
                              <div>
                                <strong
                                  style={{ fontSize: 29, fontWeight: 550 }}
                                >
                                  {s.total}{" "}
                                  <span
                                    style={{ color: "#9ca9b1", fontSize: 19 }}
                                  >
                                    / {s.maximum}
                                  </span>
                                </strong>
                                <p className="text-small text-muted">
                                  {s.algorithm === "sjt"
                                    ? t(
                                        "Индекс совпадения выбора",
                                        "Таңдау сәйкестік индексі",
                                      )
                                    : t("Правильные ответы", "Дұрыс жауаптар")}
                                </p>
                              </div>
                              <div>
                                <strong
                                  style={{ fontSize: 24, color: "#5c8273" }}
                                >
                                  {s.percent.toFixed(1)}%
                                </strong>
                                <p className="text-small text-muted">
                                  {t(
                                    "Доля, не процентиль",
                                    "Үлес, процентиль емес",
                                  )}
                                </p>
                              </div>
                            </div>
                            {s.algorithm === "sjt" && (
                              <div className="table-wrap mt">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>{t("СИТУАЦИЯ", "ЖАҒДАЙ")}</th>
                                      <th>MOST</th>
                                      <th>LEAST</th>
                                      <th>{t("БАЛЛЫ", "БАЛДАР")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.details.map((d: any, i: number) => (
                                      <tr key={d.questionId}>
                                        <td>{i + 1}</td>
                                        <td>
                                          {d.mostMatch ? "✓" : "—"}{" "}
                                          {d.value.most.split("-").at(-1)}
                                        </td>
                                        <td>
                                          {d.leastMatch ? "✓" : "—"}{" "}
                                          {d.value.least.split("-").at(-1)}
                                        </td>
                                        <td>{d.score} / 2</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        )}
                        <p className="text-small text-muted mt">
                          {loc(a.testVersion.limitations)}
                        </p>
                        {me.role === "superadmin" &&
                          a.attempts[0]?.status === "completed" && (
                            <Button
                              variant="ghost"
                              onClick={async () => {
                                try {
                                  const keys = await api(
                                    `/platform/tests/${a.testVersionId}`,
                                  );
                                  await post(
                                    `/attempts/${a.attempts[0].id}/recalculate`,
                                    { keyId: keys.keys[0].id },
                                  );
                                  refresh();
                                  notify(
                                    t(
                                      "Расчёт сохранён отдельной версией",
                                      "Есептеу бөлек нұсқа ретінде сақталды",
                                    ),
                                  );
                                } catch (e) {
                                  notify((e as Error).message, "error");
                                }
                              }}
                            >
                              <RefreshCw size={14} />
                              {t(
                                "Пересчитать по последнему ключу",
                                "Соңғы кілт бойынша қайта есептеу",
                              )}
                            </Button>
                          )}
                      </div>
                    </Panel>
                  );
                })}
              </div>
            )}
            {tab === "ai" && (
              <Panel
                title={t("Предварительный AI-анализ", "Алдын ала AI-талдау")}
                action={
                  <Button
                    variant="secondary"
                    busy={busy}
                    disabled={!data.allDone}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await post("/ai/generate", {
                          membershipId: id,
                          campaignId: campaign,
                        });
                        notify(
                          r.status === "awaiting_configuration"
                            ? t(
                                "Для генерации подключите OpenRouter в настройках платформы",
                                "Генерация үшін платформа баптауларында OpenRouter қосыңыз",
                              )
                            : t(
                                "Генерация поставлена в очередь",
                                "Генерация кезекке қойылды",
                              ),
                        );
                        refresh();
                      } catch (e) {
                        notify((e as Error).message, "error");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Sparkles size={15} />
                    {t("Сформировать анализ", "Талдау жасау")}
                  </Button>
                }
              >
                <div className="panel-body">
                  {data.ai?.[0]?.status === "completed" ? (
                    <div className="stack">
                      {Object.entries(data.ai[0].content).map(
                        ([section, items]: [string, any]) => (
                          <section key={section}>
                            <h3>
                              {
                                (
                                  {
                                    generalProfile: t(
                                      "Общий профиль",
                                      "Жалпы бейін",
                                    ),
                                    analyticalAbilities: t(
                                      "Аналитические способности",
                                      "Талдау қабілеттері",
                                    ),
                                    personality: t(
                                      "Личностные характеристики",
                                      "Тұлғалық сипаттамалар",
                                    ),
                                    motivation: t("Мотивация", "Мотивация"),
                                    situations: t(
                                      "Управленческие ситуации",
                                      "Басқарушылық жағдайлар",
                                    ),
                                    strengths: t(
                                      "Сильные стороны",
                                      "Күшті жақтар",
                                    ),
                                    developmentAreas: t(
                                      "Зоны развития",
                                      "Даму бағыттары",
                                    ),
                                    recommendations: t(
                                      "Рекомендации",
                                      "Ұсыныстар",
                                    ),
                                    limitations: t("Ограничения", "Шектеулер"),
                                  } as any
                                )[section]
                              }
                            </h3>
                            {items.map((p: any, i: number) => (
                              <div key={i}>
                                <p className="report-text">
                                  {typeof p === "string" ? p : p.text}
                                </p>
                              </div>
                            ))}
                          </section>
                        ),
                      )}
                    </div>
                  ) : (
                    <Empty
                      icon={<Sparkles size={26} />}
                      title={t(
                        "AI-анализ пока не сформирован",
                        "AI-талдау әлі жасалмады",
                      )}
                      description={
                        !data.allDone
                          ? t(
                              "Сначала нужно завершить все назначенные тесты.",
                              "Алдымен барлық тағайындалған тесттерді аяқтау қажет.",
                            )
                          : t(
                              "После подключения ключа OpenRouter анализ можно сформировать по уже сохранённым результатам.",
                              "OpenRouter кілтін қосқаннан кейін сақталған нәтижелер бойынша талдау жасауға болады.",
                            )
                      }
                    />
                  )}
                  <div className="notice warning mt">
                    {t(
                      "AI-анализ является предварительным. Итоговое заключение составляет и утверждает эксперт.",
                      "AI-талдау алдын ала болып табылады. Қорытындыны сарапшы жасап, бекітеді.",
                    )}
                  </div>
                </div>
              </Panel>
            )}
            {tab === "exercises" && (
              <ObservationEditor
                memberId={id}
                data={data}
                exercises={exercises.data || []}
                editable={editable}
                onSaved={refresh}
              />
            )}
            {tab === "report" && (
              <ReportEditor
                memberId={id}
                data={data}
                editable={editable}
                onSaved={refresh}
              />
            )}
            {tab === "history" && (
              <Panel
                title={t(
                  "Версии заключений и наблюдений",
                  "Қорытындылар мен бақылаулар нұсқалары",
                )}
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("ДОКУМЕНТ", "ҚҰЖАТ")}</th>
                        <th>{t("ДАТА", "КҮНІ")}</th>
                        <th>{t("СТАТУС", "МӘРТЕБЕ")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.reports.map((r: any) => (
                        <tr key={r.id}>
                          <td>
                            {t("Заключение", "Қорытынды")} v{r.version}
                          </td>
                          <td>{date(r.createdAt)}</td>
                          <td>
                            <Badge status={r.status} />
                          </td>
                          <td>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                download(
                                  `/reports/${r.id}/pdf`,
                                  "report.pdf",
                                ).catch((e) => notify(e.message, "error"))
                              }
                            >
                              <Download size={14} />
                              PDF
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {data.observations.map((o: any) => (
                        <tr key={o.id}>
                          <td>
                            {loc(o.criteriaSnapshot.name)} · v{o.version}
                          </td>
                          <td>{date(o.createdAt)}</td>
                          <td>{t("Наблюдение", "Бақылау")}</td>
                          <td />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </>
        )}
      </LoadState>
      {credentials && (
        <Modal
          title={t("Новый временный пароль", "Жаңа уақытша құпиясөз")}
          onClose={() => setCredentials("")}
        >
          <div className="modal-body form-stack">
            <div className="credential-box">
              <code>{credentials}</code>
              <small>
                {t(
                  "Предыдущие сеансы завершены. Передайте пароль сотруднику.",
                  "Алдыңғы сеанстар аяқталды. Құпиясөзді қызметкерге беріңіз.",
                )}
              </small>
            </div>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(credentials);
                notify(t("Скопировано", "Көшірілді"));
              }}
            >
              <Copy size={15} />
              {t("Скопировать", "Көшіру")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ObservationEditor({
  memberId,
  data,
  exercises,
  editable,
  onSaved,
}: {
  memberId: string;
  data: any;
  exercises: any[];
  editable: boolean;
  onSaved: () => void;
}) {
  const { t, loc, campaign, notify } = useApp();
  const [exerciseId, setExerciseId] = useState(""),
    [scores, setScores] = useState<Record<string, number | null>>({}),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false);
  const exercise = exercises.find((e) => e.id === exerciseId);
  useEffect(() => {
    if (exercises.length && !exerciseId) setExerciseId(exercises[0].id);
  }, [exercises, exerciseId]);
  useEffect(() => {
    const previous = data.observations.find(
      (o: any) => o.exerciseId === exerciseId,
    );
    setScores(previous?.scores || {});
    setNotes(previous?.notes || "");
  }, [exerciseId, data.observations]);
  return (
    <div className="detail-grid">
      <Panel
        title={t(
          "Наблюдения и поведенческие индикаторы",
          "Бақылаулар мен мінез-құлық индикаторлары",
        )}
      >
        <form
          className="panel-body form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await post("/observations", {
                campaignId: campaign,
                membershipId: memberId,
                exerciseId,
                scores,
                notes,
              });
              notify(t("Наблюдение сохранено", "Бақылау сақталды"));
              onSaved();
            } catch (e) {
              notify((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={t("Практическое упражнение", "Практикалық жаттығу")}>
            <select
              value={exerciseId}
              onChange={(e) => setExerciseId(e.target.value)}
            >
              {exercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {loc(e.name)}
                </option>
              ))}
            </select>
          </Field>
          {exercise?.criteria.map((c: any) => (
            <div className="criterion-block" key={c.id}>
              <h3>{c.name}</h3>
              <ul>
                {c.indicators.map((i: string, n: number) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
              <div className="score-buttons">
                {c.scale.map((s: any) => (
                  <button
                    type="button"
                    disabled={!editable}
                    title={s.description}
                    aria-label={`${s.value}: ${s.description}`}
                    aria-pressed={scores[c.id] === s.value}
                    className={scores[c.id] === s.value ? "selected" : ""}
                    key={s.value}
                    onClick={() => setScores({ ...scores, [c.id]: s.value })}
                  >
                    {s.value}
                  </button>
                ))}
                {c.allowNotObserved && (
                  <button
                    type="button"
                    disabled={!editable}
                    className={scores[c.id] === null ? "selected" : ""}
                    onClick={() => setScores({ ...scores, [c.id]: null })}
                  >
                    {t("Не наблюдалось", "Бақыланбады")}
                  </button>
                )}
              </div>
              <p className="text-small text-muted mt">
                {scores[c.id] === null
                  ? t(
                      "Исключается из расчётов, не является нулём.",
                      "Есептеуден шығарылады, нөл болып саналмайды.",
                    )
                  : c.scale.find((s: any) => s.value === scores[c.id])
                      ?.description}
              </p>
            </div>
          ))}
          <Field
            label={t(
              "Примеры наблюдаемого поведения",
              "Бақыланған мінез-құлық мысалдары",
            )}
            hint={t(
              "Фиксируйте конкретные действия и контекст.",
              "Нақты әрекеттер мен контексті жазыңыз.",
            )}
          >
            <textarea
              rows={5}
              required
              minLength={10}
              disabled={!editable}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {editable && (
            <Button busy={busy}>
              <Save size={16} />
              {t("Сохранить наблюдение", "Бақылауды сақтау")}
            </Button>
          )}
        </form>
      </Panel>
      <Panel title={t("Материалы участника", "Қатысушы материалдары")}>
        <div className="panel-body form-stack">
          <p className="text-small text-muted">
            {t(
              "PDF, DOCX, PNG или JPEG. До 8 МБ. Файлы доступны уполномоченным сотрудникам организации.",
              "PDF, DOCX, PNG немесе JPEG. 8 МБ дейін. Файлдар ұйымның уәкілетті қызметкерлеріне қолжетімді.",
            )}
          </p>
          {data.files.map((f: any) => (
            <button
              className="btn secondary"
              key={f.id}
              onClick={() =>
                download(`/files/${f.id}`, f.name).catch((e) =>
                  notify(e.message, "error"),
                )
              }
            >
              <FileText size={15} />
              {f.name}
              <Download size={14} />
            </button>
          ))}
          {editable && (
            <Field label={t("Прикрепить материал", "Материал тіркеу")}>
              <input
                type="file"
                accept=".pdf,.docx,.png,.jpg,.jpeg"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    if (f.size > 8 * 1024 * 1024)
                      throw new Error("Максимум 8 МБ");
                    const reader = new FileReader();
                    const base64 = await new Promise<string>(
                      (resolve, reject) => {
                        reader.onload = () =>
                          resolve(String(reader.result).split(",")[1]);
                        reader.onerror = reject;
                        reader.readAsDataURL(f);
                      },
                    );
                    await post("/files", {
                      campaignId: campaign,
                      membershipId: memberId,
                      name: f.name,
                      contentType: f.type,
                      base64,
                    });
                    onSaved();
                    notify(t("Материал загружен", "Материал жүктелді"));
                  } catch (e) {
                    notify((e as Error).message, "error");
                  }
                }}
              />
            </Field>
          )}
        </div>
      </Panel>
    </div>
  );
}
function ReportEditor({
  memberId,
  data,
  editable,
  onSaved,
}: {
  memberId: string;
  data: any;
  editable: boolean;
  onSaved: () => void;
}) {
  const { t, loc, campaign, me, notify } = useApp();
  const latest = data.reports[0];
  const [content, setContent] = useState<any>({
      conclusion: "",
      strengths: "",
      development: "",
      risks: "",
      recommendations: "",
      developmentPlan: [{ goal: "", action: "", deadline: "", success: "" }],
    }),
    [x, setX] = useState(""),
    [y, setY] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (latest) {
      setContent(latest.content);
      setX(String(latest.matrixX || ""));
      setY(String(latest.matrixY || ""));
      setReason(latest.matrixReason || "");
    }
  }, [latest]);
  const save = async (approve: boolean) => {
    setBusy(true);
    try {
      await post("/reports", {
        campaignId: campaign,
        membershipId: memberId,
        content,
        matrixX: Number(x),
        matrixY: Number(y),
        matrixReason: reason,
        approve,
      });
      notify(
        t(
          approve ? "Заключение утверждено" : "Сохранена новая версия",
          approve ? "Қорытынды бекітілді" : "Жаңа нұсқа сақталды",
        ),
      );
      onSaved();
      setConfirm(false);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="notice">
        <ShieldCheck size={18} />
        {t(
          "Изменения сохраняются новой версией. Утверждённые заключения остаются в истории.",
          "Өзгерістер жаңа нұсқа ретінде сақталады. Бекітілген қорытындылар тарихта қалады.",
        )}
      </div>
      <Panel
        title={t("Экспертное заключение", "Сараптамалық қорытынды")}
        action={latest ? <Badge status={latest.status} /> : undefined}
      >
        <div className="panel-body form-stack">
          {[
            [
              "conclusion",
              t("Интегрированное заключение", "Біріктірілген қорытынды"),
            ],
            [
              "strengths",
              t("Сильные стороны и основания", "Күшті жақтар және негіздер"),
            ],
            ["development", t("Зоны развития", "Даму бағыттары")],
            ["risks", t("Риски и ограничения", "Тәуекелдер мен шектеулер")],
            [
              "recommendations",
              t("Практические рекомендации", "Практикалық ұсыныстар"),
            ],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <textarea
                rows={key === "conclusion" ? 5 : 3}
                disabled={!editable}
                value={content[key]}
                onChange={(e) =>
                  setContent({ ...content, [key]: e.target.value })
                }
              />
            </Field>
          ))}
        </div>
      </Panel>
      <Panel title={t("Матрица потенциала 9-box", "9-box әлеует матрицасы")}>
        <div className="panel-body form-stack">
          <div className="form-grid">
            {[
              ["x", loc(me.organization.matrixConfig.x)],
              ["y", loc(me.organization.matrixConfig.y)],
            ].map(([axis, label]) => (
              <Field key={axis} label={label}>
                <select
                  disabled={!editable}
                  value={axis === "x" ? x : y}
                  onChange={(e) => (axis === "x" ? setX : setY)(e.target.value)}
                >
                  <option value="">
                    {t("Выберите уровень", "Деңгейді таңдаңыз")}
                  </option>
                  {me.organization.matrixConfig.levels.map(
                    (l: any, i: number) => (
                      <option key={i} value={i + 1}>
                        {loc(l)}
                      </option>
                    ),
                  )}
                </select>
              </Field>
            ))}
          </div>
          <Field
            label={t("Обязательное обоснование", "Міндетті негіздеме")}
            hint={t(
              "Укажите конкретные данные тестов, интервью и упражнений.",
              "Тесттер, сұхбат және жаттығулардың нақты деректерін көрсетіңіз.",
            )}
          >
            <textarea
              rows={4}
              disabled={!editable}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </div>
      </Panel>
      <Panel title={t("Индивидуальный план развития", "Жеке даму жоспары")}>
        <div className="panel-body form-stack">
          {content.developmentPlan.map((p: any, i: number) => (
            <div className="form-grid" key={i}>
              {[
                ["goal", t("Цель", "Мақсат")],
                ["action", t("Действие", "Әрекет")],
                ["deadline", t("Срок", "Мерзім")],
                ["success", t("Критерий результата", "Нәтиже критерийі")],
              ].map(([k, l]) => (
                <Field key={k} label={l}>
                  <input
                    disabled={!editable}
                    value={p[k]}
                    onChange={(e) =>
                      setContent({
                        ...content,
                        developmentPlan: content.developmentPlan.map(
                          (a: any, j: number) =>
                            j === i ? { ...a, [k]: e.target.value } : a,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          ))}
          {editable && (
            <Button
              variant="secondary"
              onClick={() =>
                setContent({
                  ...content,
                  developmentPlan: [
                    ...content.developmentPlan,
                    { goal: "", action: "", deadline: "", success: "" },
                  ],
                })
              }
            >
              <Plus size={15} />
              {t("Добавить цель", "Мақсат қосу")}
            </Button>
          )}
        </div>
      </Panel>
      {editable && (
        <div className="form-actions">
          <Button busy={busy} variant="secondary" onClick={() => save(false)}>
            <Save size={15} />
            {t("Сохранить черновик", "Жобаны сақтау")}
          </Button>
          <Button
            disabled={!data.allDone || busy}
            onClick={() => setConfirm(true)}
          >
            <CheckCircle2 size={16} />
            {t("Утвердить заключение", "Қорытындыны бекіту")}
          </Button>
        </div>
      )}
      {confirm && (
        <Modal
          title={t("Утверждение заключения", "Қорытындыны бекіту")}
          onClose={() => setConfirm(false)}
        >
          <div className="modal-body form-stack">
            <p>
              {t(
                "Вы подтверждаете, что проверили результаты, основания выводов и ограничения методик. Будет сохранена новая утверждённая версия отчёта.",
                "Нәтижелерді, қорытынды негіздерін және әдістеме шектеулерін тексергеніңізді растайсыз. Есептің жаңа бекітілген нұсқасы сақталады.",
              )}
            </p>
            <Button busy={busy} onClick={() => save(true)}>
              {t("Подтвердить утверждение", "Бекітуді растау")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function Criteria() {
  const { t, loc, notify } = useApp();
  const { data, loading, error, refresh } = useData<any[]>("/exercises");
  const [selected, setSelected] = useState<any>(null);
  return (
    <>
      <PageTitle
        title={t("Конструктор критериев", "Критерийлер конструкторы")}
        description={t(
          "Компетенции, наблюдаемое поведение и шкалы практических упражнений.",
          "Құзыреттер, бақыланатын мінез-құлық және практикалық жаттығу шкалалары.",
        )}
      />
      <div className="notice warning" style={{ marginBottom: 24 }}>
        <Info size={18} />
        {t(
          "Начальные критерии являются шаблоном. Согласуйте содержание с методологом перед рабочей оценкой.",
          "Бастапқы критерийлер — үлгі. Жұмыс бағалауына дейін мазмұнын әдіскермен келісіңіз.",
        )}
      </div>
      <LoadState loading={loading} error={error}>
        <div className="test-grid">
          {(data || []).map((e) => (
            <Panel key={e.id} className="panel-padded">
              <div className="row between">
                <span className="test-icon">
                  <ClipboardIcon />
                </span>
                <small className="text-muted">v{e.version}</small>
              </div>
              <h2 style={{ margin: "20px 0 10px" }}>{loc(e.name)}</h2>
              <p className="text-small text-muted">
                {t(
                  `Критериев: ${e.criteria.length}`,
                  `Критерийлер: ${e.criteria.length}`,
                )}
              </p>
              <Button
                className="full-width mt"
                variant="secondary"
                onClick={() => setSelected(structuredClone(e))}
              >
                <PenLine size={14} />
                {t("Настроить критерии", "Критерийлерді баптау")}
              </Button>
            </Panel>
          ))}
        </div>
      </LoadState>
      {selected && (
        <CriteriaModal
          value={selected}
          onClose={() => setSelected(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
function ClipboardIcon() {
  return <FileText size={21} />;
}
function CriteriaModal({
  value,
  onClose,
  onSaved,
}: {
  value: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, notify } = useApp();
  const [draft, setDraft] = useState(value),
    [busy, setBusy] = useState(false);
  const update = (i: number, patch: object) =>
    setDraft({
      ...draft,
      criteria: draft.criteria.map((c: any, j: number) =>
        i === j ? { ...c, ...patch } : c,
      ),
    });
  return (
    <Modal
      wide
      title={t("Настройка упражнения", "Жаттығуды баптау")}
      onClose={onClose}
    >
      <form
        className="modal-body form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post(`/exercises/${value.id}/version`, {
              type: draft.type,
              name: draft.name,
              criteria: draft.criteria,
            });
            onSaved();
            onClose();
            notify(
              t(
                "Новая версия критериев сохранена",
                "Критерийлердің жаңа нұсқасы сақталды",
              ),
            );
          } catch (e) {
            notify((e as Error).message, "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Название · RU">
            <input
              required
              value={draft.name.ru}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  name: { ...draft.name, ru: e.target.value },
                })
              }
            />
          </Field>
          <Field label="Атауы · ҚАЗ">
            <input
              required
              value={draft.name.kk}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  name: { ...draft.name, kk: e.target.value },
                })
              }
            />
          </Field>
        </div>
        {draft.criteria.map((c: any, i: number) => (
          <div className="criterion-block" key={c.id}>
            <div className="row between">
              <h3>
                {t("Компетенция", "Құзырет")} {i + 1}
              </h3>
              <button
                type="button"
                className="icon-btn"
                aria-label="Удалить критерий"
                disabled={draft.criteria.length === 1}
                onClick={() =>
                  setDraft({
                    ...draft,
                    criteria: draft.criteria.filter(
                      (_: unknown, j: number) => j !== i,
                    ),
                  })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="form-stack">
              <Field label={t("Название компетенции", "Құзырет атауы")}>
                <input
                  required
                  value={c.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </Field>
              <Field
                label={t(
                  "Поведенческие индикаторы — по одному на строку",
                  "Мінез-құлық индикаторлары — әр жолға біреу",
                )}
              >
                <textarea
                  rows={3}
                  required
                  value={c.indicators.join("\n")}
                  onChange={(e) =>
                    update(i, { indicators: e.target.value.split("\n") })
                  }
                />
              </Field>
              <div className="form-grid">
                {c.scale.map((s: any, j: number) => (
                  <Field label={`${t("Балл", "Балл")} ${s.value}`} key={j}>
                    <input
                      required
                      value={s.description}
                      onChange={(e) =>
                        update(i, {
                          scale: c.scale.map((p: any, k: number) =>
                            k === j ? { ...p, description: e.target.value } : p,
                          ),
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
              <div className="row">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={c.scale.length >= 10}
                  onClick={() =>
                    update(i, {
                      scale: [
                        ...c.scale,
                        {
                          value:
                            Math.max(...c.scale.map((s: any) => s.value)) + 1,
                          description: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus size={13} />
                  {t("Добавить балл", "Балл қосу")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={c.scale.length <= 2}
                  onClick={() => update(i, { scale: c.scale.slice(0, -1) })}
                >
                  {t("Убрать последний", "Соңғысын алып тастау")}
                </Button>
              </div>
              <label className="row">
                <input
                  type="checkbox"
                  checked={c.allowNotObserved}
                  onChange={(e) =>
                    update(i, { allowNotObserved: e.target.checked })
                  }
                />
                <span className="text-small">
                  {t(
                    "Разрешить «Не наблюдалось»",
                    "«Бақыланбады» нұсқасына рұқсат беру",
                  )}
                </span>
              </label>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setDraft({
              ...draft,
              criteria: [
                ...draft.criteria,
                {
                  id: crypto.randomUUID(),
                  name: "",
                  indicators: [""],
                  scale: [1, 2, 3, 4, 5].map((v) => ({
                    value: v,
                    description: "",
                  })),
                  allowNotObserved: true,
                },
              ],
            })
          }
        >
          <Plus size={15} />
          {t("Добавить компетенцию", "Құзырет қосу")}
        </Button>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("Отмена", "Бас тарту")}
          </Button>
          <Button busy={busy}>
            <Save size={15} />
            {t("Сохранить новую версию", "Жаңа нұсқаны сақтау")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function SettingsPage() {
  const { t, me, reload, notify } = useApp();
  const [org, setOrg] = useState(me.organization),
    [busy, setBusy] = useState(false),
    [expertModal, setExpertModal] = useState(false);
  const people = useData<any[]>("/people");
  return (
    <>
      <PageTitle
        title={t("Настройки организации", "Ұйым баптаулары")}
        description={t("\u041e\u0441\u043d\u043e\u0432\u043d\u044b\u0435 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u0438.", "\u04b0\u0439\u044b\u043c\u043d\u044b\u04a3 \u043d\u0435\u0433\u0456\u0437\u0433\u0456 \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u043b\u0435\u0440\u0456.")}
      />
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await patch("/settings", {
              name: org.name,
            });
            await reload();
            notify(t("Настройки сохранены", "Баптаулар сақталды"));
          } catch (e) {
            notify((e as Error).message, "error");
          } finally {
            setBusy(false);
          }
        }}
      >
          <Panel title={t("Организация", "Ұйым")}>
            <div className="panel-body form-stack">
              <Field label={t("Название организации", "Ұйым атауы")}>
                <input
                  required
                  value={org.name}
                  onChange={(e) => setOrg({ ...org, name: e.target.value })}
                />
              </Field>
            </div>
          </Panel>
        <div className="form-actions">
          <Button busy={busy}>
            <Save size={16} />
            {t("Сохранить настройки", "Баптауларды сақтау")}
          </Button>
        </div>
      </form>
      <Panel
        className="section-gap"
        title={t("Эксперты организации", "Ұйым сарапшылары")}
        action={
          <Button variant="secondary" onClick={() => setExpertModal(true)}>
            <Plus size={15} />
            {t("Добавить эксперта", "Сарапшы қосу")}
          </Button>
        }
      >
        <div className="panel-body">
          {(people.data || [])
            .filter((p) => p.role === "expert")
            .map((p) => (
              <div className="cell-person" key={p.id}>
                <Avatar name={p.user.name} />
                <div>
                  <strong>{p.user.name}</strong>
                  <small>{p.user.email}</small>
                </div>
                <Badge status={p.status} />
              </div>
            ))}
        </div>
      </Panel>
      {expertModal && (
        <AddPerson
          role="expert"
          onClose={() => setExpertModal(false)}
          onSaved={people.refresh}
        />
      )}
    </>
  );
}
export function Platform() {
  const { t, notify } = useApp();
  const orgs = useData<any[]>("/platform/organizations"),
    ai = useData<any>("/platform/ai"),
    tests = useData<any[]>("/tests");
  const [tab, setTab] = useState("organizations"),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(null),
    [method, setMethod] = useState<any>(null),
    [methodJson, setMethodJson] = useState(""),
    [importOpen, setImportOpen] = useState(false),
    [importJson, setImportJson] = useState("");
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("method");
    if (id) {
      setTab("methods");
      api(`/platform/tests/${id}`)
        .then((d) => {
          setMethod(d);
          setMethodJson(JSON.stringify(d.keys[0], null, 2));
        })
        .catch((e) => notify(e.message, "error"));
    }
  }, []);
  return (
    <>
      <PageTitle
        title={t("Управление платформой", "Платформаны басқару")}
        description={t(
          "Организации, библиотека методик и настройки AI.",
          "Ұйымдар, әдістемелер кітапханасы және AI баптаулары.",
        )}
      />
      <div className="tabs">
        {[
          ["organizations", t("Организации", "Ұйымдар")],
          ["methods", t("Методики и ключи", "Әдістемелер мен кілттер")],
          ["ai", t("OpenRouter и генерации", "OpenRouter және генерациялар")],
        ].map(([key, label]) => (
          <button
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
            key={key}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "organizations" && (
        <Panel
          title={t("Организации платформы", "Платформа ұйымдары")}
          action={
            <Button onClick={() => setCreate(true)}>
              <Plus size={15} />
              {t("Создать организацию", "Ұйым жасау")}
            </Button>
          }
        >
          <LoadState loading={orgs.loading} error={orgs.error}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("ОРГАНИЗАЦИЯ", "ҰЙЫМ")}</th>
                    <th>{t("СОТРУДНИКИ", "ҚЫЗМЕТКЕРЛЕР")}</th>
                    <th>{t("ЛИМИТЫ", "ЛИМИТТЕР")}</th>
                    <th>{t("СТАТУС", "МӘРТЕБЕ")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(orgs.data || []).map((o) => (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.name}</strong>
                      </td>
                      <td>{o._count.memberships}</td>
                      <td>
                        <input
                          aria-label={`${o.name}: лимит сотрудников`}
                          type="number"
                          min={1}
                          defaultValue={o.employeeLimit}
                          style={{
                            width: 90,
                            minHeight: 30,
                            padding: "5px 8px",
                          }}
                          onBlur={async (e) => {
                            if (Number(e.target.value) !== o.employeeLimit)
                              try {
                                await patch(`/platform/organizations/${o.id}`, {
                                  employeeLimit: Number(e.target.value),
                                });
                                orgs.refresh();
                                notify(t("Лимит сохранён", "Лимит сақталды"));
                              } catch (e) {
                                notify((e as Error).message, "error");
                              }
                          }}
                        />
                      </td>
                      <td>
                        <Badge status={o.status} />
                      </td>
                      <td>
                        <div className="row">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              localStorage.setItem("assessflow.org", o.id);
                              window.location.href = "/";
                            }}
                          >
                            {t("Открыть", "Ашу")}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={async () => {
                              try {
                                await patch(`/platform/organizations/${o.id}`, {
                                  status:
                                    o.status === "active"
                                      ? "blocked"
                                      : "active",
                                });
                                orgs.refresh();
                              } catch (e) {
                                notify((e as Error).message, "error");
                              }
                            }}
                          >
                            {o.status === "active"
                              ? t("Приостановить", "Тоқтата тұру")
                              : t("Активировать", "Белсендіру")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </LoadState>
        </Panel>
      )}
      {tab === "methods" && (
        <Panel
          title={t("Версии методик", "Әдістемелер нұсқалары")}
          action={
            <Button onClick={() => setImportOpen(true)}>
              <Upload size={15} />
              {t("Импорт JSON", "JSON импорттау")}
            </Button>
          }
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("МЕТОДИКА", "ӘДІСТЕМЕ")}</th>
                  <th>{t("ВЕРСИЯ", "НҰСҚА")}</th>
                  <th>{t("СТАТУС", "МӘРТЕБЕ")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(tests.data || []).flatMap((test) =>
                  test.versions.map((v: any) => (
                    <tr key={v.id}>
                      <td>{test.name.ru}</td>
                      <td>{v.version}</td>
                      <td>
                        <Badge status={v.status} />
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={async () => {
                            try {
                              const d = await api(`/platform/tests/${v.id}`);
                              setMethod(d);
                              setMethodJson(JSON.stringify(d.keys[0], null, 2));
                            } catch (e) {
                              notify((e as Error).message, "error");
                            }
                          }}
                        >
                          <KeyRound size={13} />
                          {t("Настроить", "Баптау")}
                        </Button>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {tab === "ai" && (
        <LoadState loading={ai.loading} error={ai.error}>
          {ai.data && (
            <>
              <Panel
                title="OpenRouter"
                description={t(
                  "API-ключ хранится только на сервере.",
                  "API кілті тек серверде сақталады.",
                )}
              >
                <form
                  className="panel-body form-stack"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    const d = Object.fromEntries(new FormData(e.currentTarget));
                    try {
                      await patch("/platform/ai", {
                        apiKey: d.apiKey || undefined,
                        aiModel: d.model,
                        aiPrompt: d.prompt,
                        aiPromptVersion: d.version,
                        aiProviderAllowlist: String(d.providers)
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        aiZdr: d.zdr === "on",
                      });
                      notify(
                        t("Настройки AI сохранены", "AI баптаулары сақталды"),
                      );
                      ai.refresh();
                    } catch (e) {
                      notify((e as Error).message, "error");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div
                    className={`notice ${ai.data.keyConfigured ? "success" : "warning"}`}
                  >
                    <KeyRound size={18} />
                    {ai.data.keyConfigured
                      ? t("Ключ подключён", "Кілт қосылған")
                      : t(
                          "Ключ ещё не подключён. Добавьте его в поле ниже.",
                          "Кілт әлі қосылмаған. Оны төмендегі өріске қосыңыз.",
                        )}
                  </div>
                  <div className="form-grid">
                    <Field
                      label={t(
                        "Новый API-ключ (пустое поле сохраняет текущий)",
                        "Жаңа API кілті (бос өріс ағымдағы кілтті сақтайды)",
                      )}
                    >
                      <input
                        name="apiKey"
                        type="password"
                        autoComplete="new-password"
                        placeholder="sk-or-…"
                      />
                    </Field>
                    <Field
                      label={t("ID модели OpenRouter", "OpenRouter модель ID")}
                    >
                      <input
                        name="model"
                        defaultValue={ai.data.settings.aiModel}
                        placeholder="provider/model"
                      />
                    </Field>
                    <Field label={t("Версия промпта", "Промпт нұсқасы")}>
                      <input
                        name="version"
                        defaultValue={ai.data.settings.aiPromptVersion}
                        required
                      />
                    </Field>
                  </div>
                  <Field
                    label={t(
                      "Согласованные провайдеры, через запятую",
                      "Келісілген провайдерлер, үтір арқылы",
                    )}
                  >
                    <input
                      name="providers"
                      defaultValue={ai.data.settings.aiProviderAllowlist.join(
                        ", ",
                      )}
                    />
                  </Field>
                  <label className="row">
                    <input
                      type="checkbox"
                      name="zdr"
                      defaultChecked={ai.data.settings.aiZdr}
                    />
                    <span className="text-small">
                      {t(
                        "Требовать режим без сохранения данных (ZDR)",
                        "Деректерді сақтамау режимін талап ету (ZDR)",
                      )}
                    </span>
                  </label>
                  <Field label={t("Системный промпт", "Жүйелік промпт")}>
                    <textarea
                      name="prompt"
                      rows={8}
                      defaultValue={ai.data.settings.aiPrompt}
                    />
                  </Field>
                  <Button busy={busy}>
                    <Save size={15} />
                    {t("Сохранить", "Сақтау")}
                  </Button>
                </form>
              </Panel>
              <Panel
                className="section-gap"
                title={t("История генераций", "Генерациялар тарихы")}
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("ДАТА", "КҮНІ")}</th>
                        <th>{t("ТИП", "ТҮРІ")}</th>
                        <th>{t("МОДЕЛЬ", "МОДЕЛЬ")}</th>
                        <th>{t("СТАТУС", "МӘРТЕБЕ")}</th>
                        <th>{t("ТОКЕНЫ", "ТОКЕНДЕР")}</th>
                        <th>USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ai.data.history.map((r: any) => (
                        <tr key={r.id}>
                          <td>{date(r.createdAt)}</td>
                          <td>{r.kind === "team" ? t("Командный отчёт", "Командалық есеп") : r.kind === "individual" ? t("Индивидуальный отчёт", "Жеке есеп") : t("Анализ участника", "Қатысушыны талдау")}</td>
                          <td>{r.model || "—"}</td>
                          <td>
                            <Badge status={r.status} />
                            {r.error && <p className="text-small">{r.error}</p>}
                          </td>
                          <td>{r.promptTokens + r.completionTokens}</td>
                          <td>{r.cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
        </LoadState>
      )}
      {create && (
        <Modal
          title={t("Новая организация", "Жаңа ұйым")}
          onClose={() => {
            setCreate(false);
            setResult(null);
          }}
        >
          <form
            className="modal-body form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                setResult(
                  await post(
                    "/platform/organizations",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  ),
                );
                orgs.refresh();
              } catch (e) {
                notify((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            {result ? (
              <div className="credential-box">
                <p>{result.admin.user.email}</p>
                <code>{result.admin.temporaryPassword}</code>
              </div>
            ) : (
              <>
                {[
                  ["name", t("Название", "Атауы")],
                  [
                    "slug",
                    t("Идентификатор латиницей", "Латынша идентификатор"),
                  ],
                  ["adminName", t("ФИО администратора", "Әкімшінің аты-жөні")],
                  ["adminEmail", "Email"],
                ].map(([name, label]) => (
                  <Field key={name} label={label}>
                    <input
                      required
                      name={name}
                      type={name === "adminEmail" ? "email" : "text"}
                    />
                  </Field>
                ))}
                <Button busy={busy}>
                  {t("Создать организацию", "Ұйым жасау")}
                </Button>
              </>
            )}
          </form>
        </Modal>
      )}
      {method && (
        <Modal
          wide
          title={`${method.test.name.ru} · ${method.version}`}
          onClose={() => setMethod(null)}
        >
          <div className="modal-body form-stack">
            <div className="notice warning">
              {t(
                "Изменение ключа создаёт отдельную версию. Существующие результаты автоматически не перезаписываются.",
                "Кілтті өзгерту бөлек нұсқа жасайды. Бар нәтижелер автоматты түрде қайта жазылмайды.",
              )}
            </div>
            <Field
              label={t(
                "Ключ, источник и контрольные примеры · JSON",
                "Кілт, дереккөз және бақылау мысалдары · JSON",
              )}
            >
              <textarea
                className="code-textarea"
                rows={14}
                value={methodJson}
                onChange={(e) => setMethodJson(e.target.value)}
              />
            </Field>
            <Button
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const k = JSON.parse(methodJson);
                  await post(`/platform/tests/${method.id}/keys`, {
                    version: k.version,
                    config: k.config,
                    source: k.source,
                    approvedBy: k.approvedBy || undefined,
                    controlExamples: k.controlExamples,
                  });
                  notify(t("Версия ключа сохранена", "Кілт нұсқасы сақталды"));
                  setMethod(null);
                } catch (e) {
                  notify((e as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t(
                "Сохранить новую версию ключа",
                "Кілттің жаңа нұсқасын сақтау",
              )}
            </Button>
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const d = Object.fromEntries(new FormData(e.currentTarget));
                try {
                  await post(`/platform/tests/${method.id}/publish`, {
                    approvedBy: d.approvedBy,
                    confirmRights: d.rights === "on",
                    confirmTranslations: d.translations === "on",
                  });
                  notify(t("Версия опубликована", "Нұсқа жарияланды"));
                  tests.refresh();
                  setMethod(null);
                } catch (e) {
                  notify((e as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field
                label={t(
                  "Специалист, утвердивший методику",
                  "Әдістемені бекіткен маман",
                )}
              >
                <input required name="approvedBy" />
              </Field>
              <label className="row">
                <input type="checkbox" name="rights" required />
                <span className="text-small">
                  {t(
                    "Права на использование подтверждены",
                    "Пайдалану құқықтары расталған",
                  )}
                </span>
              </label>
              <label className="row">
                <input type="checkbox" name="translations" required />
                <span className="text-small">
                  {t(
                    "Переводы и методология проверены",
                    "Аудармалар мен әдістеме тексерілген",
                  )}
                </span>
              </label>
              <div className="row">
                <Button busy={busy}>
                  <CheckCircle2 size={15} />
                  {t(
                    "Опубликовать утверждённую версию",
                    "Бекітілген нұсқаны жариялау",
                  )}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await post(`/platform/tests/${method.id}/archive`);
                      tests.refresh();
                      setMethod(null);
                    } catch (e) {
                      notify((e as Error).message, "error");
                    }
                  }}
                >
                  {t("В архив", "Мұрағатқа")}
                </Button>
              </div>
            </form>
          </div>
        </Modal>
      )}
      {importOpen && (
        <Modal
          wide
          title={t("Импорт методики", "Әдістеме импорты")}
          onClose={() => setImportOpen(false)}
        >
          <div className="modal-body form-stack">
            <p className="text-small text-muted">
              {t(
                "Структура: testId, version, name, description, direction, source, licenseStatus, scientificBasis, durationMinutes, questions, algorithm, config, controlExamples. Каждый вопрос и вариант должны иметь уникальные стабильные ID.",
                "Құрылымы: testId, version, name, description, direction, source, licenseStatus, scientificBasis, durationMinutes, questions, algorithm, config, controlExamples. Әр сұрақ пен нұсқаның бірегей тұрақты ID болуы тиіс.",
              )}
            </p>
            <input
              type="file"
              accept=".json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setImportJson(await f.text());
              }}
            />
            <textarea
              className="code-textarea"
              rows={15}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
            />
            <Button
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post("/platform/tests/import", JSON.parse(importJson));
                  tests.refresh();
                  setImportOpen(false);
                  notify(
                    t(
                      "Методика импортирована как черновик",
                      "Әдістеме жоба ретінде импортталды",
                    ),
                  );
                } catch (e) {
                  notify((e as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("Импортировать черновик", "Жобаны импорттау")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
