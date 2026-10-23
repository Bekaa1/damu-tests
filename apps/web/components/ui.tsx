"use client";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  Search,
  ArrowUpRight,
} from "lucide-react";
export type Locale = "ru" | "kk";
export type Session = {
  user: {
    id: string;
    name: string;
    email: string;
    locale: Locale;
    mustChangePassword: boolean;
  };
  role: string;
  member: any;
  organization: any;
  organizations: { id: string; name: string }[];
  demo: boolean;
};
type AppContext = {
  me: Session;
  locale: Locale;
  t: (ru: string, kk: string) => string;
  loc: (value: any) => string;
  campaign: string;
  setCampaign: (id: string) => void;
  campaigns: any[];
  notify: (text: string, type?: "success" | "error") => void;
  reload: () => Promise<void>;
};
export const AppCtx = createContext<AppContext>(null as any);
export const useApp = () => useContext(AppCtx);
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const org =
    typeof window !== "undefined"
      ? localStorage.getItem("assessflow.org")
      : null;
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(org ? { "x-organization-id": org } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Ошибка ${response.status}`);
  }
  return response.json();
}
export const post = <T = any,>(path: string, data: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
export const patch = <T = any,>(path: string, data: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export async function download(path: string, name: string) {
  const org = localStorage.getItem("assessflow.org");
  const r = await fetch("/api" + path, {
    headers: org ? { "x-organization-id": org } : {},
  });
  if (!r.ok) {
    const e = await r.json();
    throw new Error(e.message);
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [refreshKey, refresh] = useState(0);
  const pathRef = useRef(path);
  const silentRefreshInFlight = useRef(false);
  pathRef.current = path;
  useEffect(() => {
    let active = true;
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api<T>(path)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, refreshKey]);
  const refreshSilently = useCallback(async () => {
    if (!path || silentRefreshInFlight.current) return;
    silentRefreshInFlight.current = true;
    try {
      const nextData = await api<T>(path);
      if (pathRef.current === path) setData(nextData);
    } catch {
      // Keep the current page and its data visible if a background refresh fails.
    } finally {
      silentRefreshInFlight.current = false;
    }
  }, [path]);
  return {
    data,
    error,
    loading,
    refresh: () => refresh((k) => k + 1),
    refreshSilently,
  };
}
export function Button({
  children,
  variant = "primary",
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`btn ${variant} ${props.className || ""}`}
    >
      {busy ? <Loader2 size={16} className="spin" /> : null}
      {children}
    </button>
  );
}
export function Badge({
  status,
  children,
}: {
  status?: string;
  children?: ReactNode;
}) {
  const { t } = useApp();
  const labels: Record<string, [string, string]> = {
    completed: ["Завершено", "Аяқталды"],
    in_progress: ["В процессе", "Орындалуда"],
    not_started: ["Не начато", "Басталмады"],
    unassigned: ["Не назначено", "Тағайындалмады"],
    retry_required: ["Нужно пройти заново", "Қайта өту қажет"],
    approved: ["Утверждён", "Бекітілді"],
    draft: ["Черновик", "Жоба"],
    published: ["Опубликована", "Жарияланды"],
    active: ["Активна", "Белсенді"],
    blocked: ["Заблокирован", "Бұғатталды"],
    pending: ["В очереди", "Кезекте"],
    processing: ["Обработка", "Өңделуде"],
    awaiting_configuration: ["Ожидает подключения AI", "AI қосылуын күтуде"],
    failed: ["Ошибка обработки", "Өңдеу қатесі"],
    archived: ["В архиве", "Мұрағатта"],
  };
  return (
    <span className={`badge ${status || ""}`}>
      <i />
      {children || (labels[status || ""] ? t(...labels[status!]) : status)}
    </span>
  );
}
export function Avatar({
  name,
  size = "normal",
}: {
  name: string;
  size?: "normal" | "large" | "small";
}) {
  return (
    <span className={`avatar ${size}`}>
      {name
        .split(" ")
        .slice(0, 2)
        .map((s) => s[0])
        .join("")}
    </span>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  actions,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`page-title ${className}`}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Progress({
  value,
  small = false,
}: {
  value: number;
  small?: boolean;
}) {
  return (
    <div
      className={`progress ${small ? "small" : ""}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <Search size={26} />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function LoadState({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error?: string;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div className="skeleton-page" aria-label="Загрузка" aria-busy="true">
        <div />
        <div />
        <div />
      </div>
    );
  if (error)
    return (
      <div className="notice error">
        <AlertCircle size={20} />
        <div>{error}</div>
      </div>
    );
  return children;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    const fn = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    el?.addEventListener("cancel", fn);
    return () => {
      el?.removeEventListener("cancel", fn);
      el?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""} ${className}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <div className="stat-icon">{icon}</div>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export const date = (d: string | Date, locale: Locale = "ru") =>
  new Date(d).toLocaleDateString(locale === "ru" ? "ru-RU" : "kk-KZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
