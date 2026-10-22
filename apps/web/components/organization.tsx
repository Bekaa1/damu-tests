"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Plus,
  Download,
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Search,
  Upload,
  ClipboardList,
  BookOpen,
  Brain,
  MessageSquare,
  Calculator,
  Shapes,
  Heart,
  Compass,
  Info,
  ShieldCheck,
  FileText,
  SlidersHorizontal,
  Copy,
  Check,
} from "lucide-react";
import {
  useApp,
  useData,
  post,
  download,
  PageTitle,
  Panel,
  Stat,
  Badge,
  Avatar,
  Progress,
  Button,
  LoadState,
  Empty,
  Modal,
  Field,
  date,
} from "./ui";
const methodIcons: Record<string, typeof Brain> = {
  verbal: MessageSquare,
  numerical: Calculator,
  logical: Shapes,
  personality: Brain,
  motivation: Heart,
  situations: Compass,
};
export function Overview() {
  const { t, me, campaign, campaigns, locale, notify } = useApp();
  const { data, loading, error } = useData<any[]>(
    campaign ? `/people?campaignId=${campaign}` : null,
  );
  const activity = useData<any[]>(me.role === "expert" ? null : "/activity");
  const people = (data || []).filter((p) => p.role === "employee");
  const done = people.filter((p) => p.status === "completed").length,
    progress = people.filter((p) => p.status === "in_progress").length,
    waiting = people.length - done - progress,
    approved = people.filter((p) => p.report?.status === "approved").length;
  const percent = people.length ? Math.round((done / people.length) * 100) : 0;
  const active = campaigns.find((c) => c.id === campaign);
  const units = [...new Set(people.map((p) => p.unit))].map((unit) => {
    const items = people.filter((p) => p.unit === unit);
    return {
      name: unit,
      total: items.length,
      done: items.filter((p) => p.status === "completed").length,
      inProgress: items.filter((p) => p.status === "in_progress").length,
    };
  });
  const actionLabels: Record<string, string> = {
    "employee.created": t("Добавлен сотрудник", "Қызметкер қосылды"),
    "attempt.completed": t("Завершено тестирование", "Тестілеу аяқталды"),
    "report.approved": t(
      "Утверждён экспертный отчёт",
      "Сараптамалық есеп бекітілді",
    ),
    "tests.assigned": t("Назначены тестирования", "Тесттер тағайындалды"),
    "campaign.created": t("Создана кампания оценки", "Бағалау науқаны құрылды"),
    "observation.saved": t(
      "Сохранены наблюдения эксперта",
      "Сарапшы бақылаулары сақталды",
    ),
    "organization.settings_updated": t(
      "Обновлены настройки",
      "Баптаулар жаңартылды",
    ),
    "demo.initialized": t(
      "Демонстрационная кампания подготовлена",
      "Демонстрациялық науқан дайындалды",
    ),
  };
  return (
    <>
      <PageTitle
        title={t("Обзор организации", "Ұйымға шолу")}
        description={t(
          "Всё, что нужно знать о текущей оценке вашей команды.",
          "Командаңыздың ағымдағы бағалауы туралы негізгі ақпарат.",
        )}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                download(
                  `/export/team?campaignId=${campaign}`,
                  "assessflow-team.pdf",
                ).catch((e) => notify(e.message, "error"))
              }
            >
              <Download size={15} />
              {t("Сводный отчёт", "Жиынтық есеп")}
            </Button>
            {me.role !== "expert" && (
              <Link href="/people?add=1" className="btn primary">
                <Plus size={16} />
                {t("Добавить сотрудника", "Қызметкер қосу")}
              </Link>
            )}
          </>
        }
      />
      <LoadState loading={loading} error={error}>
        <div className="stats-grid">
          <Stat
            label={t("Участники оценки", "Бағалау қатысушылары")}
            value={people.length}
            detail={t(
              `В ${units.length} подразделениях организации`,
              `Ұйымның ${units.length} бөлімшесінде`,
            )}
            icon={<Users size={16} />}
          />
          <Stat
            label={t("Завершили тестирование", "Тестілеуді аяқтады")}
            value={done}
            detail={t(
              `${percent}% от всех участников`,
              `Барлық қатысушылардың ${percent}%-ы`,
            )}
            icon={<CheckCircle2 size={16} />}
            accent
          />
          <Stat
            label={t("В процессе", "Орындалуда")}
            value={progress}
            detail={t(
              "Продолжают проходить тесты",
              "Тест тапсыруды жалғастыруда",
            )}
            icon={<Clock3 size={16} />}
          />
          <Stat
            label={t("Утверждённые отчёты", "Бекітілген есептер")}
            value={approved}
            detail={t(
              "Проверены ответственным экспертом",
              "Жауапты сарапшы тексерген",
            )}
            icon={<FileCheck2 size={16} />}
          />
        </div>
        <div className="dashboard-grid">
          <Panel
            title={t("Прогресс кампании", "Науқан барысы")}
            description={active?.name}
            action={<Badge status="active" />}
          >
            <div className="completion-layout">
              <div className="donut">
                <svg viewBox="0 0 180 180" aria-label={`${percent}%`}>
                  <circle
                    cx="90"
                    cy="90"
                    r="70"
                    fill="none"
                    stroke="#edf1f3"
                    strokeWidth="17"
                  />
                  <circle
                    cx="90"
                    cy="90"
                    r="70"
                    fill="none"
                    stroke="#7f9bad"
                    strokeWidth="17"
                    strokeDasharray={`${people.length ? ((done + progress) / people.length) * 440 : 0} 440`}
                  />
                  <circle
                    cx="90"
                    cy="90"
                    r="70"
                    fill="none"
                    stroke="#3f7c68"
                    strokeWidth="17"
                    strokeDasharray={`${(percent / 100) * 440} 440`}
                  />
                </svg>
                <div className="donut-center">
                  <strong>{percent}%</strong>
                  <span>{t("завершили оценку", "бағалауды аяқтады")}</span>
                </div>
              </div>
              <div className="completion-legend">
                {[
                  [t("Завершено", "Аяқталды"), done, "#3f7c68"],
                  [t("В процессе", "Орындалуда"), progress, "#7f9bad"],
                  [t("Ещё не начали", "Әлі бастамады"), waiting, "#dfe6eb"],
                ].map(([label, count, color]) => (
                  <div className="legend-row" key={label}>
                    <i
                      className="legend-dot"
                      style={{ background: String(color) }}
                    />
                    <span>{label}</span>
                    <b>{count}</b>
                    <small>
                      {people.length
                        ? Math.round((Number(count) / people.length) * 100)
                        : 0}
                      %
                    </small>
                  </div>
                ))}
              </div>
            </div>
            <div className="chart-caption">
              <CalendarDays size={13} />
              {t("Завершение кампании:", "Науқанның аяқталуы:")}{" "}
              {active ? date(active.endsAt, locale) : "—"}
              <Link
                href="/campaigns"
                className="text-link"
                style={{ marginLeft: "auto" }}
              >
                {t("Подробнее", "Толығырақ")}
                <ArrowUpRight size={13} />
              </Link>
            </div>
          </Panel>
          <Panel
            title={t("Требуют внимания", "Назар аудару қажет")}
            action={
              <span className="mini-count">{done - approved + waiting}</span>
            }
          >
            <div className="task-list">
              <Link href="/reports" className="task-row">
                <div className="task-icon amber">
                  <FileCheck2 size={18} />
                </div>
                <div>
                  <strong>
                    {t(
                      `${done - approved} отчётов ожидают проверки`,
                      `${done - approved} есеп тексеруді күтуде`,
                    )}
                  </strong>
                  <p>
                    {t(
                      "Передайте результаты эксперту",
                      "Нәтижелерді сарапшыға жіберіңіз",
                    )}
                  </p>
                </div>
                <ChevronRight size={16} />
              </Link>
              <Link href="/people?status=not_started" className="task-row">
                <div className="task-icon">
                  <Clock3 size={18} />
                </div>
                <div>
                  <strong>
                    {t(
                      `${waiting} участников ещё не начали`,
                      `${waiting} қатысушы әлі бастамады`,
                    )}
                  </strong>
                  <p>
                    {t(
                      "Проверьте доступ и назначения",
                      "Қолжетімділік пен тапсырмаларды тексеріңіз",
                    )}
                  </p>
                </div>
                <ChevronRight size={16} />
              </Link>
              <Link href="/library" className="task-row">
                <div className="task-icon">
                  <BookOpen size={18} />
                </div>
                <div>
                  <strong>
                    {t(
                      "Проверка материалов методик",
                      "Әдістеме материалдарын тексеру",
                    )}
                  </strong>
                  <p>
                    {t(
                      "Переводы и правила интерпретации",
                      "Аудармалар мен түсіндіру ережелері",
                    )}
                  </p>
                </div>
                <ChevronRight size={16} />
              </Link>
            </div>
            <Link href="/people" className="task-link">
              {t("Перейти к участникам", "Қатысушыларға өту")}
              <ArrowRight size={13} />
            </Link>
          </Panel>
        </div>
        <div className="dashboard-grid">
          <Panel
            title={t("Оценка по подразделениям", "Бөлімшелер бойынша бағалау")}
            description={t(
              "Участие и завершение тестирования",
              "Қатысу және тестілеуді аяқтау",
            )}
            action={
              <Link href="/analytics" className="text-link">
                {t("Вся аналитика", "Барлық талдау")}
                <ArrowUpRight size={13} />
              </Link>
            }
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("ПОДРАЗДЕЛЕНИЕ", "БӨЛІМШЕ")}</th>
                    <th>{t("УЧАСТНИКИ", "ҚАТЫСУШЫЛАР")}</th>
                    <th>{t("ЗАВЕРШИЛИ", "АЯҚТАДЫ")}</th>
                    <th>{t("ПРОГРЕСС", "ІЛГЕРІЛЕУ")}</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.name}>
                      <td>
                        <strong style={{ fontSize: 14, fontWeight: 550 }}>
                          {u.name}
                        </strong>
                      </td>
                      <td>{u.total}</td>
                      <td>{u.done}</td>
                      <td>
                        <div className="department-line">
                          <Progress value={(u.done / u.total) * 100} small />
                          <span>{Math.round((u.done / u.total) * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel
            title={t("Последние события", "Соңғы оқиғалар")}
            description={t(
              "Изменения в рабочем пространстве",
              "Жұмыс кеңістігіндегі өзгерістер",
            )}
          >
            <div className="activity-list">
              {(activity.data || [])
                .filter((a) => actionLabels[a.action])
                .slice(0, 5)
                .map((a) => (
                  <div className="activity-item" key={a.id}>
                    <i className="activity-node" />
                    <div>
                      <p>{actionLabels[a.action]}</p>
                      <small>
                        {date(a.createdAt, locale)} ·{" "}
                        {new Date(a.createdAt).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </div>
                  </div>
                ))}
              {!(activity.data || []).length && (
                <p className="text-muted text-small">
                  {t(
                    "Здесь появятся события кампании.",
                    "Науқан оқиғалары осында көрсетіледі.",
                  )}
                </p>
              )}
            </div>
          </Panel>
        </div>
      </LoadState>
    </>
  );
}
export function People({ expert = false }: { expert?: boolean }) {
  const { t, campaign, me, notify } = useApp();
  const query =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const { data, loading, error, refresh } = useData<any[]>(
    campaign ? `/people?campaignId=${campaign}` : null,
  );
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(query.get("status") || "all"),
    [unit, setUnit] = useState("all"),
    [page, setPage] = useState(1),
    [modal, setModal] = useState(query.has("add") ? "add" : ""),
    [selected, setSelected] = useState<string[]>([]);
  const people = (data || []).filter((p) => p.role === "employee");
  const filtered = people.filter(
    (p) =>
      (p.user.name + " " + p.user.email + " " + p.position)
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()) &&
      (status === "all" || p.status === status) &&
      (unit === "all" || p.unit === unit) &&
      (!expert || p.status === "completed"),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * 10, current * 10);
  const exportFile = async () => {
    try {
      await download(
        `/export/people?campaignId=${campaign}`,
        "assessflow-results.xlsx",
      );
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };
  return (
    <>
      <PageTitle
        title={
          expert
            ? t("Экспертная проверка", "Сараптамалық тексеру")
            : t("Сотрудники", "Қызметкерлер")
        }
        description={t(
          "Управляйте участниками, следите за прогрессом и открывайте результаты.",
          "Қатысушыларды басқарыңыз, ілгерілеуді бақылаңыз және нәтижелерін ашыңыз.",
        )}
        actions={
          me.role !== "expert" ? (
            <>
              <Button variant="secondary" onClick={() => setModal("import")}>
                <Upload size={15} />
                {t("Импорт", "Импорт")}
              </Button>
              <Button onClick={() => setModal("add")}>
                <Plus size={16} />
                {t("Добавить сотрудника", "Қызметкер қосу")}
              </Button>
            </>
          ) : undefined
        }
      />
      <LoadState loading={loading} error={error}>
        <Panel>
          <div className="toolbar">
            <div className="search-input">
              <Search size={16} />
              <input
                aria-label={t("Поиск сотрудников", "Қызметкерлерді іздеу")}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t(
                  "Найти по имени или email",
                  "Аты немесе email бойынша іздеу",
                )}
              />
            </div>
            <div className="toolbar-controls">
              <select
                aria-label="Статус"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">
                  {t("Все статусы", "Барлық мәртебелер")}
                </option>
                <option value="completed">{t("Завершили", "Аяқтады")}</option>
                <option value="in_progress">
                  {t("В процессе", "Орындалуда")}
                </option>
                <option value="not_started">
                  {t("Не начали", "Бастамады")}
                </option>
                <option value="unassigned">
                  {t("Без назначений", "Тапсырмасыз")}
                </option>
              </select>
              <select
                aria-label="Подразделение"
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">
                  {t("Все подразделения", "Барлық бөлімшелер")}
                </option>
                {[...new Set(people.map((p) => p.unit))].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
              {me.role !== "expert" && (
                <Button variant="secondary" onClick={exportFile}>
                  <Download size={14} />
                  {t("Excel", "Excel")}
                </Button>
              )}
            </div>
          </div>
          {selected.length > 0 && (
            <div className="selection-bar">
              <span>
                {t(
                  `Выбрано сотрудников: ${selected.length}`,
                  `Таңдалған қызметкерлер: ${selected.length}`,
                )}
              </span>
              <Button onClick={() => setModal("assign")}>
                {t("Назначить тесты", "Тесттерді тағайындау")}
                <ArrowRight size={14} />
              </Button>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {me.role !== "expert" && (
                    <th style={{ width: 30 }}>
                      <input
                        type="checkbox"
                        aria-label="Выбрать все на странице"
                        checked={
                          visible.length > 0 &&
                          visible.every((p) => selected.includes(p.id))
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [
                                  ...new Set([
                                    ...selected,
                                    ...visible.map((p) => p.id),
                                  ]),
                                ]
                              : selected.filter(
                                  (id) => !visible.some((p) => p.id === id),
                                ),
                          )
                        }
                      />
                    </th>
                  )}
                  <th>{t("СОТРУДНИК", "ҚЫЗМЕТКЕР")}</th>
                  <th>{t("ПОДРАЗДЕЛЕНИЕ", "БӨЛІМШЕ")}</th>
                  <th>{t("ПРОГРЕСС", "ІЛГЕРІЛЕУ")}</th>
                  <th>{t("СТАТУС", "МӘРТЕБЕ")}</th>
                  <th>{t("ОТЧЁТ", "ЕСЕП")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    {me.role !== "expert" && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={p.user.name}
                          checked={selected.includes(p.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, p.id]
                                : selected.filter((id) => id !== p.id),
                            )
                          }
                        />
                      </td>
                    )}
                    <td>
                      <Link href={`/people/${p.id}`} className="cell-person">
                        <Avatar name={p.user.name} />
                        <div>
                          <strong>{p.user.name}</strong>
                          <small>{p.position}</small>
                        </div>
                      </Link>
                    </td>
                    <td className="text-muted text-small">{p.unit}</td>
                    <td>
                      <div style={{ width: 92 }}>
                        <div
                          className="row between"
                          style={{
                            fontSize: 13,
                            marginBottom: 7,
                            color: "#8999a2",
                          }}
                        >
                          <span>
                            {p.completed} / {p.total}
                          </span>
                          <span>{p.progress}%</span>
                        </div>
                        <Progress value={p.progress} small />
                      </div>
                    </td>
                    <td>
                      <Badge status={p.status} />
                    </td>
                    <td>
                      {p.report ? (
                        <Badge status={p.report.status} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/people/${p.id}`}
                        aria-label={t("Открыть карточку", "Карточканы ашу")}
                      >
                        <ChevronRight size={16} color="#9aacb5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <Empty
              title={t("Сотрудники не найдены", "Қызметкерлер табылмады")}
              description={t(
                "Измените фильтры или добавьте первого участника.",
                "Сүзгілерді өзгертіңіз немесе бірінші қатысушыны қосыңыз.",
              )}
            />
          )}
          <div className="table-footer">
            <span>
              {t(
                `Показано ${visible.length} из ${filtered.length} сотрудников`,
                `${filtered.length} қызметкердің ${visible.length}-і көрсетілген`,
              )}
            </span>
            <div className="pagination">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button
                  className={n === current ? "active" : ""}
                  onClick={() => setPage(n)}
                  key={n}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </LoadState>
      {modal === "add" && (
        <AddPerson onClose={() => setModal("")} onSaved={refresh} />
      )}{" "}
      {modal === "assign" && (
        <AssignModal
          selected={selected}
          experts={(data || []).filter((p) => p.role === "expert")}
          onClose={() => setModal("")}
          onSaved={() => {
            refresh();
            setSelected([]);
          }}
        />
      )}
      {modal === "import" && (
        <ImportModal onClose={() => setModal("")} onSaved={refresh} />
      )}
    </>
  );
}
export function AddPerson({
  onClose,
  onSaved,
  role = "employee",
}: {
  onClose: () => void;
  onSaved: () => void;
  role?: string;
}) {
  const { t, notify } = useApp();
  const [busy, setBusy] = useState(false),
    [created, setCreated] = useState<any>(null),
    [error, setError] = useState("");
  return (
    <Modal
      title={t(
        role === "expert" ? "Добавить эксперта" : "Новый сотрудник",
        role === "expert" ? "Сарапшы қосу" : "Жаңа қызметкер",
      )}
      description={t(
        "Данные для входа появятся после создания. Передайте их сотруднику самостоятельно.",
        "Жасалғаннан кейін кіру деректері көрсетіледі. Оларды қызметкерге өзіңіз беріңіз.",
      )}
      onClose={onClose}
    >
      <div className="modal-body">
        {created ? (
          <div className="form-stack">
            <div className="notice success">
              <CheckCircle2 size={18} />
              {t("Учётная запись создана", "Тіркелгі жасалды")}
            </div>
            <div className="credential-box">
              <span>Email: {created.user.email}</span>
              <code>{created.temporaryPassword}</code>
              <small>
                {t(
                  "Временный пароль. При первом входе потребуется его изменить.",
                  "Уақытша құпиясөз. Алғаш кіргенде оны өзгерту қажет.",
                )}
              </small>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(
                  `Email: ${created.user.email}\n${t("Пароль", "Құпиясөз")}: ${created.temporaryPassword}`,
                );
                notify(t("Данные скопированы", "Деректер көшірілді"));
              }}
            >
              <Copy size={15} />
              {t("Скопировать данные", "Деректерді көшіру")}
            </Button>
            <Button onClick={onClose}>{t("Готово", "Дайын")}</Button>
          </div>
        ) : (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const data = Object.fromEntries(new FormData(e.currentTarget));
              try {
                setCreated(await post("/people", { ...data, role }));
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <Field label={t("ФИО", "Аты-жөні")}>
                <input
                  name="name"
                  required
                  minLength={3}
                  placeholder={t(
                    "Фамилия Имя Отчество",
                    "Тегі Аты Әкесінің аты",
                  )}
                />
              </Field>
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="name@company.kz"
                />
              </Field>
              <Field label={t("Должность", "Лауазымы")}>
                <input name="position" required />
              </Field>
              <Field label={t("Подразделение", "Бөлімше")}>
                <input
                  name="unit"
                  required
                  defaultValue={t("Головной офис", "Бас кеңсе")}
                />
              </Field>
              <Field label={t("Категория должности", "Лауазым санаты")}>
                <input
                  name="category"
                  defaultValue={t("Руководитель", "Басшы")}
                />
              </Field>
              <Field label={t("Язык интерфейса", "Интерфейс тілі")}>
                <select name="locale">
                  <option value="ru">Русский</option>
                  <option value="kk">Қазақша</option>
                </select>
              </Field>
            </div>
            {error && <div className="notice error">{error}</div>}
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t("Отмена", "Бас тарту")}
              </Button>
              <Button busy={busy}>
                {t("Создать сотрудника", "Қызметкер жасау")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
function AssignModal({
  selected,
  experts,
  onClose,
  onSaved,
}: {
  selected: string[];
  experts: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, loc, campaign } = useApp();
  const { data } = useData<any[]>("/tests");
  const [ids, setIds] = useState<string[] | null>(null),
    [expert, setExpert] = useState(experts[0]?.id || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const versions = (data || []).flatMap((test) =>
    test.versions
      .filter((v: any) => v.status === "published")
      .slice(0, 1)
      .map((v: any) => ({ ...v, name: test.name })),
  );
  return (
    <Modal
      title={t("Назначение тестирований", "Тесттерді тағайындау")}
      description={t(
        `Выбрано участников: ${selected.length}`,
        `Таңдалған қатысушылар: ${selected.length}`,
      )}
      onClose={onClose}
    >
      <form
        className="modal-body form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post("/assignments", {
              campaignId: campaign,
              membershipIds: selected,
              testVersionIds: ids ?? versions.map((v) => v.id),
              expertId: expert,
            });
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="notice">
          {t(
            "По умолчанию назначаются все опубликованные методики. Можно выбрать отдельные направления.",
            "Әдепкіде барлық жарияланған әдістемелер тағайындалады. Жеке бағыттарды таңдауға болады.",
          )}
        </div>
        {versions.map((v) => (
          <label className="row" key={v.id}>
            <input
              type="checkbox"
              checked={ids === null || ids.includes(v.id)}
              onChange={(e) => {
                const current = ids ?? versions.map((x) => x.id);
                setIds(
                  e.target.checked
                    ? [...new Set([...current, v.id])]
                    : current.filter((id) => id !== v.id),
                );
              }}
            />
            <span>{loc(v.name)}</span>
          </label>
        ))}
        <Field label={t("Ответственный эксперт", "Жауапты сарапшы")}>
          <select
            value={expert}
            onChange={(e) => setExpert(e.target.value)}
            required
          >
            <option value="">
              {t("Выберите эксперта", "Сарапшыны таңдаңыз")}
            </option>
            {experts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.user.name}
              </option>
            ))}
          </select>
        </Field>
        {error && <div className="notice error">{error}</div>}
        <Button
          busy={busy}
          disabled={!expert || !versions.length || ids?.length === 0}
        >
          {t("Назначить", "Тағайындау")}
        </Button>
      </form>
    </Modal>
  );
}
function ImportModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useApp();
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState("");
  return (
    <Modal
      title={t("Импорт сотрудников", "Қызметкерлер импорты")}
      onClose={onClose}
      wide
    >
      <div className="modal-body form-stack">
        <p className="text-small text-muted">
          {t(
            "Excel или CSV. Заголовки: name, email, position, unit, category, locale. Обязательные: name, email, unit.",
            "Excel немесе CSV. Бағандар: name, email, position, unit, category, locale. Міндетті: name, email, unit.",
          )}
        </p>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {error && <div className="notice error">{error}</div>}
        {result && (
          <>
            <div className="notice success">
              {t(
                `Создано: ${result.created.length}. Ошибок: ${result.errors.length}.`,
                `Жасалды: ${result.created.length}. Қателер: ${result.errors.length}.`,
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>{t("Временный пароль", "Уақытша құпиясөз")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.created.map((c: any) => (
                    <tr key={c.id}>
                      <td>{c.user.email}</td>
                      <td>
                        <code>{c.temporaryPassword}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.errors.map((e: any, i: number) => (
              <div className="notice error" key={i}>
                {e.row}: {e.message}
              </div>
            ))}
          </>
        )}
        {!result && (
          <Button
            busy={busy}
            disabled={!file}
            onClick={async () => {
              setBusy(true);
              try {
                if (!file || file.size > 8 * 1024 * 1024)
                  throw new Error(t("Максимум 8 МБ", "Ең көбі 8 МБ"));
                const reader = new FileReader();
                const base64 = await new Promise<string>((resolve, reject) => {
                  reader.onload = () =>
                    resolve(String(reader.result).split(",")[1]);
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
                });
                setResult(
                  await post("/import/people", { name: file.name, base64 }),
                );
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Импортировать", "Импорттау")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
export function Campaigns() {
  const { t, campaigns, reload, setCampaign } = useApp();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <PageTitle
        title={t("Кампании оценки", "Бағалау науқандары")}
        description={t(
          "Каждая кампания сохраняет собственные назначения, результаты и отчёты.",
          "Әр науқан өз тапсырмаларын, нәтижелерін және есептерін сақтайды.",
        )}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            {t("Создать кампанию", "Науқан жасау")}
          </Button>
        }
      />
      <div className="test-grid">
        {campaigns.map((c) => (
          <Panel key={c.id} className="panel-padded">
            <div className="row between">
              <CalendarDays size={22} color="#6e8c92" />
              <Badge status={c.status} />
            </div>
            <h2 style={{ margin: "20px 0 9px" }}>{c.name}</h2>
            <p className="text-small text-muted">{c.description}</p>
            <p className="text-small text-muted mt">
              {date(c.startsAt)} — {date(c.endsAt)}
            </p>
            <Link
              href="/people"
              onClick={() => setCampaign(c.id)}
              className="btn secondary full-width mt"
            >
              {t("Открыть участников", "Қатысушыларды ашу")}
              <ArrowRight size={15} />
            </Link>
          </Panel>
        ))}
      </div>
      {open && (
        <Modal
          title={t("Новая кампания", "Жаңа науқан")}
          onClose={() => setOpen(false)}
        >
          <form
            className="modal-body form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const d = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await post("/campaigns", {
                  ...d,
                  endsAt: new Date(
                    String(d.endsAt) + "T23:59:59",
                  ).toISOString(),
                });
                await reload();
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={t("Название", "Атауы")}>
              <input
                name="name"
                required
                placeholder={t(
                  "Руководители — осень 2026",
                  "Басшылар — 2026 жылдың күзі",
                )}
              />
            </Field>
            <Field label={t("Описание", "Сипаттамасы")}>
              <textarea name="description" rows={3} />
            </Field>
            <Field label={t("Дата завершения", "Аяқталу күні")}>
              <input name="endsAt" type="date" required />
            </Field>
            {error && <div className="notice error">{error}</div>}
            <Button busy={busy}>{t("Создать кампанию", "Науқан жасау")}</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Library() {
  const { t, loc, me } = useApp();
  const { data, loading, error } = useData<any[]>("/tests");
  const [detail, setDetail] = useState<any>(null);
  return (
    <>
      <PageTitle
        title={t("Библиотека тестов", "Тесттер кітапханасы")}
        description={t(
          "Шесть направлений оценки. Источники, версии и методологические ограничения.",
          "Бағалаудың алты бағыты. Дереккөздер, нұсқалар және әдістемелік шектеулер.",
        )}
      />
      <LoadState loading={loading} error={error}>
        <div className="test-grid">
          {(data || []).map((m) => {
            const v = m.versions[0],
              Icon = methodIcons[m.direction] || BookOpen;
            return (
              <div className="test-card" key={m.id}>
                <div className="test-card-top">
                  <span className="test-icon">
                    <Icon size={22} />
                  </span>
                  <Badge status={v?.status || "draft"} />
                </div>
                <div>
                  <h3>{loc(m.name)}</h3>
                  <p style={{ marginTop: 9 }}>
                    {m.id === "personality"
                      ? "IPIP-NEO-120 · Big Five"
                      : m.id === "motivation"
                        ? "WMPS · 6 шкал"
                        : m.id === "verbal"
                          ? "ICAR · Verbal Reasoning"
                          : m.id === "numerical"
                            ? "Berlin Numeracy Test"
                            : m.id === "logical"
                              ? "OMIB · Technical adapted form"
                              : "123test · MOST / LEAST"}
                  </p>
                </div>
                <div className="test-meta">
                  <span>
                    <ClipboardList size={13} />
                    {v?._count.questions || 0} {t("заданий", "тапсырма")}
                  </span>
                  <span>
                    <Clock3 size={13} />
                    {v?.durationMinutes || 0} {t("мин", "мин")}
                  </span>
                </div>
                <div className="method-note">
                  {t("Версия", "Нұсқа")} {v?.version} · RU / ҚАЗ
                </div>
                <Button variant="secondary" onClick={() => setDetail(m)}>
                  {t("О методике", "Әдістеме туралы")}
                  <ArrowUpRight size={14} />
                </Button>
              </div>
            );
          })}
        </div>
      </LoadState>
      {detail && (
        <Modal title={loc(detail.name)} onClose={() => setDetail(null)} wide>
          <div className="modal-body form-stack">
            <Field label={t("Инструкция", "Нұсқаулық")}>
              <p className="report-text">
                {loc(detail.versions[0].instructions)}
              </p>
            </Field>
            <div className="notice warning">
              <Info size={18} />
              <p>{loc(detail.versions[0].limitations)}</p>
            </div>
            <p className="text-small text-muted">
              {t("Перевод:", "Аударма:")}{" "}
              {detail.versions[0].translationStatus === "approved"
                ? t("утверждён", "бекітілген")
                : t(
                    "подготовлен, ожидает проверки",
                    "дайындалған, тексеруді күтуде",
                  )}
            </p>
            <a
              href={detail.source}
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              {t("Открыть первоисточник", "Бастапқы дереккөзді ашу")}
              <ArrowUpRight size={14} />
            </a>
            {me.role === "superadmin" && (
              <Link
                href={`/platform?method=${detail.versions[0].id}`}
                className="btn secondary"
              >
                {t(
                  "Управление версией и ключами",
                  "Нұсқа мен кілттерді басқару",
                )}
              </Link>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
export function Analytics() {
  const { t, campaign, loc, notify } = useApp();
  const { data, loading, error } = useData<any[]>(
    campaign ? `/people?campaignId=${campaign}` : null,
  );
  const [group, setGroup] = useState("unit");
  const people = (data || []).filter((p) => p.role === "employee");
  const groups = [...new Set(people.map((p) => p[group]))];
  const results = people.flatMap((p) => p.results.filter((r: any) => r.score));
  const groupKey = (r: any) =>
    [r.testVersionId, r.scoringKeyId, r.language].join(":");
  const methods = [...new Set(results.map(groupKey))];
  return (
    <>
      <PageTitle
        title={t("Командная аналитика", "Командалық талдау")}
        description={t(
          "Сопоставимые показатели текущей кампании — без единого рейтинга пригодности.",
          "Ағымдағы науқанның салыстырмалы көрсеткіштері.",
        )}
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              download(`/export/team?campaignId=${campaign}`, "team.pdf").catch(
                (e) => notify(e.message, "error"),
              )
            }
          >
            <Download size={15} />
            {t("Скачать отчёт", "Есепті жүктеу")}
          </Button>
        }
      />
      <LoadState loading={loading} error={error}>
        <div className="chip-filter">
          <button
            className={group === "unit" ? "active" : ""}
            onClick={() => setGroup("unit")}
          >
            {t("По подразделениям", "Бөлімшелер бойынша")}
          </button>
          <button
            className={group === "category" ? "active" : ""}
            onClick={() => setGroup("category")}
          >
            {t("По категориям должностей", "Лауазым санаттары бойынша")}
          </button>
        </div>
        <div className="dashboard-grid">
          <Panel
            title={t("Завершение тестирования", "Тестілеуді аяқтау")}
            description={t(
              "Доля завершивших все назначенные тесты",
              "Барлық тағайындалған тесттерді аяқтағандар үлесі",
            )}
          >
            <div className="bar-chart">
              {groups.map((g) => {
                const members = people.filter((p) => p[group] === g),
                  done = members.filter((p) => p.status === "completed").length;
                const percent = Math.round((done / members.length) * 100);
                return (
                  <div className="bar-chart-row" key={g}>
                    <span>{g}</span>
                    <div className="bar-track">
                      <span style={{ width: percent + "%" }} />
                    </div>
                    <strong>{percent}%</strong>
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel title={t("Основания для интерпретации", "Түсіндіруге негіз")}>
            <div className="panel-body">
              <div className="notice">
                <ShieldCheck size={20} />
                <p>
                  {t(
                    "Показатели разных методик не складываются. Для каждой шкалы сохраняются её диапазон, версия и ограничения.",
                    "Әртүрлі әдістемелердің көрсеткіштері қосылмайды. Әр шкаланың ауқымы, нұсқасы және шектеулері сақталады.",
                  )}
                </p>
              </div>
              <p className="text-small text-muted mt">
                {t(
                  "Расположение в матрице потенциала определяется экспертом с письменным обоснованием.",
                  "Әлеует матрицасындағы орынды сарапшы жазбаша негіздемемен анықтайды.",
                )}
              </p>
            </div>
          </Panel>
        </div>
        <Panel
          title={t(
            "Сводные результаты методик",
            "Әдістемелердің жиынтық нәтижелері",
          )}
          description={t(
            "Средние первичные показатели завершённых прохождений",
            "Аяқталған тесттердің орташа бастапқы көрсеткіштері",
          )}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("МЕТОДИКА", "ӘДІСТЕМЕ")}</th>
                  <th>N</th>
                  <th>{t("ПОКАЗАТЕЛЬ", "КӨРСЕТКІШ")}</th>
                  <th>{t("ИНТЕРПРЕТАЦИЯ", "ТҮСІНДІРУ")}</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((id) => {
                  const rs = results.filter((r) => groupKey(r) === id);
                  const s = rs[0].score;
                  return (
                    <tr key={id}>
                      <td>
                        {loc(rs[0].name)}
                        <small className="block text-muted">
                          v{rs[0].version} · {rs[0].language?.toUpperCase()}
                        </small>
                      </td>
                      <td>{rs.length}</td>
                      <td>
                        {s.total !== undefined
                          ? `${(rs.reduce((a, r) => a + r.score.total, 0) / rs.length).toFixed(1)} / ${s.maximum}`
                          : t(
                              `${Object.keys(s.scales).length} шкал`,
                              `${Object.keys(s.scales).length} шкала`,
                            )}
                      </td>
                      <td className="text-small text-muted">
                        {t(
                          "Первичные баллы, без нормативов",
                          "Нормаларсыз бастапқы балдар",
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </LoadState>
    </>
  );
}
export function Matrix() {
  const { t, loc, campaign, me } = useApp();
  const { data, loading, error } = useData<any[]>(
    campaign ? `/people?campaignId=${campaign}` : null,
  );
  const [unit, setUnit] = useState("all");
  const people = (data || []).filter(
    (p) => p.role === "employee" && (unit === "all" || p.unit === unit),
  );
  const config = me.organization.matrixConfig;
  return (
    <>
      <PageTitle
        title={t("Матрица потенциала", "Әлеует матрицасы")}
        description={t(
          "9-box · Экспертная оценка компетенций и потенциала развития.",
          "9-box · Құзыреттер мен даму әлеуетін сараптамалық бағалау.",
        )}
      />
      <LoadState loading={loading} error={error}>
        <div className="notice section-gap" style={{ marginBottom: 22 }}>
          <Info size={18} />
          <p>
            {config.criteria}{" "}
            {t(
              "Нажмите на сотрудника, чтобы открыть обоснование и отчёт.",
              "Негіздеме мен есепті ашу үшін қызметкерді басыңыз.",
            )}
          </p>
        </div>
        <Panel
          title={loc(config.y)}
          action={
            <select
              style={{ width: "auto", fontSize: 14 }}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              aria-label="Подразделение"
            >
              <option value="all">
                {t("Все подразделения", "Барлық бөлімшелер")}
              </option>
              {[...new Set((data || []).map((p) => p.unit))].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          }
        >
          <div className="matrix-grid">
            {[3, 2, 1].flatMap((y) =>
              [1, 2, 3].map((x) => {
                const members = people.filter(
                  (p) => p.report?.matrixX === x && p.report?.matrixY === y,
                );
                return (
                  <div
                    className={`matrix-cell zone-${Math.ceil((x + y) / 2)}`}
                    key={`${x}-${y}`}
                  >
                    <div className="matrix-cell-head">
                      <span>
                        {loc(config.levels[y - 1])} /{" "}
                        {loc(config.levels[x - 1])}
                      </span>
                      <b>{members.length}</b>
                    </div>
                    {members.map((p) => (
                      <Link
                        href={`/people/${p.id}`}
                        key={p.id}
                        className="matrix-person"
                      >
                        <Avatar name={p.user.name} size="small" />
                        <span>{p.user.name}</span>
                      </Link>
                    ))}
                  </div>
                );
              }),
            )}
          </div>
          <div className="matrix-x-labels">
            {config.levels.map((l: any, i: number) => (
              <span key={i}>{loc(l)}</span>
            ))}
          </div>
          <div className="matrix-axis">{loc(config.x)} →</div>
          <div className="matrix-unrated">
            {t("Ожидают экспертной оценки:", "Сараптамалық бағалауды күтуде:")}{" "}
            {people.filter((p) => !p.report?.matrixX).length}
          </div>
        </Panel>
      </LoadState>
    </>
  );
}
export function Reports() {
  const { t, campaign, notify } = useApp();
  const { data, loading, error } = useData<any[]>(
    campaign ? `/people?campaignId=${campaign}` : null,
  );
  const [filter, setFilter] = useState("all");
  const people = (data || []).filter(
    (p) =>
      p.role === "employee" &&
      (filter === "all" ||
        (filter === "ready"
          ? p.report?.status === "approved"
          : p.status === "completed" && p.report?.status !== "approved")),
  );
  return (
    <>
      <PageTitle
        title={t("Отчёты и заключения", "Есептер мен қорытындылар")}
        description={t(
          "Предварительный анализ и утверждённые заключения хранятся отдельно.",
          "Алдын ала талдау мен бекітілген қорытындылар бөлек сақталады.",
        )}
      />
      <div className="chip-filter">
        {[
          ["all", t("Все участники", "Барлық қатысушылар")],
          ["ready", t("Утверждённые", "Бекітілген")],
          ["waiting", t("Ожидают эксперта", "Сарапшыны күтуде")],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <LoadState loading={loading} error={error}>
        <Panel>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("УЧАСТНИК", "ҚАТЫСУШЫ")}</th>
                  <th>{t("ТЕСТИРОВАНИЕ", "ТЕСТІЛЕУ")}</th>
                  <th>AI-{t("АНАЛИЗ", "ТАЛДАУ")}</th>
                  <th>{t("ЗАКЛЮЧЕНИЕ", "ҚОРЫТЫНДЫ")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link className="cell-person" href={`/people/${p.id}`}>
                        <Avatar name={p.user.name} />
                        <div>
                          <strong>{p.user.name}</strong>
                          <small>{p.unit}</small>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <Badge status={p.status} />
                    </td>
                    <td>
                      <Badge status={p.aiStatus} />
                    </td>
                    <td>
                      {p.report ? (
                        <Badge status={p.report.status} />
                      ) : (
                        <span className="text-small text-muted">
                          {t("Не сформировано", "Қалыптастырылмады")}
                        </span>
                      )}
                    </td>
                    <td>
                      {p.report ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            download(
                              `/reports/${p.report.id}/pdf`,
                              "assessflow-report.pdf",
                            ).catch((e) => notify(e.message, "error"))
                          }
                        >
                          <Download size={13} />
                          PDF
                        </Button>
                      ) : (
                        <Link href={`/people/${p.id}`} className="text-link">
                          {t("Открыть", "Ашу")}
                          <ArrowUpRight size={13} />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!people.length && (
            <Empty title={t("Отчётов пока нет", "Әзірге есептер жоқ")} />
          )}
        </Panel>
      </LoadState>
    </>
  );
}
