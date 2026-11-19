// Delivery-only corrections approved in the expert review, 18 November 2026.
// Main questions and scoring keys are deliberately unchanged.
import { METHOD_PASSPORTS, neutralMotivationText } from "./method-passports";
export function applyDeliveryCorrections(form: any) {
  form.delivery.passport = METHOD_PASSPORTS[form.id];
  form.delivery.passportRevision = "2026-11-19";
  if (METHOD_PASSPORTS[form.id])
    form.limitations = METHOD_PASSPORTS[form.id].validation;
  form.delivery.questionCount = form.questions.length;
  if (form.id === "motivation")
    for (const question of form.questions)
      question.text.ru = neutralMotivationText(question.text.ru);
  if (["personality", "motivation"].includes(form.id)) {
    form.timeLimitSeconds = null;
    form.instructions.ru = form.instructions.ru
      .replace(/Лимит(?: основного теста)?\s*—\s*\d+ минут\./g, "")
      .replace(
        "Отвечайте быстро, первое впечатление обычно точнее.",
        "Отвечайте в удобном для вас темпе, ориентируясь на своё обычное отношение к работе.",
      )
      .trim();
    form.instructions.kk = form.instructions.kk
      .replace(/Негізгі тест уақыты\s*—\s*\d+ минут\./g, "")
      .replace(
        "Жылдам жауап беріңіз, әдетте алғашқы әсер дәлірек болады.",
        "Өзіңізге ыңғайлы қарқынмен жауап беріп, жұмысқа деген әдеттегі көзқарасыңызға сүйеніңіз.",
      )
      .trim();
    if (!form.instructions.ru.includes("Время не ограничено"))
      form.instructions.ru +=
        "\n\nВремя не ограничено. Можно сделать перерыв и продолжить позже. Ответы сохраняются автоматически.";
    if (!/Уақыт шектел(меген|мейді)/.test(form.instructions.kk))
      form.instructions.kk +=
        "\n\nУақыт шектелмейді. Үзіліс жасап, кейін жалғастыруға болады. Жауаптар автоматты түрде сақталады.";
  }
  if (form.id === "logical") {
    form.delivery.practice.forEach((practice: any, index: number) => {
      const correct = index === 0 ? 2 : 4;
      const [solution] = practice.images.splice(practice.correct, 1);
      practice.images.splice(correct, 0, solution);
      practice.correct = correct;
    });
  }
  if (form.id === "situations") {
    const practice = form.delivery.practice[0];
    practice.correctMost = 1;
    practice.correctLeast = 0;
    practice.explanation = {
      ru: "В этой тренировочной ситуации наиболее эффективно — B: распределить заявителей между двумя специалистами с учётом их загрузки. Это позволяет сохранить сроки приёма. Наименее эффективно — A: перенести всех заявителей на неделю, хотя у филиала есть свободный ресурс. Этот разбор относится только к тренировке; в основном тесте каждую ситуацию оценивайте отдельно.",
      kk: "Осы жаттығу жағдайында ең тиімді нұсқа — B: өтініш берушілерді екі маманның жүктемесін ескере отырып бөлу. Бұл қабылдау мерзімдерін сақтауға мүмкіндік береді. Ең тиімсіз нұсқа — A: филиалда бос ресурс бола тұра, барлық өтініш берушіні келесі аптаға ауыстыру. Бұл талдау тек жаттығуға қатысты; негізгі тестте әр жағдайды жеке бағалаңыз.",
    };
  }
  return form;
}
