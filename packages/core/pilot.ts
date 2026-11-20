import { CONSENT_TEXT, CONSENT_VERSION } from "./assessment-policy";

export const PILOT_CONSENT_VERSION = "pilot-2026-11-20-retention";
export const PILOT_CONSENT_TEXT = {
  ru: "Участие в пилоте добровольное. Я соглашаюсь на обработку моих ФИО, контактных данных, ответов, результатов и технических событий прохождения только для проверки качества тестов AssessFlow. Это пробное тестирование, а не оценка моей работы. Индивидуальные ответы и результаты работодателю и руководству моей компании не передаются и не используются для кадровых решений. Данные доступны только уполномоченной команде проверки платформы и хранятся отдельно от оценки сотрудников Даму. Данные участника на платформе удаляются через 3 календарных месяца с даты его регистрации в пилоте. Повторный вход или повторное согласие не продлевают этот срок. Передача данных внешним сервисам AI-анализа в пилоте отключена. Я могу отказаться от участия, прекратить прохождение или обратиться к организатору пилота для отзыва согласия и досрочного удаления моих данных.",
  kk: "Пилотқа қатысу ерікті. Мен аты-жөнімді, байланыс деректерімді, жауаптарымды, нәтижелерімді және тесттен өту кезіндегі техникалық оқиғаларды тек AssessFlow тесттерінің сапасын тексеру үшін өңдеуге келісемін. Бұл менің жұмысымды бағалау емес, сынақ тестілеу. Жеке жауаптар мен нәтижелер жұмыс берушіге және компаниямның басшылығына берілмейді және кадрлық шешімдер үшін пайдаланылмайды. Деректер тек платформаны тексеруге уәкілетті топқа қолжетімді және Даму қызметкерлерін бағалау деректерінен бөлек сақталады. Қатысушының платформадағы деректері пилотта тіркелген күнінен бастап 3 күнтізбелік айдан кейін жойылады. Қайта кіру немесе қайта келісім беру бұл мерзімді ұзартпайды. Пилотта деректерді сыртқы AI-талдау сервистеріне жіберу өшірілген. Мен қатысудан бас тарта аламын, тесттен өтуді тоқтата аламын немесе келісімді қайтарып алу және деректерімді мерзімінен бұрын жою үшін пилот ұйымдастырушысына жүгіне аламын.",
};

// UTC calendar arithmetic, including month-end clamping (Nov 30 -> Feb 28/29).
export function pilotDeletionDate(createdAt: Date | string) {
  const registered = new Date(createdAt);
  if (!Number.isFinite(registered.getTime())) throw Error("Invalid registration date");
  const deadline = new Date(registered);
  deadline.setUTCDate(1);
  deadline.setUTCMonth(deadline.getUTCMonth() + 3);
  const lastDay = new Date(Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth() + 1, 0)).getUTCDate();
  deadline.setUTCDate(Math.min(registered.getUTCDate(), lastDay));
  return deadline;
}

export function pilotDataExpired(
  member: { role: string; createdAt: Date | string } | null | undefined,
  organization: { purpose?: string } | null | undefined,
  now = new Date(),
) {
  return Boolean(member?.role === "employee" && organization?.purpose === "pilot" && pilotDeletionDate(member.createdAt) <= now);
}

export function consentPolicy(organization?: { purpose?: string } | null) {
  return organization?.purpose === "pilot"
    ? { version: PILOT_CONSENT_VERSION, text: PILOT_CONSENT_TEXT }
    : { version: CONSENT_VERSION, text: CONSENT_TEXT };
}

export function hasCurrentConsent(
  member:
    { consentAt?: unknown; consentVersion?: string | null } | null | undefined,
  organization?: { purpose?: string } | null,
) {
  return Boolean(
    member?.consentAt &&
    member.consentVersion === consentPolicy(organization).version,
  );
}

export type EmployerPermission = {
  employer: string;
  reference: string;
  receivedAt: string;
  recordedAt: string;
  recordedBy: string;
};

export function pilotCanStart(
  organization: { purpose?: string } | null | undefined,
  campaign: { employerPermission?: unknown } | null | undefined,
) {
  if (organization?.purpose !== "pilot") return true;
  const permission =
    campaign?.employerPermission as Partial<EmployerPermission> | null;
  return Boolean(
    permission?.employer &&
    permission.reference &&
    permission.receivedAt &&
    permission.recordedAt &&
    permission.recordedBy,
  );
}
