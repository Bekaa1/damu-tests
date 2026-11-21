"use client";
import { useEffect, useState } from "react";
import { HOLDING_SJT_CASES, HOLDING_SINGLE_CASE_NOTE } from "../../../packages/core/holding";
import {
  useApp,
  useData,
  post,
  download,
  Panel,
  Button,
  Field,
  LoadState,
} from "./ui";
export function NormSetup() {
  const { campaign, t, me, notify } = useApp(),
    source = useData<any>(campaign ? `/campaigns/${campaign}/norm` : null);
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [combined, setCombined] = useState(false),
    [busy, setBusy] = useState(false);
  const freeze = async () => {
    setBusy(true);
    try {
      await post(`/campaigns/${campaign}/norm/freeze`, {
        confirm: true,
        reason,
        languageMode: combined ? "combined" : "separate",
        confirmEquivalentLanguages: combined,
      });
      await source.refresh();
      notify(
        t(
          "Норма зафиксирована и больше не пересчитывается",
          "Норма бекітілді және қайта есептелмейді",
        ),
      );
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t("Норма закрытой группы", "Жабық топ нормасы")}>
      <LoadState loading={source.loading} error={source.error}>
        <div className="panel-body form-stack">
          <details>
            <summary>
              {t("Как рассчитывается сравнение", "Салыстыру қалай есептеледі")}
            </summary>
            <p>
              {t(
                "По каждой шкале считается процентиль с учётом одинаковых баллов, затем он переводится в стен от 1 до 10 по стандартным нормальным границам. Это положение результата внутри фиксированной группы. Если все результаты одинаковы, стен не назначается.",
                "Әр шкала бойынша бірдей балдарды ескеретін процентиль есептеліп, стандартты қалыпты шекаралар бойынша 1-ден 10-ға дейінгі стенге аударылады. Бұл нәтиженің бекітілген топтағы орны. Барлық нәтижелер бірдей болса, стен тағайындалмайды.",
              )}
            </p>
          </details>
          {!campaign ? (
            <p>{t("Выберите кампанию", "Науқанды таңдаңыз")}</p>
          ) : source.data?.norm ? (
            <>
              <p>
                <b>{t("Норма зафиксирована", "Норма бекітілген")}</b> ·{" "}
                {new Date(source.data.norm.createdAt).toLocaleString()}
              </p>
              <p>
                {t("Группа", "Топ")}: {source.data.norm.expectedCount}.{" "}
                {t(
                  "Исключено недостоверных профилей",
                  "Сенімсіз бейіндер алынып тасталды",
                )}
                : {source.data.norm.excludedCount}.
              </p>
              <p className="text-muted">
                {t(
                  "Новые участники и повторные прохождения сравниваются с этой нормой. Её состав и таблицы больше не меняются.",
                  "Жаңа қатысушылар мен қайталап өтулер осы нормамен салыстырылады. Құрамы мен кестелері енді өзгермейді.",
                )}
              </p>
            </>
          ) : (
            source.data && (
              <>
                <p>
                  {t(
                    "Завершили все назначенные тесты",
                    "Барлық тағайындалған тесттерді аяқтады",
                  )}
                  :{" "}
                  <b>
                    {source.data.completed} / {source.data.expectedCount}
                  </b>
                  . {t("Ожидают проверки качества", "Сапа тексеруін күтуде")}:{" "}
                  {source.data.pendingQuality}.
                </p>
                <p className="text-muted">
                  {t(
                    "До фиксации отчёты выходят без групповых норм. Один раз после завершения всех 65 эксперт фиксирует выборку и таблицы перевода. Уже выпущенные PDF не меняются.",
                    "Бекіткенге дейін есептер топтық нормасыз шығады. Барлық 65 қатысушы аяқтаған соң сарапшы іріктеме мен аудару кестелерін бір рет бекітеді. Шығарылған PDF өзгермейді.",
                  )}
                </p>
                {(me.role === "expert" || me.role === "superadmin") && (
                  <>
                    <Field
                      label={t("Основание фиксации", "Бекіту негіздемесі")}
                    >
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </Field>
                    <label>
                      <input
                        type="checkbox"
                        checked={combined}
                        onChange={(e) => setCombined(e.target.checked)}
                      />
                      {t(
                        "Подтверждаю сопоставимость RU/KK и использую общую норму",
                        "RU/KK салыстырмалылығын растаймын және ортақ норманы қолданамын",
                      )}
                    </label>
                    <p className="text-small text-muted">
                      {t(
                        "Без подтверждения языковые версии сравниваются раздельно. Для нормирования требуется минимум 30 сопоставимых достоверных результатов.",
                        "Растаусыз тілдік нұсқалар бөлек салыстырылады. Нормалау үшін кемінде 30 салыстырмалы сенімді нәтиже қажет.",
                      )}
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      {t(
                        "Качество проверено. Подтверждаю окончательную фиксацию нормы.",
                        "Сапасы тексерілді. Норманы түпкілікті бекітуді растаймын.",
                      )}
                    </label>
                    <div className="row">
                      <Button
                        busy={busy}
                        disabled={
                          !source.data.ready ||
                          !confirmed ||
                          reason.trim().length < 10
                        }
                        onClick={freeze}
                      >
                        {t("Зафиксировать норму", "Норманы бекіту")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => source.refresh()}
                      >
                        {t("Обновить прогресс", "Ілгерілеуді жаңарту")}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )
          )}
        </div>
      </LoadState>
    </Panel>
  );
}
export function SjtExpertSetup() {
  const { t, loc, notify } = useApp(),
    source = useData<any>("/sjt-expert-key");
  const [ratings, setRatings] = useState<
      Record<string, Record<string, number | null>>
    >({}),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (source.data) {
      setRatings(source.data.ratings);
      setDirty(false);
    }
  }, [source.data]);
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  if (source.data?.holdingModelVersion) return (
    <Panel title={t("Экспертный ключ SJT — модель Холдинга", "SJT сарапшылық кілті — Холдинг моделі")}>
      <div className="panel-body form-stack" lang="ru">
        <p className="notice warning">Ключ не утверждён экспертной панелью</p>
        <p>14 кейсов. +1 за совпадение MOST, +1 за совпадение LEAST; максимум 28. Ключ хранится по ID вариантов, а не по перемешиваемой букве.</p>
        <p>Изменения ключа и версии — только с записью в журнал. Оценки эффективности и утверждение одним специалистом не заменяют исходный ключ Холдинга.</p>
        <p>Отдельный профиль SJT: C2, C3, C4, C7. C1, C5, C6, C8: {HOLDING_SINGLE_CASE_NOTE}.</p>
        <div className="table-wrap"><table><thead><tr><th>Кейс</th><th>Компетенция</th><th>Основной индикатор</th><th>Доп. индикатор</th><th>MOST ID</th><th>LEAST ID</th></tr></thead>
          <tbody>{HOLDING_SJT_CASES.map(c=><tr key={c.questionId} data-holding-case={c.caseNumber}><td>{c.caseNumber}</td><td>{c.competencyCode}</td><td>{c.indicatorCode}</td><td>{c.additionalIndicatorCode}</td><td>{c.mostOptionId}</td><td>{c.leastOptionId}</td></tr>)}</tbody>
        </table></div>
      </div>
    </Panel>
  );
  const total = (source.data?.questions || []).reduce(
      (sum: number, q: any) => sum + q.options.length,
      0,
    ),
    filled = Object.values(ratings)
      .flatMap((r) => Object.values(r))
      .filter((v) => v !== null).length;
  const save = async (approve: boolean) => {
    setBusy(true);
    try {
      await post("/sjt-expert-key", {
        version: source.data.version,
        ratings,
        approve,
      });
      await source.refresh();
      notify(
        t(
          approve
            ? "Экспертный ключ готов к передаче владельцу платформы"
            : "Черновик ключа сохранён",
          approve
            ? "Сарапшылық кілт платформа иесіне беруге дайын"
            : "Кілт жобасы сақталды",
        ),
      );
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t("Экспертный ключ SJT", "SJT сарапшылық кілті")}>
      <LoadState loading={source.loading} error={source.error}>
        <div className="panel-body form-stack">
          <p>
            {t(
              "Оценка одного специалиста: эффективность каждого действия от 1 до 5. Этот ключ не заменяет опубликованный тест автоматически.",
              "Бір маманның бағасы: әр әрекеттің тиімділігі 1-ден 5-ке дейін. Бұл кілт жарияланған тестті автоматты алмастырмайды.",
            )}
          </p>
          <details lang="ru"><summary>Справочник Холдинга: 14 кейсов и дословная привязка индикаторов (исходный язык RU)</summary>
            <p className="notice warning">Ключ не утверждён экспертной панелью</p>
            <p>Исходный ключ — черновик. Оценки одного специалиста и статус «готов» не равны утверждению экспертной панелью.</p>
            <p>Отдельный профиль SJT: C2, C3, C4, C7. C1, C5, C6, C8: {HOLDING_SINGLE_CASE_NOTE}.</p>
            <div className="table-wrap"><table><thead><tr><th>Кейс</th><th>Компетенция</th><th>Основной индикатор</th><th>Доп. индикатор</th><th>MOST ID</th><th>LEAST ID</th></tr></thead>
              <tbody>{HOLDING_SJT_CASES.map(c=><tr key={c.questionId} data-holding-case={c.caseNumber}><td>{c.caseNumber}</td><td>{c.competencyCode}</td><td>{c.indicatorCode}</td><td>{c.additionalIndicatorCode}</td><td>{c.mostOptionId}</td><td>{c.leastOptionId}</td></tr>)}</tbody>
            </table></div>
          </details>
          <p>
            <b>
              {t("Оценено вариантов", "Бағаланған нұсқалар")}: {filled} /{" "}
              {total}
            </b>{" "}
            {dirty &&
              t(
                "· Есть несохранённые изменения",
                "· Сақталмаған өзгерістер бар",
              )}
          </p>
          <details>
            <summary>
              {t(
                `Открыть ${source.data?.questions.length ?? 0} ситуаций для оценки`,
                `Бағалау үшін ${source.data?.questions.length ?? 0} жағдаятты ашу`,
              )}
            </summary>
            {source.data?.questions.map((q: any) => (
              <details key={q.id} style={{ margin: "18px 0" }}>
                <summary>{loc(q.text).split("\n")[0]}</summary>
                <p style={{ whiteSpace: "pre-line" }}>{loc(q.text)}</p>
                {q.options.map((o: any) => (
                  <Field key={o.id} label={loc(o.text)}>
                    <select
                      aria-label={`${loc(q.text).split("\n")[0]} — ${loc(o.text)}`}
                      value={ratings[q.id]?.[o.id] ?? ""}
                      onChange={(e) => {
                        setRatings({
                          ...ratings,
                          [q.id]: {
                            ...ratings[q.id],
                            [o.id]: e.target.value
                              ? Number(e.target.value)
                              : null,
                          },
                        });
                        setDirty(true);
                      }}
                    >
                      <option value="">
                        {t("Не оценено", "Бағаланбаған")}
                      </option>
                      {[1, 2, 3, 4, 5].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </details>
            ))}
          </details>
          <div className="row wrap">
            <Button variant="secondary" busy={busy} onClick={() => save(false)}>
              {t("Сохранить черновик ключа", "Кілт жобасын сақтау")}
            </Button>
            <Button
              busy={busy}
              disabled={filled !== total || total === 0}
              onClick={() => save(true)}
            >
              {t("Утвердить экспертный ключ", "Сарапшылық кілтті бекіту")}
            </Button>
            {source.data?.status === "ready" && !dirty && (
              <Button
                variant="secondary"
                onClick={() =>
                  download(
                    "/sjt-expert-key/export",
                    "sjt-expert-import.json",
                  ).catch((e) => notify(e.message, "error"))
                }
              >
                {t("Скачать ключ для импорта", "Импорт кілтін жүктеу")}
              </Button>
            )}
          </div>
        </div>
      </LoadState>
    </Panel>
  );
}
