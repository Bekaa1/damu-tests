"use client";
import { useState } from "react";
import {
  pilotCanStart,
  type EmployerPermission,
} from "../../../packages/core/pilot";
import { useApp, Button, Field, Modal, post } from "./ui";

export function PilotPermission({ campaign }: { campaign: any }) {
  const { me, t, reload, notify } = useApp();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  if (me.organization.purpose !== "pilot") return null;
  const permission = campaign.employerPermission as EmployerPermission | null;
  return (
    <div className="mt">
      <p className="notice info">
        {pilotCanStart(me.organization, campaign)
          ? t(
              "Разрешение работодателя подтверждено. Участники отдельно дают личное согласие при входе.",
              "Жұмыс берушінің рұқсаты расталды. Қатысушылар кірген кезде жеке келісім береді.",
            )
          : t(
              "До регистрации разрешения работодателя запуск тестов заблокирован.",
              "Жұмыс берушінің рұқсаты тіркелгенше тесттерді бастауға болмайды.",
            )}
      </p>
      <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
        {t("Разрешение работодателя", "Жұмыс берушінің рұқсаты")}
      </Button>
      {open && (
        <Modal
          title={t("Разрешение работодателя", "Жұмыс берушінің рұқсаты")}
          onClose={() => setOpen(false)}
        >
          <form
            className="modal-body form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await post(`/campaigns/${campaign.id}/employer-permission`, {
                  employer: form.get("employer"),
                  reference: form.get("reference"),
                  receivedAt: form.get("receivedAt"),
                  confirmed: form.get("confirmed") === "on",
                });
                await reload();
                setOpen(false);
                notify(t("Разрешение зарегистрировано", "Рұқсат тіркелді"));
              } catch (e) {
                notify((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {t(
                "Укажите основание уже полученного разрешения. Запись сохраняется в журнале; она не заменяет согласие участника.",
                "Алынған рұқсаттың негізін көрсетіңіз. Жазба журналда сақталады; ол қатысушының келісімін алмастырмайды.",
              )}
            </p>
            <Field
              label={t(
                "Работодатель участников",
                "Қатысушылардың жұмыс берушісі",
              )}
            >
              <input
                name="employer"
                required
                minLength={2}
                maxLength={200}
                defaultValue={permission?.employer || ""}
              />
            </Field>
            <Field
              label={t(
                "Письмо или описание согласования",
                "Хат немесе келісу сипаттамасы",
              )}
            >
              <textarea
                name="reference"
                required
                minLength={5}
                maxLength={1000}
                rows={3}
                defaultValue={permission?.reference || ""}
              />
            </Field>
            <Field label={t("Дата получения разрешения", "Рұқсат алынған күн")}>
              <input
                name="receivedAt"
                type="date"
                required
                defaultValue={permission?.receivedAt || ""}
              />
            </Field>
            <label className="row">
              <input name="confirmed" type="checkbox" required />
              {t(
                "Подтверждаю, что разрешение получено",
                "Рұқсат алынғанын растаймын",
              )}
            </label>
            <Button busy={busy}>
              {t("Сохранить подтверждение", "Растауды сақтау")}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
