"use client";

import { CheckCircle2 } from "lucide-react";
import { useApp } from "./ui";

export function AssessmentComplete() {
  const { t } = useApp();
  return (
    <section className="assessment-complete" aria-labelledby="assessment-complete-title">
      <div className="assessment-complete-icon" aria-hidden="true">
        <CheckCircle2 size={64} strokeWidth={1.8} />
      </div>
      <h1 id="assessment-complete-title">
        {t("Вы успешно прошли все тесты", "Сіз барлық тесттерді сәтті аяқтадыңыз")}
      </h1>
      <p>
        {t(
          "Ваши ответы сохранены. Результаты можно уточнить у администратора.",
          "Жауаптарыңыз сақталды. Нәтижелерді әкімшіден біле аласыз.",
        )}
      </p>
    </section>
  );
}
