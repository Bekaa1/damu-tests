import type { Session } from "./ui";

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const CACHE_KEY = "assessflow.offline-session";
const CACHE_VERSION = 2;
type OfflineScope = { userId: string; membershipId: string; organizationId: string; demo: boolean; dataMode: string };
type OfflineSession = { version: 2; scope: OfflineScope; session: Session; campaigns: any[] };
function sessionScope(session: Session): OfflineScope | null {
  if (!session?.user?.id || !session?.member?.id || !session?.organization?.id) return null;
  return { userId: session.user.id, membershipId: session.member.id, organizationId: session.organization.id,
    demo: session.demo === true, dataMode: session.organization.dataMode || "real" };
}
function sameScope(a: OfflineScope | null | undefined, b: OfflineScope | null) {
  return Boolean(a && b && a.userId === b.userId && a.membershipId === b.membershipId &&
    a.organizationId === b.organizationId && a.demo === b.demo && a.dataMode === b.dataMode);
}
function readCache(storage: SessionStorage): OfflineSession | null {
  try {
    const cached = JSON.parse(storage.getItem(CACHE_KEY) || "null");
    if (cached?.version === CACHE_VERSION && cached.session?.role === "employee" &&
      !cached.session.user?.mustChangePassword && Array.isArray(cached.campaigns) &&
      sameScope(cached.scope, sessionScope(cached.session))) return cached;
  } catch { /* Invalid or pre-scope caches are not identity evidence. */ }
  storage.removeItem(CACHE_KEY);
  return null;
}
export function clearOfflineSession(storage: SessionStorage) {
  storage.removeItem(CACHE_KEY);
}
/** Invalidate an old identity immediately after bootstrap, even if a later
 * campaign fetch fails. Do not delete legitimate per-attempt autosave queues. */
export function alignOfflineSession(storage: SessionStorage, session: Session) {
  const cached = readCache(storage);
  if (session.role !== "employee" || !sameScope(cached?.scope, sessionScope(session))) clearOfflineSession(storage);
}
export function cacheOfflineSession(storage: SessionStorage, session: Session, campaigns: any[]) {
  const scope = sessionScope(session);
  if (session.role !== "employee" || session.user.mustChangePassword || !scope) { clearOfflineSession(storage); return; }
  storage.setItem(CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, scope, session, campaigns }));
}
/** Only a browser fetch network failure may restore a current, selected scope.
 * HTTP auth/permission/consent errors (including SessionBootstrapError.status)
 * must never fall back to an older authenticated identity. */
export function restoreOfflineSession(storage: SessionStorage, error: unknown, online: boolean): OfflineSession | null {
  const cached = readCache(storage);
  if (typeof error === "object" && error !== null && "status" in error) {
    clearOfflineSession(storage);
    return null;
  }
  if (online || !cached || !(error instanceof TypeError) ||
    !/fetch|network|load failed/i.test(error.message)) return null;
  if (storage.getItem("assessflow.org") !== cached.scope.organizationId) {
    clearOfflineSession(storage);
    return null;
  }
  return cached;
}
