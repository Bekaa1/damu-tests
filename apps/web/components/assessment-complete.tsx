"use client";

import { CheckCircle2 } from "lucide-react";
import { useApp } from "./ui";

export function AssessmentComplete() {
  const { t, me } = useApp();
  return (
    <section
      className="assessment-complete"
      aria-labelledby="assessment-complete-title"
    >
      <div className="assessment-complete-icon" aria-hidden="true">
        <CheckCircle2 size={64} strokeWidth={1.8} />
      </div>
      <h1 id="assessment-complete-title">
        {t(
          "Вы успешно прошли все тесты",
          "Сіз барлық тесттерді сәтті аяқтадыңыз",
        )}
      </h1>
      <p>
        {me.organization.purpose === "pilot"
          ? t(
              "Спасибо за участие в пилоте. Ответы сохранены для проверки инструментов. Индивидуальные результаты работодателю и руководству не передаются.",
              "Пилотқа қатысқаныңызға рақмет. Жауаптар құралдарды тексеру үшін сақталды. Жеке нәтижелер жұмыс берушіге және басшылыққа берілмейді.",
            )
          : t(
              "Ваши ответы сохранены. Результаты можно уточнить у администратора.",
              "Жауаптарыңыз сақталды. Нәтижелерді әкімшіден біле аласыз.",
            )}
      </p>
    </section>
  );
}
