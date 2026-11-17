"use client";
import { useState } from "react";
import { useApp, useData, post, Button, Modal, LoadState } from "./ui";
const labels: Record<string, [string, string]> = {
  summary: ["Общие выводы", "Жалпы қорытындылар"],
  analytical: ["Способности", "Қабілеттер"],
  personality: ["Самоописание", "Өзіндік сипаттау"],
  motivation: ["Мотивация", "Мотивация"],
  management: ["Управленческие решения", "Басқарушылық шешімдер"],
  competencies: ["Компетенции", "Құзыреттер"],
  potential: ["Потенциал", "Әлеует"],
  strengths: ["Сильные стороны", "Күшті жақтар"],
  development: ["Зоны развития", "Даму бағыттары"],
  risks: ["Подтверждённые риски", "Расталған тәуекелдер"],
  recommendations: ["Рекомендации", "Ұсыныстар"],
  focus: ["Направление", "Бағыт"],
  action: ["Действие", "Әрекет"],
  format: ["Формат", "Формат"],
  timeframe: ["Срок", "Мерзім"],
  success: ["Критерий результата", "Нәтиже критерийі"],
};
function ReviewForm({ data, onClose }: { data: any; onClose: () => void }) {
  const { t, notify } = useApp(),
    [content, setContent] = useState<any>(data.content),
    [issues, setIssues] = useState<any[]>(data.issues || []),
    [revision, setRevision] = useState(data.updatedAt),
    [busy, setBusy] = useState(false),
    [edits, setEdits] = useState<Record<string, string>>(
      data.presentationEdits || {},
    );
  const edit = data.status === "manual_review";
  const change = (section: string, index: number, key: string, value: string) =>
    setContent((c: any) => ({
      ...c,
      [section]: c[section].map((row: any, i: number) =>
        i === index ? { ...row, [key]: value } : row,
      ),
    }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await post("/generated-reports/" + data.id + "/review", {
        content,
        updatedAt: revision,
        presentationEdits: edits,
      });
      if (r.status === "completed") {
        notify(
          t(
            "Проверка пройдена. PDF доступен.",
            "Тексеру аяқталды. PDF қолжетімді.",
          ),
        );
        onClose();
      } else {
        setIssues(r.issues || []);
        setRevision(r.updatedAt);
        notify(
          t(
            "Остались замечания к формулировкам.",
            "Тұжырымдарға ескертулер қалды.",
          ),
          "error",
        );
      }
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel-body">
      {issues.length > 0 && (
        <div className="notice warning" role="alert">
          <strong>
            {t("Исправьте перед выпуском PDF", "PDF шығарудан бұрын түзетіңіз")}
          </strong>
          <ul>
            {issues.map((i: any, n: number) => (
              <li key={n}>
                {i.message} <small>({i.path})</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.interviewQuestions?.length > 0 && (
        <details>
          <summary>
            {t(
              "Вопросы для интервью — только эксперту",
              "Сұхбат сұрақтары — тек сарапшыға",
            )}
          </summary>
          <p className="text-muted">
            {t(
              "Эти вопросы не включаются в отчёт заказчика.",
              "Бұл сұрақтар тапсырыс берушінің есебіне қосылмайды.",
            )}
          </p>
          {data.interviewQuestions.map((q: any) => (
            <p key={q.facet}>
              <b>
                {q.name}: {q.band}
              </b>
              <br />
              {q.question}
            </p>
          ))}
        </details>
      )}
      {edit && content && (
        <>
          {Object.entries(labels)
            .filter(([key]) => Array.isArray(content[key]))
            .map(([section, label]) => (
              <section key={section}>
                <h3>{t(...label)}</h3>
                {content[section].map((row: any, i: number) => (
                  <label key={i} style={{ display: "block", margin: "12px 0" }}>
                    {t("Абзац", "Абзац")} {i + 1}
                    <textarea
                      style={{ width: "100%", minHeight: 110 }}
                      value={row.text}
                      onChange={(e) =>
                        change(section, i, "text", e.target.value)
                      }
                    />
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setContent((c: any) => ({
                          ...c,
                          [section]: c[section].filter(
                            (_: any, j: number) => j !== i,
                          ),
                        }))
                      }
                    >
                      {t("Удалить абзац", "Абзацты жою")}
                    </Button>
                  </label>
                ))}
              </section>
            ))}
          <h3>{t("План развития", "Даму жоспары")}</h3>
          {content.developmentPlan.map((row: any, i: number) => (
            <fieldset key={i} style={{ margin: "16px 0", padding: 16 }}>
              <legend>{i + 1}</legend>
              {["focus", "action", "format", "timeframe", "success"].map(
                (key) => (
                  <label
                    key={key}
                    style={{ display: "block", margin: "10px 0" }}
                  >
                    {t(...labels[key])}
                    <textarea
                      style={{
                        width: "100%",
                        minHeight: key === "action" ? 100 : 60,
                      }}
                      value={row[key]}
                      onChange={(e) =>
                        change("developmentPlan", i, key, e.target.value)
                      }
                    />
                  </label>
                ),
              )}
            </fieldset>
          ))}
          {data.sourceTexts?.map((text: string) => (
            <label key={text} style={{ display: "block", margin: "16px 0" }}>
              {t(
                "Редакция цитаты или подписи",
                "Дәйексөзді немесе жазуды өңдеу",
              )}
              <p className="text-muted">{text}</p>
              <textarea
                style={{ width: "100%", minHeight: 100 }}
                value={edits[text] ?? text}
                onChange={(e) => setEdits({ ...edits, [text]: e.target.value })}
              />
            </label>
          ))}
          <Button busy={busy} onClick={save}>
            {t("Проверить и выпустить PDF", "Тексеріп, PDF шығару")}
          </Button>
        </>
      )}
    </div>
  );
}
function ReviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useApp(),
    data = useData<any>("/generated-reports/" + id + "/review");
  return (
    <Modal
      wide
      title={t("Проверка отчёта", "Есепті тексеру")}
      onClose={onClose}
    >
      <LoadState loading={data.loading} error={data.error}>
        {data.data && <ReviewForm data={data.data} onClose={onClose} />}
      </LoadState>
    </Modal>
  );
}
export function ReportReviewAction({ id }: { id: string }) {
  const { me, t } = useApp(),
    [open, setOpen] = useState(false);
  if (me.role !== "expert") return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("Проверка эксперта", "Сарапшы тексеруі")}
      </Button>
      {open && <ReviewDialog id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
