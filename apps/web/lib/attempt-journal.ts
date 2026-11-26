import type { AttemptOperation, BrowserJournalEvent, BrowserObservation } from "../../../packages/core/attempt-journal";

const prefix = "assessflow.journal.";
const changed = "assessflow:journal-pending";
// Each key belongs to one event, so simultaneous tabs cannot overwrite pending observations.
const memory = new Map<string, BrowserJournalEvent>();
function enqueue(attempt: string, member: string, observation: BrowserObservation) {
  const event = { ...observation, at: new Date().toISOString(), eventId: crypto.randomUUID() };
  const key = [prefix + attempt, member, event.eventId].join(".");
  try { localStorage.setItem(key, JSON.stringify(event)); }
  catch { memory.set(key, event); }
  window.dispatchEvent(new Event(changed));
}

type RequestOutcome = { attempt: string; operation: AttemptOperation; status: number; requestId?: string };
let observe: ((outcome: RequestOutcome) => void) | undefined;
export function attemptResponse(path: string, response?: Response) {
  if (!observe) return;
  const match = /^\/attempts\/([\w-]+)\/(presence|answers|submit|camera)$/.exec(path);
  if (match) observe({
    attempt: match[1], operation: match[2] as AttemptOperation, status: response?.status ?? 0,
    requestId: response?.headers.get("x-request-id") ?? undefined,
  });
}

export function monitorAttempt(attempt: string, member: string) {
  const key = "assessflow.connection." + attempt;
  let state: { online?: boolean; failures: Partial<Record<AttemptOperation, number>> } = { failures: {} };
  try { state = JSON.parse(sessionStorage.getItem(key) || "null") || state; } catch {}
  const remember = () => { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch {} };
  const network = () => {
    const online = navigator.onLine;
    if (state.online === online) return;
    if (!online || state.online === false) enqueue(attempt, member, { kind: online ? "online" : "offline" });
    state.online = online;
    remember();
  };
  network();
  window.addEventListener("offline", network);
  window.addEventListener("online", network);
  observe = ({ attempt: observed, operation, status, requestId }) => {
    if (observed !== attempt) return;
    const previous = state.failures[operation];
    if (status >= 200 && status < 400) {
      if (previous === undefined) return;
      delete state.failures[operation];
      enqueue(attempt, member, { kind: "request_recovered", operation });
    } else {
      if (previous === status) return;
      state.failures[operation] = status;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      enqueue(attempt, member, status === 0 ? { kind: "no_response", operation }
        : { kind: "http_error", operation, status, requestId: requestId && uuid.test(requestId) ? requestId : undefined });
    }
    remember();
  };
  const protectedMaterial = "[data-test-material]";
  const inside = (event: Event) => event.target instanceof Element && Boolean(event.target.closest(protectedMaterial));
  const copy = (event: ClipboardEvent) => {
    const selection = document.getSelection();
    const touches = selection && !selection.isCollapsed && selection.rangeCount > 0 &&
      Array.from(document.querySelectorAll(protectedMaterial)).some(el => selection.getRangeAt(0).intersectsNode(el));
    if (!inside(event) && !touches) return;
    event.preventDefault();
    enqueue(attempt, member, { kind: "copy_blocked" });
  };
  const block = (event: Event) => { if (inside(event)) event.preventDefault(); };
  document.addEventListener("copy", copy);
  document.addEventListener("cut", copy);
  document.addEventListener("dragstart", block);
  document.addEventListener("contextmenu", block);
  return () => {
    observe = undefined;
    window.removeEventListener("online", network);
    window.removeEventListener("offline", network);
    document.removeEventListener("copy", copy);
    document.removeEventListener("cut", copy);
    document.removeEventListener("dragstart", block);
    document.removeEventListener("contextmenu", block);
  };
}

export function deliverJournal(member: string, send: (path: string, batch: BrowserJournalEvent[]) => Promise<unknown>) {
  let busy = false, stopped = false;
  const flush = async () => {
    if (busy || stopped || !navigator.onLine) return;
    busy = true;
    try {
      let keys: string[] = [];
      try { keys = Object.keys(localStorage); } catch {}
      const batches = new Map<string, [string, BrowserJournalEvent][]>();
      for (const key of new Set([...keys, ...memory.keys()])) {
        if (!key.startsWith(prefix)) continue;
        const [attempt, owner] = key.slice(prefix.length).split(".");
        if (owner !== member) continue;
        try {
          const event = memory.get(key) ?? JSON.parse(localStorage.getItem(key) || "null");
          if (!event) continue;
          if (!batches.has(attempt)) batches.set(attempt, []);
          batches.get(attempt)!.push([key, event]);
        } catch { continue; }
      }
      for (const [attempt, entries] of batches) {
        for (let i = 0; i < entries.length && !stopped; i += 100) {
          const batch = entries.slice(i, i + 100);
          try { await send("/attempts/" + attempt + "/journal", batch.map(([, event]) => event)); }
          catch { break; }
          for (const [key] of batch) {
            memory.delete(key);
            try { localStorage.removeItem(key); } catch {}
          }
        }
      }
    } finally { busy = false; }
  };
  const timer = setInterval(flush, 5000);
  window.addEventListener("online", flush);
  window.addEventListener(changed, flush);
  void flush();
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("online", flush);
    window.removeEventListener(changed, flush);
  };
}
