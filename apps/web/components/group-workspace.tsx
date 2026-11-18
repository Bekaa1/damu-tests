"use client";
import { useState, useEffect } from "react";
import {
  useApp,
  useData,
  post,
  download,
  Panel,
  Button,
  Field,
  PageTitle,
  LoadState,
  Modal,
} from "./ui";
type Group = {
  id: string;
  name: { ru: string; kk: string };
  criteria: { ru: string; kk: string };
};
export function GroupWorkspace() {
  const { campaign, t, loc, notify } = useApp(),
    source = useData<any>(campaign ? `/campaigns/${campaign}/groups` : null);
  const [groups, setGroups] = useState<Group[]>([]),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [groupId, setGroupId] = useState(""),
    [reason, setReason] = useState("");
  useEffect(() => {
    if (source.data)
      setGroups(structuredClone(source.data.scheme?.content.groups || []));
  }, [source.data]);
  const save = async (approve: boolean) => {
    setBusy(true);
    try {
      await post("/group-scheme", {
        version: source.data?.scheme?.version || 0,
        content: { groups },
        approve,
      });
      await source.refresh();
      notify(
        t(
          "Справочник сохранён новой версией",
          "Анықтамалық жаңа нұсқамен сақталды",
        ),
      );
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const assign = async () => {
    setBusy(true);
    try {
      await post(`/campaigns/${campaign}/groups/${selected.id}`, {
        schemeId: source.data.scheme.id,
        groupId,
        reason,
      });
      setSelected(null);
      await source.refresh();
      notify(t("Группа назначена экспертом", "Топты сарапшы тағайындады"));
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        title={t("Группы сотрудников", "Қызметкерлер топтары")}
        description={t(
          "Справочник, согласованный с клиентом, и ручное распределение по итогам экспертной оценки.",
          "Клиентпен келісілген анықтамалық және сарапшылық бағалау қорытындысы бойынша қолмен бөлу.",
        )}
      />
      <LoadState loading={source.loading} error={source.error}>
        <Panel
          title={t(
            "Названия и критерии групп",
            "Топ атаулары мен критерийлері",
          )}
        >
          <div className="panel-body form-stack">
            <p className="notice">
              {source.data?.scheme?.status === "approved"
                ? t(
                    "Справочник утверждён экспертом после согласования с клиентом",
                    "Анықтамалық клиентпен келісілген соң сарапшымен бекітілді",
                  )
                : t(
                    "Черновик. Названия и критерии определяет эксперт и согласует клиент. Автоматическое распределение выключено.",
                    "Жоба. Атаулар мен критерийлерді сарапшы анықтайды және клиент келіседі. Автоматты бөлу өшірулі.",
                  )}
            </p>
            {groups.map((g, i) => (
              <fieldset key={g.id} style={{ padding: 16, marginBottom: 16 }}>
                <legend>
                  {t("Группа", "Топ")} {i + 1}
                </legend>
                <div className="form-grid">
                  {(["ru", "kk"] as const).map((lang) => (
                    <div key={lang}>
                      <Field
                        label={`${t("Название", "Атауы")} · ${lang.toUpperCase()}`}
                      >
                        <input
                          value={g.name[lang]}
                          onChange={(e) =>
                            setGroups(
                              groups.map((item, j) =>
                                j === i
                                  ? {
                                      ...item,
                                      name: {
                                        ...item.name,
                                        [lang]: e.target.value,
                                      },
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field
                        label={`${t("Критерии отнесения", "Бөлу критерийлері")} · ${lang.toUpperCase()}`}
                      >
                        <textarea
                          value={g.criteria[lang]}
                          onChange={(e) =>
                            setGroups(
                              groups.map((item, j) =>
                                j === i
                                  ? {
                                      ...item,
                                      criteria: {
                                        ...item.criteria,
                                        [lang]: e.target.value,
                                      },
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setGroups(groups.filter((_, j) => j !== i))}
                >
                  {t("Удалить группу", "Топты жою")}
                </Button>
              </fieldset>
            ))}
            <div className="row wrap">
              <Button
                variant="secondary"
                disabled={groups.length >= 12}
                onClick={() =>
                  setGroups([
                    ...groups,
                    {
                      id: "group-" + crypto.randomUUID(),
                      name: { ru: "", kk: "" },
                      criteria: { ru: "", kk: "" },
                    },
                  ])
                }
              >
                {t("Добавить группу", "Топ қосу")}
              </Button>
              <Button
                variant="secondary"
                busy={busy}
                onClick={() => save(false)}
              >
                {t("Сохранить черновик", "Жобаны сақтау")}
              </Button>
              <Button
                busy={busy}
                disabled={groups.length < 2}
                onClick={() => save(true)}
              >
                {t(
                  "Утвердить согласованный справочник",
                  "Келісілген анықтамалықты бекіту",
                )}
              </Button>
            </div>
          </div>
        </Panel>
        <Panel
          title={t("Распределение сотрудников", "Қызметкерлерді бөлу")}
          action={
            <Button
              variant="secondary"
              disabled={!campaign}
              onClick={() =>
                download(
                  `/campaigns/${campaign}/groups-export`,
                  "assessment-groups.xlsx",
                ).catch((e) => notify(e.message, "error"))
              }
            >
              {t("Скачать отдельный список", "Бөлек тізімді жүктеу")}
            </Button>
          }
        >
          <div className="panel-body">
            <p>
              {t(
                "Назначение доступно после сохранения итоговых оценок всех восьми компетенций по утверждённой модели. Требуется обоснование эксперта.",
                "Тағайындау бекітілген модель бойынша барлық сегіз құзыреттің қорытынды бағаларын сақтағаннан кейін қолжетімді. Сарапшы негіздемесі қажет.",
              )}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("Сотрудник", "Қызметкер")}</th>
                    <th>{t("Группа", "Топ")}</th>
                    <th>{t("Действие", "Әрекет")}</th>
                  </tr>
                </thead>
                <tbody>
                  {source.data?.people.map((p: any) => {
                    const a = p.assignment,
                      g = a?.scheme.content.groups.find(
                        (g: any) => g.id === a.groupId,
                      );
                    return (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          <br />
                          {p.position}
                        </td>
                        <td>
                          {g ? loc(g.name) : "—"}
                          {a && (
                            <small style={{ display: "block" }}>
                              {a.reason}
                            </small>
                          )}
                          {a && a.schemeId !== source.data.scheme?.id && (
                            <small>
                              {t(
                                "Назначено по предыдущей версии справочника",
                                "Анықтамалықтың алдыңғы нұсқасы бойынша тағайындалған",
                              )}
                            </small>
                          )}
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            disabled={
                              source.data?.scheme?.status !== "approved"
                            }
                            onClick={() => {
                              setSelected(p);
                              setGroupId(
                                a?.schemeId === source.data.scheme.id
                                  ? a.groupId
                                  : "",
                              );
                              setReason("");
                            }}
                          >
                            {t("Назначить группу", "Топ тағайындау")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      </LoadState>
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div className="panel-body form-stack">
            <Field label={t("Группа", "Топ")}>
              <select
                aria-label={t("Группа", "Топ")}
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">
                  {t("Выберите группу", "Топты таңдаңыз")}
                </option>
                {source.data.scheme.content.groups.map((g: Group) => (
                  <option key={g.id} value={g.id}>
                    {loc(g.name)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Обоснование эксперта", "Сарапшы негіздемесі")}>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button
              busy={busy}
              disabled={!groupId || reason.trim().length < 20}
              onClick={assign}
            >
              {t("Сохранить назначение", "Тағайындауды сақтау")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
