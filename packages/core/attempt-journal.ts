export const attemptOperations = ["presence", "answers", "submit", "camera"] as const;
export type AttemptOperation = (typeof attemptOperations)[number];
export type BrowserObservation =
  | { kind: "offline" | "online" | "copy_blocked" }
  | { kind: "no_response" | "request_recovered"; operation: AttemptOperation }
  | { kind: "http_error"; operation: AttemptOperation; status: number; requestId?: string };
export type BrowserJournalEvent = BrowserObservation & { eventId: string; at: string };
