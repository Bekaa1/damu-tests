import {
  type ReportPerson,
  type ReportLanguage,
  reportLoc,
} from "../../../packages/core/reporting";
const esc = (x: unknown) =>
  String(x ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function competencyReport(person: ReportPerson, lang: ReportLanguage) {
  const profile = person.competencyProfile;
  if (!profile) return { overview: "", details: "" };
  const t = (ru: string, kk: string) => (lang === "ru" ? ru : kk),
    loc = (v: any) => reportLoc(v, lang);
  const config = profile.model.content,
    ratings = profile.consensus?.scores?.ratings || [],
    role = config.roles.find(
      (r: any) => r.id === profile.consensus?.scores?.roleId,
    );
  const score = (id: string) => ratings.find((r: any) => r.competencyId === id);
  const overview =
    (profile.model.status !== "approved"
      ? `<p class="note">${t("Целевые уровни и индикаторы: проект для согласования.", "Мақсатты деңгейлер мен индикаторлар: келісуге арналған жоба.")}</p>`
      : "") +
    `<p>${role ? esc(loc(role.name)) : t("Должностной профиль ещё не выбран экспертом.", "Лауазымдық бейінді сарапшы әлі таңдамаған.")}</p><table><thead><tr><th>${t("Компетенция", "Құзырет")}</th><th>${t("Балл", "Балл")}</th><th>${t("Цель", "Мақсат")}</th><th>${t("Соответствие", "Сәйкестік")}</th></tr></thead><tbody>` +
    config.competencies
      .map((c: any) => {
        const value = score(c.id)?.value,
          target = role?.targets[c.id];
        return `<tr><td>${esc(loc(c.name))}<div class="track" style="margin-top:7px"><i style="width:${typeof value === "number" ? (value / 5) * 100 : 0}%"></i>${target ? `<b style="position:absolute;left:${(target / 5) * 100}%;top:-3px;height:16px;border-left:2px dashed #b5843c"></b>` : ""}</div></td><td class="num">${value ?? "—"}</td><td class="num">${target ?? "—"}</td><td>${typeof value === "number" && target ? (value >= target ? t("Достигнут", "Қол жеткізілді") : t("Ниже цели", "Мақсаттан төмен")) : "—"}</td></tr>`;
      })
      .join("") +
    `</tbody></table><p class="note">${t("Шкала 1–5. Зелёная полоса — итоговая оценка эксперта; пунктир — требуемый уровень должности. Пропуск означает отсутствие итоговой оценки.", "1–5 шкаласы. Жасыл жолақ — сарапшының қорытынды бағасы; үзік сызық — лауазымның талап етілетін деңгейі. Бос белгі қорытынды бағаның жоқтығын білдіреді.")}</p>`;
  const details = config.competencies
    .map((c: any) => {
      const rating = score(c.id),
        card = profile.cards.find((s: any) => s.id === c.id);
      const sourceIds = rating?.evidenceIds || card?.sourceIds || [],
        sources = (card?.sources || []).filter((s: any) =>
          sourceIds.includes(s.id),
        );
      const methods = new Set(sources.map((s: any) => s.method)).size;
      const testSources = sources.filter((s: any) => s.kind === "test");
      const observations = sources.filter((s: any) => s.kind === "exercise");
      const tests = testSources
        .map((s: any) => {
          const value =
            typeof s.score.total === "number"
              ? `${s.score.total} / ${s.score.maximum}`
              : Object.entries(s.score.scales || {})
                  .filter(([id]) =>
                    s.scales.length ? s.scales.includes(id) : id.length === 1,
                  )
                  .map(
                    ([, v]: [string, any]) =>
                      `${esc(loc(v.name))}: ${Number(v.mean).toFixed(2)}`,
                  )
                  .join("; ") ||
                t(
                  "Подробный профиль приведён в разделе методики",
                  "Толық бейін әдістеме бөлімінде берілген",
                );
          return `<tr><td>${esc(loc(s.name))}</td><td>${value}</td></tr>`;
        })
        .join("");
      const behavior = observations
        .map((s: any) => {
          const examples = [
            ...new Set(s.scores.map((v: any) => v.example)),
          ] as string[];
          return `<tr><td>${esc(loc(s.name))}<br><b>${esc(s.expertName)}</b><br><small>${s.scores.map((v: any, i: number) => `${i + 1}: ${v.score}/5`).join(" · ")}</small></td><td>${examples.map((example) => esc(example)).join("<br>")}</td></tr>`;
        })
        .join("");
      return (
        `<h2>${esc(loc(c.name))}</h2><p><b>${t("Итоговая оценка", "Қорытынды баға")}: ${rating?.value ?? "—"} / 5</b></p>${rating?.reason ? `<p>${esc(rating.reason)}</p>` : ""}<p class="note">${t("Независимых методов", "Тәуелсіз әдістер")}: ${methods}${methods < 2 ? ` · ${t("Недостаточно источников (нужно не менее двух)", "Дереккөздер жеткіліксіз (кемінде екеуі қажет)")}` : ""}</p>` +
        (behavior
          ? `<table><thead><tr><th>${t("Упражнение и ассессор", "Жаттығу және бағалаушы")}</th><th>${t("Наблюдаемое поведение", "Бақыланған мінез-құлық")}</th></tr></thead><tbody>${behavior}</tbody></table>`
          : "") +
        (tests
          ? `<table><thead><tr><th>${t("Подтверждающий тест", "Растайтын тест")}</th><th>${t("Результат", "Нәтиже")}</th></tr></thead><tbody>${tests}</tbody></table>`
          : "")
      );
    })
    .join("");
  return { overview, details };
}
