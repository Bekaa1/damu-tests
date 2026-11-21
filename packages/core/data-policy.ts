/** Participant retention is anchored to membership registration, never activity. */
export function participantDeletionDate(createdAt: Date | string): Date {
  const registered = new Date(createdAt);
  if (!Number.isFinite(registered.getTime())) throw Error("Invalid registration date");
  const deadline = new Date(registered);
  deadline.setUTCDate(1);
  deadline.setUTCMonth(deadline.getUTCMonth() + 3);
  const monthEnd = new Date(deadline);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  deadline.setUTCDate(Math.min(registered.getUTCDate(), monthEnd.getUTCDate()));
  return deadline;
}

export function participantDataExpired(
  member: { role: string; createdAt: Date | string } | null | undefined,
  organization: { purpose?: string; dataMode?: string } | null | undefined,
  now = new Date(),
): boolean {
  return Boolean(member?.role === "employee" && organization && participantDeletionDate(member.createdAt) <= now);
}

/** This release has no approval to send any organization data to external AI.
 * Deliberately independent of environment, purpose, demo labels and settings.
 * A future change requires separate documented approval and policy tests.
 */
export function externalAiAllowed(_organization?: { purpose?: string; dataMode?: string } | null): boolean {
  return false;
}

export const EXTERNAL_AI_DISABLED_STATUS = "disabled_by_policy";
export const EXTERNAL_AI_DISABLED_ERROR = "Внешний AI-анализ отключён политикой обработки данных. Локальные результаты и отчёты по данным доступны.";
export const EXTERNAL_AI_DISABLED_CODE = "external_ai_disabled";
