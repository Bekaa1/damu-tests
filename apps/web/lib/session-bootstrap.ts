export type SessionScopeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export class SessionBootstrapError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'SessionBootstrapError'; }
}
type ScopedSession = { demo?: boolean; organization?: { id?: string; dataMode?: string } | null };

/** Bootstrap alone may recover from a stale workspace; ordinary API requests never retry across tenants. */
export async function bootstrapSession<T extends ScopedSession>(fetcher: typeof fetch, storage: SessionScopeStorage): Promise<T> {
  const selected = storage.getItem('assessflow.org');
  const request = (organization: string | null) => fetcher('/api/me', {
    headers: { 'Content-Type': 'application/json', ...(organization ? { 'x-organization-id': organization } : {}) },
    credentials: 'same-origin', cache: 'no-store',
  });
  let response = await request(selected);
  if (response.status === 403 && selected) response = await request(null);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new SessionBootstrapError(body.message || `Ошибка ${response.status}`, response.status);
  }
  const session = await response.json() as T;
  if (session.demo && session.organization?.dataMode !== 'synthetic')
    throw new SessionBootstrapError('Демонстрационный доступ не изолирован', 403);
  const organization = session.organization?.id;
  if (session.demo && selected !== organization) {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key));
    for (const key of keys) {
      if (key === 'assessflow.offline-session' || key === 'assessflow.campaign' ||
          /^assessflow\.(cached|answers|presence)\./.test(key)) storage.removeItem(key);
    }
  }
  if (organization) storage.setItem('assessflow.org', organization);
  else storage.removeItem('assessflow.org');
  return session;
}
