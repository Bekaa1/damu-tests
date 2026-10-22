"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  LayoutDashboard,
  Users,
  CalendarDays,
  BookOpen,
  ChartNoAxesCombined,
  Grid2X2,
  FileText,
  ClipboardCheck,
  SlidersHorizontal,
  Settings,
  Building2,
  ChevronDown,
  LogOut,
  Menu,
  X,
  HelpCircle,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  AppCtx,
  api,
  post,
  patch,
  Button,
  Avatar,
  Field,
  type Session,
  type Locale,
} from "./ui";
import {
  Overview,
  People,
  Campaigns,
  Library,
  Analytics,
  Matrix,
  Reports,
} from "./organization";
import { Participant, Criteria, SettingsPage, Platform } from "./management";
import { EmployeeHome, TestRunner, MyResults } from "./employee";
export function Application() {
  const router = useRouter(),
    path = usePathname();
  const [me, setMe] = useState<Session | null>(null),
    [locale, setLocale] = useState<Locale>("ru"),
    [campaign, setCampaignState] = useState(""),
    [campaigns, setCampaigns] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState<{ text: string; type: string } | null>(null),
    [help, setHelp] = useState(false);
  const t = (ru: string, kk: string) => (locale === "kk" ? kk : ru);
  const reload = useCallback(async () => {
    try {
      const session = await api<Session>("/me");
      setMe(session);
      setLocale(
        (localStorage.getItem("assessflow.locale") as Locale) ||
          session.user.locale ||
          "ru",
      );
      if (!session.user.mustChangePassword) {
        const cs = session.organization ? await api<any[]>("/campaigns") : [];
        setCampaigns(cs);
        setCampaignState((prev) =>
          cs.some((c) => c.id === prev) ? prev : cs[0]?.id || "",
        );
      }
      setError("");
    } catch (e) {
      setMe(null);
      if (path !== "/login") router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [path, router]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    setMobile(false);
  }, [path]);
  useEffect(() => {
    if (me?.role === "employee" && path === "/") router.replace("/cabinet");
  }, [me, path, router]);
  useEffect(() => {
    if (toast) {
      const tm = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(tm);
    }
  }, [toast]);
  const notify = (text: string, type: "success" | "error" = "success") =>
    setToast({ text, type });
  const changeLocale = (lang: Locale) => {
    setLocale(lang);
    localStorage.setItem("assessflow.locale", lang);
    if (me) void patch("/me/locale", { locale: lang });
  };
  if (path === "/login")
    return (
      <Login
        onSuccess={async () => {
          await reload();
          router.replace("/");
        }}
        locale={locale}
        setLocale={changeLocale}
      />
    );
  if (loading || !me)
    return (
      <div className="full-loading">
        <Brand />
        <span>
          {t("Загрузка рабочего пространства…", "Жұмыс кеңістігі жүктелуде…")}
        </span>
      </div>
    );
  if (me.user.mustChangePassword)
    return <ChangePassword onDone={reload} locale={locale} />;
  const isEmployee = me.role === "employee",
    isExpert = me.role === "expert";
  const nav = [
    {
      href: isEmployee ? "/cabinet" : "/",
      label: t(
        isEmployee ? "Мой кабинет" : "Обзор",
        isEmployee ? "Жеке кабинет" : "Шолу",
      ),
      icon: LayoutDashboard,
    },
    ...(isEmployee
      ? [
          {
            href: "/my-results",
            label: t("Мои результаты", "Менің нәтижелерім"),
            icon: ChartNoAxesCombined,
          },
        ]
      : [
          {
            href: "/people",
            label: t(
              isExpert ? "Мои участники" : "Сотрудники",
              isExpert ? "Менің қатысушыларым" : "Қызметкерлер",
            ),
            icon: Users,
          },
          ...(!isExpert
            ? [
                {
                  href: "/campaigns",
                  label: t("Кампании оценки", "Бағалау науқандары"),
                  icon: CalendarDays,
                },
              ]
            : []),
          {
            href: "/library",
            label: t("Библиотека тестов", "Тесттер кітапханасы"),
            icon: BookOpen,
          },
          {
            href: "/analytics",
            label: t("Аналитика", "Талдау"),
            icon: ChartNoAxesCombined,
          },
          {
            href: "/matrix",
            label: t("Матрица потенциала", "Әлеует матрицасы"),
            icon: Grid2X2,
          },
          { href: "/reports", label: t("Отчёты", "Есептер"), icon: FileText },
          ...(isExpert
            ? [
                {
                  href: "/expert",
                  label: t("Экспертная проверка", "Сараптамалық тексеру"),
                  icon: ClipboardCheck,
                },
              ]
            : [
                {
                  href: "/criteria",
                  label: t("Критерии оценки", "Бағалау критерийлері"),
                  icon: SlidersHorizontal,
                },
              ]),
          ...(!isExpert
            ? [
                {
                  href: "/settings",
                  label: t("Настройки", "Баптаулар"),
                  icon: Settings,
                },
              ]
            : []),
          ...(me.role === "superadmin"
            ? [
                {
                  href: "/platform",
                  label: t("Управление платформой", "Платформаны басқару"),
                  icon: Building2,
                },
              ]
            : []),
        ]),
  ];
  const roleLabel = t(
    me.role === "superadmin"
      ? "Суперадминистратор"
      : isEmployee
        ? "Участник оценки"
        : isExpert
          ? "Эксперт"
          : "Администратор",
    me.role === "superadmin"
      ? "Суперәкімші"
      : isEmployee
        ? "Бағалау қатысушысы"
        : isExpert
          ? "Сарапшы"
          : "Әкімші",
  );
  let page =
    path === "/cabinet" ? (
      isEmployee ? <EmployeeHome /> : <Overview />
    ) : path === "/" ? (
      !me.organization && me.role === "superadmin" ? (
        <Platform />
      ) : isEmployee ? (
        <EmployeeHome />
      ) : (
        <Overview />
      )
    ) : path === "/people" ? (
      <People />
    ) : path === "/campaigns" ? (
      <Campaigns />
    ) : path === "/library" ? (
      <Library />
    ) : path === "/analytics" ? (
      <Analytics />
    ) : path === "/matrix" ? (
      <Matrix />
    ) : path === "/reports" ? (
      <Reports />
    ) : path === "/expert" ? (
      <People expert />
    ) : path === "/criteria" ? (
      <Criteria />
    ) : path === "/settings" ? (
      <SettingsPage />
    ) : path === "/platform" ? (
      <Platform />
    ) : path === "/my-tests" ? (
      <EmployeeHome catalog />
    ) : path === "/my-results" ? (
      <MyResults />
    ) : path.startsWith("/people/") ? (
      <Participant id={path.split("/")[2]} />
    ) : path.startsWith("/test/") ? (
      <TestRunner id={path.split("/")[2]} />
    ) : (
      <div className="empty">
        <h1>{t("Страница не найдена", "Бет табылмады")}</h1>
        <Link href="/">{t("На главную", "Басты бетке")}</Link>
      </div>
    );
  return (
    <AppCtx.Provider
      value={{
        me,
        locale,
        t,
        loc: (v) => (typeof v === "string" ? v : v?.[locale] || v?.ru || ""),
        campaign,
        setCampaign: setCampaignState,
        campaigns,
        notify,
        reload,
      }}
    >
      <div className="app-shell">
        <a className="skip-link" href="#main">
          {t("Перейти к содержимому", "Мазмұнға өту")}
        </a>
        {mobile && (
          <button
            className="sidebar-scrim"
            onClick={() => setMobile(false)}
            aria-label="Закрыть меню"
          />
        )}
        <aside className={`sidebar ${mobile ? "open" : ""}`}>
          <Link className="brand-link" href={isEmployee ? "/cabinet" : "/"}>
            <Brand />
          </Link>
          <div className="workspace-label">
            {t("РАБОЧЕЕ ПРОСТРАНСТВО", "ЖҰМЫС КЕҢІСТІГІ")}
          </div>
          <div className="workspace">
            <span className="workspace-icon">
              <Building2 size={19} />
            </span>
            <div>
              <strong>{me.organization?.name || "AssessFlow"}</strong>
              <small>{t("Оценка и развитие", "Бағалау және даму")}</small>
            </div>
          </div>
          <nav aria-label={t("Главная навигация", "Негізгі навигация")}>
            {nav.map((n, i) => (
              <Link
                key={n.href}
                href={n.href}
                className={`nav-item ${path === n.href || (n.href === "/people" && path.startsWith("/people/")) ? "active" : ""} ${i === 4 ? "nav-divider" : ""}`}
              >
                <n.icon size={19} />
                <span>{n.label}</span>
                {n.href === "/people" && (
                  <span className="nav-count">
                    <ArrowUpRight size={13} />
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button className="nav-item" onClick={() => setHelp(!help)}>
              <HelpCircle size={19} />
              {t("Помощь и поддержка", "Көмек және қолдау")}
            </button>
          </div>
        </aside>
        <div className="workspace-main">
          <header className="topbar">
            <div className="top-left">
              <button
                className="icon-btn mobile-menu"
                onClick={() => setMobile(true)}
                aria-label="Меню"
              >
                <Menu size={22} />
              </button>
            {isEmployee && path === "/cabinet" && (
              <div className="header-greeting">
                <strong>
                  {t(
                    `Здравствуйте, ${me.user.name.split(" ")[0]}`,
                    `Сәлеметсіз бе, ${me.user.name.split(" ")[0]}`,
                  )}
                </strong>
                <small>
                  {[me.member?.position, me.organization?.name]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
            )}
            {isEmployee && path === "/my-results" && (
              <div className="header-greeting">
                <strong>{t("Мои результаты", "Менің нәтижелерім")}</strong>
                <small>
                  {t(
                    "Результаты тестирования и экспертное заключение.",
                    "Тестілеу нәтижелері мен сараптамалық қорытынды.",
                  )}
                </small>
              </div>
            )}
            </div>
            <div className="top-right">
            {!path.startsWith("/test/") && (
              <div className="campaign-switch header-campaign">
                <CalendarDays size={15} />
                <select
                  aria-label={t("Кампания оценки", "Бағалау науқаны")}
                  value={campaign}
                  onChange={(e) => setCampaignState(e.target.value)}
                >
                  {campaigns.length ? (
                    campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                  ) : (
                    <option>{t("Нет кампаний", "Науқандар жоқ")}</option>
                  )}
                </select>
              </div>
            )}
              <div className="language-toggle">
                <button
                  aria-pressed={locale === "ru"}
                  className={locale === "ru" ? "selected" : ""}
                  onClick={() => changeLocale("ru")}
                >
                  RU
                </button>
                <button
                  aria-pressed={locale === "kk"}
                  className={locale === "kk" ? "selected" : ""}
                  onClick={() => changeLocale("kk")}
                >
                  ҚАЗ
                </button>
              </div>
              <span className="header-separator" />
              <div className="user-menu">
                <Avatar name={me.user.name} />
                <div>
                  <strong>
                    {me.user.name.split(" ").slice(0, 2).join(" ")}
                  </strong>
                  <small>{roleLabel}</small>
                </div>
                <button
                  className="icon-btn"
                  title={t("Выйти", "Шығу")}
                  onClick={async () => {
                    await post("/auth/sign-out");
                    setMe(null);
                    router.push("/login");
                  }}
                  aria-label={t("Выйти", "Шығу")}
                >
                  <LogOut size={17} />
                </button>
              </div>
            </div>
          </header>
          <main id="main" className="main-content">
            {!path.startsWith("/test/") &&
              (!isEmployee || (path !== "/cabinet" && path !== "/my-results")) && (
              <div className="campaign-switch mobile-campaign">
                  <CalendarDays size={15} />
                  <select
                    aria-label={t("Кампания оценки", "Бағалау науқаны")}
                    value={campaign}
                    onChange={(e) => setCampaignState(e.target.value)}
                  >
                    {campaigns.length ? (
                      campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    ) : (
                      <option>{t("Нет кампаний", "Науқандар жоқ")}</option>
                    )}
                  </select>
              </div>
            )}
            {page}
            <footer className="footer">
              <span>© {new Date().getFullYear()} AssessFlow</span>
              <span>
                {t(
                  "Оценка, которая помогает развиваться",
                  "Дамуға көмектесетін бағалау",
                )}
              </span>
            </footer>
          </main>
        </div>
      </div>
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.type === "error" ? (
            <AlertCircle size={19} />
          ) : (
            <CheckCircle2 size={19} />
          )}
          <span>{toast.text}</span>
          <button aria-label="Закрыть" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <div className="help-popover">
          <button
            className="icon-btn"
            onClick={() => setHelp(false)}
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
          <h3>
            {t("Как работать с AssessFlow", "AssessFlow-мен жұмыс істеу")}
          </h3>
          <p>
            {t(
              "Администратор создаёт сотрудников, кампанию и назначения. Участник проходит тесты, эксперт добавляет наблюдения и утверждает отчёт.",
              "Әкімші қызметкерлерді, науқанды және тапсырмаларды жасайды. Қатысушы тесттерден өтеді, сарапшы бақылауларын қосып, есепті бекітеді.",
            )}
          </p>
          <p>
            {t(
              "Для восстановления доступа обратитесь к администратору своей организации.",
              "Қолжетімділікті қалпына келтіру үшін ұйым әкімшісіне хабарласыңыз.",
            )}
          </p>
        </div>
      )}
    </AppCtx.Provider>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <i />
        <i />
        <i />
      </span>
      <span>
        Assess<span className="brand-flow">Flow</span>
      </span>
    </div>
  );
}
function Login({
  onSuccess,
  locale,
  setLocale,
}: {
  onSuccess: () => Promise<void>;
  locale: Locale;
  setLocale: (l: Locale) => void;
}) {
  const t = (r: string, k: string) => (locale === "ru" ? r : k);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      localStorage.removeItem("assessflow.org");
      await post("/auth/sign-in/email", { email, password });
      await onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <div className="login-language">
        <label htmlFor="login-locale">{t("Язык", "Тіл")}</label>
        <select
          id="login-locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          aria-label={t("Язык интерфейса", "Интерфейс тілі")}
        >
          <option value="ru">Русский</option>
          <option value="kk">Қазақша</option>
        </select>
      </div>
      <div className="login-form-wrap">
        <div className="login-brand">
          <Brand />
        </div>
        <h2>{t("Вход", "Кіру")}</h2>
        <form onSubmit={login}>
          <Field label={t("Логин (Email)", "Логин (Email)")}>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="name@company.kz"
            />
          </Field>
          <Field label={t("Пароль", "Құпиясөз")}>
            <span className="password-input">
              <input
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder={t("Введите пароль", "Құпиясөзді енгізіңіз")}
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={t("Показать пароль", "Құпиясөзді көрсету")}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </Field>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <Button type="submit" busy={busy} className="full-width">
            {t("Войти", "Кіру")}
          </Button>
        </form>
      </div>
    </div>
  );
}
function ChangePassword({
  onDone,
  locale,
}: {
  onDone: () => Promise<void>;
  locale: Locale;
}) {
  const t = (ru: string, kk: string) => (locale === "ru" ? ru : kk);
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="password-page">
      <Brand />
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post("/me/password", {
              currentPassword: current,
              newPassword: next,
            });
            await onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>{t("Задайте свой пароль", "Өз құпиясөзіңізді орнатыңыз")}</h1>
        <p>
          {t(
            "Временный пароль нужно заменить перед началом работы.",
            "Жұмысты бастамас бұрын уақытша құпиясөзді өзгертіңіз.",
          )}
        </p>
        <Field label={t("Временный пароль", "Уақытша құпиясөз")}>
          <input
            autoComplete="current-password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </Field>
        <Field
          label={t("Новый пароль", "Жаңа құпиясөз")}
          hint={t("Не менее 12 символов", "Кемінде 12 таңба")}
        >
          <input
            autoComplete="new-password"
            type="password"
            minLength={12}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </Field>
        {error && <div className="notice error">{error}</div>}
        <Button busy={busy}>
          {t("Сохранить и продолжить", "Сақтау және жалғастыру")}
        </Button>
      </form>
    </div>
  );
}
