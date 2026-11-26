"use client";
import dynamic from "next/dynamic";
import { Consent, ConsentRecord, AnswerRecovery } from "./consent";
import { hasCurrentConsent } from "../../../packages/core/pilot";
import { clearExpiredParticipantCache } from "../../../packages/core/pilot-cache";
import { alignOfflineSession, cacheOfflineSession, clearOfflineSession, restoreOfflineSession } from "./offline-session";
import { CompetencyModelEditor } from "./competencies";
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
  bootstrapSession,
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
} from "./organization";
import { Participant, Criteria, SettingsPage, Platform } from "./management";
import { EmployeeHome, TestRunner } from "./employee";
import { ReportCenter } from "./report-center";
import { GroupWorkspace } from "./group-workspace";
const VideoArchive = dynamic(() => import("./video-archive").then(m => m.VideoArchive));

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
    setLoading(true);
    try {    clearExpiredParticipantCache(localStorage); } catch {}
    try {
      const session = await bootstrapSession<Session>();
      alignOfflineSession(localStorage, session);
      setLocale(
        (localStorage.getItem("assessflow.locale") as Locale) ||
          session.user.locale ||
          "ru",
      );
      if (
        !session.user.mustChangePassword &&
        (session.role !== "employee" ||
          (!session.video?.needsConsent && hasCurrentConsent(session.member, session.organization)))
      ) {
        const cs = session.organization ? await api<any[]>("/campaigns") : [];
        setCampaigns(cs);
        if (session.role === "employee") cacheOfflineSession(localStorage, session, cs);
        else clearOfflineSession(localStorage);
        setCampaignState((prev) =>
          cs.some((c) => c.id === prev) ? prev : cs[0]?.id || "",
        );
      } else {
        clearOfflineSession(localStorage);
      }
      // Publish the session only with the campaign set authorized for its scope.
      // Otherwise old React campaign state could issue new-tenant requests.
      setMe(session);
      setError("");
    } catch (e) {
      try {
        const cached = restoreOfflineSession(localStorage, e, navigator.onLine);
        if (cached) {
          setMe(cached.session);
          setLocale(cached.session.user.locale || "ru");
          setCampaigns(cached.campaigns);
          setCampaignState((prev) => cached.campaigns.some(c => c.id === prev) ? prev : cached.campaigns[0]?.id || "");
          return;
        }
      } catch {}
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
    if (
      me?.role === "employee" &&
      path !== "/cabinet" &&
      !path.startsWith("/test/")
    )
      router.replace("/cabinet");
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
    return (
      <ChangePassword
        onDone={reload}
        onSignInAgain={async () => {
          await post("/auth/sign-out");
          setMe(null);
          router.replace("/login");
        }}
        locale={locale}
      />
    );
  if (me.role === "employee" && me.video?.needsConsent)
    return (
      <Consent key="video" video locale={locale} organization={me.organization}
        onLocaleChange={changeLocale} onDone={reload} />
    );
  if (me.role === "employee" && !hasCurrentConsent(me.member, me.organization))
    return (
      <Consent
        locale={locale}
        organization={me.organization}
        onLocaleChange={changeLocale}
        onDone={reload}
      />
    );
  const isEmployee = me.role === "employee",
    isExpert = me.role === "expert";
  const canViewVideo = me.role === "admin" && Boolean(campaign) && me.video?.campaign === campaign;
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
      ? []
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
            href: "/model",
            label: t("Модель компетенций", "Құзыреттер моделі"),
            icon: SlidersHorizontal,
          },
          ...(canViewVideo ? [{ href: "/video", label: t("Видеозаписи", "Бейнежазбалар"), icon: Eye }] : []),
          {
            href: "/analytics",
            label: t("Аналитика", "Талдау"),
            icon: ChartNoAxesCombined,
          },
          ...(isExpert
            ? [
                {
                  href: "/matrix",
                  label: t("Матрица потенциала", "Әлеует матрицасы"),
                  icon: Grid2X2,
                },
                {
                  href: "/groups",
                  label: t("Группы сотрудников", "Қызметкерлер топтары"),
                  icon: Users,
                },
                {
                  href: "/criteria",
                  label: t("Критерии оценки", "Бағалау критерийлері"),
                  icon: SlidersHorizontal,
                },
              ]
            : []),
          ...(me.organization?.purpose === "pilot"
            ? []
            : [
                {
                  href: "/reports",
                  label: t("Отчёты", "Есептер"),
                  icon: FileText,
                },
              ]),
          ...(isExpert
            ? [
                {
                  href: "/expert",
                  label: t("Экспертная проверка", "Сараптамалық тексеру"),
                  icon: ClipboardCheck,
                },
              ]
            : []),
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
  const greeting = t(
    `Здравствуйте, ${me.user.name}`,
    `Сәлеметсіз бе, ${me.user.name}`,
  );
  const greetingDetails = [me.member?.position, me.organization?.name]
    .filter(Boolean)
    .join(" · ");
  let page =
    isEmployee && !path.startsWith("/test/") ? (
      <EmployeeHome />
    ) : path === "/cabinet" ? (
      isEmployee ? (
        <EmployeeHome />
      ) : (
        <Overview />
      )
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
    ) : path === "/model" ? (
      <div className="stack"><CompetencyModelEditor key={me.organization?.id} onSaved={() => {}} /></div>
    ) : path === "/video" ? (
      canViewVideo ? <VideoArchive key={campaign} /> : <AccessDenied t={t} onHome={() => router.replace("/")} />
    ) : path === "/analytics" ? (
      <Analytics />
    ) : path === "/groups" ? (
      isExpert ? (
        <GroupWorkspace key={campaign} />
      ) : (
        <AccessDenied t={t} onHome={() => router.replace("/")} />
      )
    ) : path === "/matrix" ? (
      isExpert ? (
        <Matrix />
      ) : (
        <AccessDenied t={t} onHome={() => router.replace("/")} />
      )
    ) : path === "/reports" ? (
      <ReportCenter key={campaign + locale + "individual"} kind="individual" />
    ) : path === "/team-reports" ? (
      <ReportCenter key={campaign + locale + "team"} kind="team" />
    ) : path === "/expert" ? (
      <People expert />
    ) : path === "/criteria" ? (
      isExpert ? (
        <Criteria />
      ) : (
        <AccessDenied t={t} onHome={() => router.replace("/")} />
      )
    ) : path === "/settings" ? (
      <SettingsPage />
    ) : path === "/platform" ? (
      <Platform />
    ) : path === "/my-tests" ? (
      <EmployeeHome catalog />
    ) : path.startsWith("/people/") ? (
      <Participant id={path.split("/")[2]} />
    ) : path.startsWith("/test/") ? (
      <TestRunner key={path} id={path.split("/")[2]} />
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
      <AnswerRecovery enabled={isEmployee && !path.startsWith("/test/")} memberId={isEmployee ? me.member.id : undefined} />
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
                className={`nav-item ${path === n.href || (n.href === "/people" && path.startsWith("/people/")) || (n.href === "/reports" && path === "/team-reports") ? "active" : ""} ${i === 4 ? "nav-divider" : ""}`}
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
            {isEmployee && <ConsentRecord member={me.member} inSidebar />}
            <button className="nav-item" onClick={() => setHelp(!help)}>
              <HelpCircle size={19} aria-hidden="true" />
              <span>{t("Помощь и поддержка", "Көмек және қолдау")}</span>
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
                  <strong title={greeting}>{greeting}</strong>
                  <small title={greetingDetails}>{greetingDetails}</small>
                </div>
              )}
            </div>
            <div className="top-right">
              {!path.startsWith("/test/") && (
                <div className="campaign-switch header-campaign">
                  <CalendarDays size={15} />
                  <select
                    aria-label={t("Кампания оценки", "Бағалау науқаны")}
                    title={campaigns.find((item) => item.id === campaign)?.name}
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
                  <strong title={me.user.name}>{me.user.name}</strong>
                  <small>{roleLabel}</small>
                </div>
                <button
                  className="icon-btn"
                  title={t("Выйти", "Шығу")}
                  onClick={async () => {
                    await post("/auth/sign-out");
                    clearOfflineSession(localStorage);
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
              (!isEmployee ||
                (path !== "/cabinet" && path !== "/my-results")) && (
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

function AccessDenied({
  t,
  onHome,
}: {
  t: (ru: string, kk: string) => string;
  onHome: () => void;
}) {
  return (
    <div className="empty">
      <h1>{t("Раздел доступен эксперту", "Бұл бөлім сарапшыға қолжетімді")}</h1>
      <p>
        {t(
          "Попросите эксперта организации открыть этот раздел.",
          "Бұл бөлімді ашу үшін ұйым сарапшысына жүгініңіз.",
        )}
      </p>
      <Button onClick={onHome}>{t("На главную", "Басты бетке")}</Button>
    </div>
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
      clearOfflineSession(localStorage);
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
  onSignInAgain,
  locale,
}: {
  onDone: () => Promise<void>;
  onSignInAgain: () => Promise<void>;
  locale: Locale;
}) {
  const t = (ru: string, kk: string) => (locale === "ru" ? ru : kk);
  const [next, setNext] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const networkError = t(
    "Не удалось связаться с сервером. Попробуйте ещё раз.",
    "Сервермен байланысу мүмкін болмады. Қайталап көріңіз.",
  );
  return (
    <div className="password-page">
      <Brand />
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post("/me/password", { newPassword: next });
            await onDone();
          } catch (e) {
            setError(
              e instanceof TypeError ? networkError : (e as Error).message,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>{t("Задайте свой пароль", "Өз құпиясөзіңізді орнатыңыз")}</h1>
        <Field
          label={t("Новый пароль", "Жаңа құпиясөз")}
          hint={t("Не менее 12 символов", "Кемінде 12 таңба")}
        >
          <input
            autoComplete="new-password"
            type="password"
            minLength={12}
            maxLength={128}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </Field>
        {error && <div className="notice error" role="alert">{error}</div>}
        <Button type="submit" busy={busy}>
          {t("Сохранить и продолжить", "Сақтау және жалғастыру")}
        </Button>
        {error && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSignInAgain();
              } catch {
                setError(networkError);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Войти заново", "Қайта кіру")}
          </Button>
        )}
      </form>
    </div>
  );
}
