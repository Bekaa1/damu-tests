"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { displayAttemptStatus } from "../../../packages/core/assessment-policy";
import { useApp, post, Button, Modal, Field, Panel, Badge, date } from "./ui";

export function RetakeAction({
  data,
  onSaved,
}: {
  data: any;
  onSaved: () => void;
}) {
  const { t, loc, campaign, notify } = useApp();
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const eligible = data.assignments.filter(
    (a: any) =>
      ["completed", "retry_required", "expired"].includes(
        a.attempts[0]?.status,
      ) && a.testVersion.status === "published",
  );
  if (data.member.role !== "employee") return null;
  return (
    <>
      <Button
        variant="secondary"
        disabled={!campaign || !eligible.length}
        onClick={() => {
          setSelected(eligible.map((a: any) => a.id));
          setReason("");
          setError("");
          setOpen(true);
        }}
      >
        <RotateCcw size={15} />
        {t("Назначить повторное прохождение", "Қайта өтуді тағайындау")}
      </Button>
      {open && (
        <Modal
          title={t("Повторное прохождение тестов", "Тесттерді қайта өту")}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form
            className="modal-body form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await post(`/people/${data.member.id}/retakes`, {
                  campaignId: campaign,
                  reason,
                  attempts: eligible
                    .filter((a: any) => selected.includes(a.id))
                    .map((a: any) => ({
                      assignmentId: a.id,
                      previousAttemptId: a.attempts[0].id,
                    })),
                });
                setOpen(false);
                onSaved();
                notify(
                  t(
                    "Новые попытки назначены. Сотрудник может начать тесты в своём кабинете.",
                    "Жаңа әрекеттер тағайындалды. Қызметкер тесттерді жеке кабинетінде бастай алады.",
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {t(
                "Выберите завершённые тесты. Предыдущие ответы и отчёты останутся в истории. Полный лимит времени начнёт отсчитываться при старте нового теста.",
                "Аяқталған тесттерді таңдаңыз. Алдыңғы жауаптар мен есептер тарихта қалады. Толық уақыт шегі жаңа тест басталғанда есептеледі.",
              )}
            </p>
            <fieldset
              disabled={busy}
              className="form-stack"
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <legend>
                {t(
                  "Тесты для повторного прохождения",
                  "Қайта өтуге арналған тесттер",
                )}
              </legend>
              <label>
                <input
                  type="checkbox"
                  checked={selected.length === eligible.length}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? eligible.map((a: any) => a.id) : [],
                    )
                  }
                />{" "}
                {t(
                  "Выбрать все завершённые",
                  "Барлық аяқталған тесттерді таңдау",
                )}
              </label>
              {eligible.map((a: any) => (
                <label key={a.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(a.id)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, a.id]
                          : current.filter((id) => id !== a.id),
                      )
                    }
                  />{" "}
                  {loc(a.testVersion.test.name)}
                </label>
              ))}
              <Field
                label={t(
                  "Причина повторного прохождения",
                  "Қайта өтудің себебі",
                )}
              >
                <textarea
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            </fieldset>
            {error && (
              <p role="alert" className="notice">
                {error}
              </p>
            )}
            <Button
              busy={busy}
              disabled={!selected.length || reason.trim().length < 10}
            >
              {t("Назначить новые попытки", "Жаңа әрекеттерді тағайындау")}
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function AttemptHistory({ data }: { data: any }) {
  const { t, loc } = useApp();
  return (
    <Panel title={t("История прохождений", "Тапсыру тарихы")}>
      <div className="panel-body form-stack">
        {data.retakes?.map((event: any) => (
          <p key={event.id}>
            {date(event.createdAt)} ·{" "}
            {t(
              "Назначено повторных тестов",
              "Қайта өтуге тағайындалған тесттер",
            )}
            : {event.detail.attempts.length}. {event.detail.reason}
          </p>
        ))}
        {!data.attemptHistory?.length && (
          <p>{t("Прохождений пока нет", "Әзірге тапсырулар жоқ")}</p>
        )}
        {data.attemptHistory?.map((attempt: any) => {
          const score = attempt.results[0]?.result;
          return (
            <details key={attempt.id}>
              <summary>
                {loc(attempt.assignment.testVersion.test.name)} ·{" "}
                {t("Попытка", "Әрекет")} {attempt.attemptNumber} ·{" "}
                <Badge status={displayAttemptStatus(attempt)} />
              </summary>
              <p>
                {t("Ответов сохранено", "Сақталған жауаптар")}:{" "}
                {attempt._count.answers} · {t("Завершено", "Аяқталды")}:{" "}
                {attempt.submittedAt ? date(attempt.submittedAt) : "—"}
              </p>
              {typeof score?.total === "number" && (
                <p>
                  {t("Баллы", "Балдар")}: {score.total} / {score.maximum}
                </p>
              )}
              {score?.scales && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Шкала", "Шкала")}</th>
                        <th>{t("Значение", "Мәні")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(score.scales).map(
                        ([key, value]: [string, any]) => (
                          <tr key={key}>
                            <td>{loc(value.name)}</td>
                            <td>
                              {Number(value.mean).toFixed(1)} / {value.max}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          );
        })}
      </div>
    </Panel>
  );
}
