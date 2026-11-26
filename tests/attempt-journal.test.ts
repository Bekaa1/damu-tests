import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attemptResponse, deliverJournal, monitorAttempt } from "../apps/web/lib/attempt-journal";

const events = () => Object.keys(localStorage).map(k => JSON.parse(localStorage.getItem(k)!));
function store() {
  const values: Record<string, string> = {};
  return Object.defineProperties(values, {
    getItem: { value: (key: string) => values[key] ?? null },
    setItem: { value: (key: string, value: string) => { values[key] = value; } },
    removeItem: { value: (key: string) => { delete values[key]; } },
  });
}
const stop: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal("localStorage", store());
  vi.stubGlobal("sessionStorage", store());
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  for (const cleanup of stop.splice(0)) cleanup();
  vi.unstubAllGlobals();
});
it("distinguishes transport failures, HTTP responses, browser network state and recovery per operation", () => {
  stop.push(monitorAttempt("a", "member"));
  const reply = (op: string, status?: number) => attemptResponse("/attempts/a/" + op, status ? new Response(null, { status }) : undefined);
  reply("answers"); reply("answers"); reply("presence", 200);
  reply("answers", 503); reply("answers", 503); reply("answers", 201);
  Object.assign(navigator, { onLine: false }); window.dispatchEvent(new Event("offline"));
  Object.assign(navigator, { onLine: true }); window.dispatchEvent(new Event("online"));
  reply("journal", 503);
  expect(events().map(e => e.kind)).toEqual(["no_response", "http_error", "request_recovered", "offline", "online"]);
  expect(events()[1]).toMatchObject({ status: 503, operation: "answers" });
});
it("preserves unacknowledged events across delivery retries and sends only the signed-in participant's queue", async () => {
  stop.push(monitorAttempt("a", "first"));
  attemptResponse("/attempts/a/presence");
  const original = events()[0];
  const sendOther = vi.fn().mockResolvedValue({});
  const other = deliverJournal("second", sendOther);
  other();
  expect(sendOther).not.toHaveBeenCalled();
  const send = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({});
  stop.push(deliverJournal("first", send));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(events()).toEqual([original]);
  window.dispatchEvent(new Event("online"));
  await vi.waitFor(() => expect(events()).toHaveLength(0));
  expect(send.mock.calls).toEqual([["/attempts/a/journal", [original]], ["/attempts/a/journal", [original]]]);
});
