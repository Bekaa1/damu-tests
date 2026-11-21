export const CONSENT_VERSION = "assessment-2026-11-21-retention";
export const CONSENT_TEXT = {
  ru: "Я соглашаюсь на обработку моих персональных данных в AssessFlow для проведения оценки и подготовки отчётов: ФИО, должность, подразделение, ответы, результаты тестов и наблюдения ассессоров. Доступ к результатам имеют уполномоченные администраторы и эксперты моей организации. Данные участника на платформе удаляются через 3 календарных месяца с даты его регистрации в организации (по времени UTC, с переносом на последний день месяца, если соответствующего числа в нём нет). Повторный вход, повторное согласие и повторное прохождение не продлевают этот срок. Для отзыва согласия, получения копии или досрочного удаления данных я могу обратиться к администратору организации. Я ознакомился(лась) с целями обработки и добровольно даю согласие.",
  kk: "AssessFlow жүйесінде бағалау жүргізу және есептер дайындау мақсатында дербес деректерімді өңдеуге келісемін: аты-жөнім, лауазымым, бөлімшем, жауаптарым, тест нәтижелері мен бағалаушылардың бақылаулары. Нәтижелерге ұйымымның уәкілетті әкімшілері мен сарапшылары қол жеткізе алады. Қатысушының платформадағы деректері ұйымда тіркелген күнінен бастап 3 күнтізбелік айдан кейін жойылады (UTC уақыты бойынша; тиісті күн айда болмаса, сол айдың соңғы күні алынады). Қайта кіру, қайта келісім беру және тестті қайта өту бұл мерзімді ұзартпайды. Келісімді қайтарып алу, деректер көшірмесін алу немесе оларды мерзімінен бұрын жою үшін ұйым әкімшісіне жүгіне аламын. Өңдеу мақсаттарымен таныстым және келісімді ерікті түрде беремін.",
};
export const TEST_LIMITS: Record<string, number | null> = {
  verbal: 22 * 60,
  numerical: 25 * 60,
  logical: 20 * 60,
  personality: null,
  motivation: null,
  situations: 30 * 60,
};
export function questionCountText(count: number, language: "ru" | "kk") {
  if (language === "kk") return `${count} тапсырма`;
  const lastTwo = Math.abs(count) % 100;
  const last = lastTwo % 10;
  const word =
    lastTwo >= 11 && lastTwo <= 14
      ? "заданий"
      : last === 1
        ? "задание"
        : last >= 2 && last <= 4
          ? "задания"
          : "заданий";
  return `${count} ${word}`;
}
export function displayAttemptStatus(
  attempt:
    | { status: string; _count?: { answers: number }; answers?: unknown[] }
    | undefined,
) {
  if (!attempt) return "not_started";
  if (
    attempt.status === "in_progress" &&
    (attempt._count?.answers ?? attempt.answers?.length ?? 0) === 0
  )
    return "not_started";
  return attempt.status;
}
// Client timestamps are recorded provenance, not a trusted proof of offline time.
// The server deadline is authoritative; delayed answers are explicitly audited.
export function answerWithinWindow(
  answeredAt: Date,
  start: Date,
  end: Date | null,
  now: Date,
) {
  return (
    answeredAt >= start && answeredAt <= now && (!end || answeredAt <= end)
  );
}
