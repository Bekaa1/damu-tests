"use client";
import { useState } from "react";
import { useApp, post, Button } from "./ui";
export function QualityReview({
  result,
  onChange,
  editable,
}: {
  result: any;
  onChange: () => void;
  editable: boolean;
}) {
  const { t, notify } = useApp();
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const score = result?.result;
  if (
    !score?.qualityFlags?.length &&
    !score?.reviewRequired &&
    !score?.sessionQuality?.departures
  )
    return null;
  const flags: Record<string, string> = {
    fast_answers: t("Очень быстрые ответы", "Өте жылдам жауаптар"),
    slow_precise: t(
      "Невысокий темп при высокой точности",
      "Дәлдігі жоғары, қарқыны төмен",
    ),
    unsupported_inferences: t(
      "Выводы без достаточного основания в тексте",
      "Мәтінде жеткілікті негізі жоқ қорытындылар",
    ),
    same_position: t(
      "Одинаковая позиция всех ответов",
      "Барлық жауаптар бір позицияда",
    ),
    straightlining: t("Повторяющиеся ответы", "Қайталанатын жауаптар"),
    attention: t("Контроль внимания", "Зейінді тексеру"),
    social_desirability: t(
      "Социально желательные ответы",
      "Әлеуметтік құптарлық жауаптар",
    ),
    contradictions: t("Противоречивые ответы", "Қарама-қайшы жауаптар"),
    too_fast: t("Очень быстрые ответы", "Өте жылдам жауаптар"),
    flat_profile: t("Однообразный профиль", "Біркелкі профиль"),
    ranking_mismatch: t(
      "Расхождение с выбором приоритетов",
      "Басымдықтармен сәйкессіздік",
    ),
  };
  async function decide(action: string) {
    setBusy(true);
    try {
      await post(`/results/${result.id}/quality-review`, { action, reason });
      onChange();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quality-review">
      <strong>
        {score.reviewRequired
          ? t(
              "Нужна проверка личностного опросника",
              "Тұлғалық сауалнаманы тексеру қажет",
            )
          : t("Качество заполнения", "Толтыру сапасы")}
      </strong>
      {score.sessionQuality?.departures > 0 && (
        <p>
          {t("Уходов со страницы", "Беттен кету саны")}:{" "}
          {score.sessionQuality.departures} ·{" "}
          {t("Время отсутствия", "Болмаған уақыт")}:{" "}
          {Math.round(score.sessionQuality.awayMs / 1000)} {t("сек", "сек")}
        </p>
      )}
      {editable && (
        <p>
          {score.qualityFlags?.map((x: string) => flags[x] || x).join(" · ")}
        </p>
      )}
      {score.reviewRequired && editable && (
        <>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(
              "Обоснование решения эксперта",
              "Сарапшы шешімінің негіздемесі",
            )}
            aria-label={t("Обоснование решения", "Шешімнің негіздемесі")}
          />
          <div className="row">
            <Button
              busy={busy}
              disabled={reason.trim().length < 5}
              onClick={() => void decide("accept")}
            >
              {t("Принять результат", "Нәтижені қабылдау")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || reason.trim().length < 5}
              onClick={() => void decide("repeat")}
            >
              {t("Назначить повторное прохождение", "Қайта өтуді тағайындау")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
