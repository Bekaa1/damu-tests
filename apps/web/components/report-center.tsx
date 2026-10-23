"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Users, Sparkles, Download, Eye, Clock3, CheckCircle2, AlertCircle } from "lucide-react";
import { useApp, useData, post, download, PageTitle, Panel, Button, Empty, LoadState, Avatar } from "./ui";

type ReportRow = {
  id: string; membershipId: string | null; kind: string; language: string;
  status: string; createdAt: string; error: string | null; participantCount: number; createdByName?: string;
};
const inProgress = (report?: ReportRow) => Boolean(report && ["pending", "processing"].includes(report.status));

async function previewPdf(id: string, language: string) {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Разрешите открытие вкладки для просмотра PDF");
  win.opener = null;
  win.document.title = language === "kk" ? "Есепті көру" : "Просмотр отчёта";
  win.document.body.textContent = language === "kk" ? "PDF дайындалуда…" : "Подготавливаем PDF…";
  win.document.body.style.cssText = "font:18px Arial,sans-serif;color:#243746;padding:32px";
  try {
    const org = localStorage.getItem("assessflow.org");
    const response = await fetch("/api/generated-reports/" + id + "/pdf", { headers: org ? { "x-organization-id": org } : {} });
    if (!response.ok) throw new Error((await response.json()).message || "Не удалось открыть отчёт");
    const url = URL.createObjectURL(await response.blob());
    win.location.replace(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { win.close(); throw error; }
}

function ReportState({ report }: { report?: ReportRow }) {
  const { t } = useApp();
  if (!report) return <span className="text-muted">{t("Не сформирован", "Жасалмаған")}</span>;
  if (report.status === "completed") return <span className="report-state ready"><CheckCircle2 size={16} />{t("Готов", "Дайын")}</span>;
  if (inProgress(report)) return <span className="report-state"><Clock3 size={16} />{t(report.status === "pending" ? "В очереди" : "Формируется", report.status === "pending" ? "Кезекте" : "Жасалуда")}</span>;
  return <span className="report-state failed"><AlertCircle size={16} />{t("Не удалось сформировать", "Жасау мүмкін болмады")}</span>;
}
function PdfActions({ report }: { report: ReportRow }) {
  const { t, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const open = async (preview: boolean) => {
    setBusy(true);
    try {
      if (preview) await previewPdf(report.id, report.language);
      else await download("/generated-reports/" + report.id + "/pdf", "AssessFlow-" + report.kind + "-" + report.language + ".pdf");
    } catch (error) { notify((error as Error).message, "error"); }
    finally { setBusy(false); }
  };
  return <div className="report-actions">
    <Button variant="secondary" disabled={busy} onClick={() => open(true)}><Eye size={15} />{t("Просмотр", "Көру")}</Button>
    <Button busy={busy} onClick={() => open(false)}><Download size={15} />PDF</Button>
  </div>;
}
function GenerationNotice() {
  const { t } = useApp();
  return <div className="report-generation" role="status" aria-live="polite">
    <div><Sparkles size={20} /><div><strong>{t("Готовим отчёт", "Есеп дайындалуда")}</strong><p>{t("Анализируем результаты и составляем рекомендации. Можно продолжать работу: готовый PDF появится здесь автоматически.", "Нәтижелерді талдап, ұсыныстар дайындаудамыз. Жұмысты жалғастыра аласыз: дайын PDF осы жерде автоматты түрде пайда болады.")}</p></div></div>
    <div className="report-indeterminate" aria-hidden="true"><span /></div>
  </div>;
}
export function ReportCenter({ kind }: { kind: "individual" | "team" }) {
  const { t, locale, campaign, campaigns, me, notify } = useApp();
  const people = useData<any[]>(campaign ? "/people?campaignId=" + campaign : null);
  const reports = useData<ReportRow[]>(campaign ? "/generated-reports?campaignId=" + campaign + "&kind=" + kind : null);
  const [busyId, setBusyId] = useState("");
  const [search, setSearch] = useState("");
  const rows = reports.data || [];
  const running = rows.some(inProgress);
  const canGenerate = me.role === "admin" || me.role === "superadmin";
  const participants = (people.data || []).filter(p => p.role === "employee" && p.total > 0);
  const ready = participants.filter(p => p.status === "completed").length;
  const withScores = participants.filter(p => p.results?.some((r: any) => r.score)).length;
  const selectedCampaign = campaigns.find(c => c.id === campaign);
  const current = rows.find(r => r.language === locale);
  const { refreshSilently } = reports;
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshSilently();
    };
    const timer = window.setInterval(refreshWhenVisible, running ? 3000 : 8000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [running, refreshSilently]);
  const generate = async (membershipId?: string, regenerate = false) => {
    setBusyId(membershipId || "team");
    try {
      await post("/generated-reports", { campaignId: campaign, kind, language: locale, ...(membershipId ? { membershipId } : {}), regenerate });
      await refreshSilently();
      notify(t("Отчёт формируется. Готовый файл появится здесь.", "Есеп жасалуда. Дайын файл осы жерде пайда болады."));
    } catch (error) { notify((error as Error).message, "error"); }
    finally { setBusyId(""); }
  };
  const timestamp = (value: string) => new Date(value).toLocaleString(locale === "ru" ? "ru-RU" : "kk-KZ", { dateStyle: "medium", timeStyle: "short" });
  return <>
    <PageTitle title={kind === "team" ? t("Командные отчёты", "Командалық есептер") : t("Индивидуальные отчёты", "Жеке есептер")}
      description={t("Наглядные результаты, персональные выводы и практические рекомендации.", "Көрнекі нәтижелер, жеке қорытындылар және практикалық ұсыныстар.")} />
    <nav className="report-tabs" aria-label={t("Виды отчётов", "Есеп түрлері")}>
      <Link href="/reports" aria-current={kind === "individual" ? "page" : undefined}><FileText size={18} />{t("Индивидуальные", "Жеке")}</Link>
      <Link href="/team-reports" aria-current={kind === "team" ? "page" : undefined}><Users size={18} />{t("Командные", "Командалық")}</Link>
    </nav>
    {!campaign ? <Empty title={t("Выберите кампанию оценки", "Бағалау науқанын таңдаңыз")} /> :
    <LoadState loading={people.loading || reports.loading} error={people.error || reports.error}>
      <section className="report-intro">
        <div><span className="report-eyebrow">{kind === "team" ? t("КОМАНДА В ЦЕЛОМ", "БҮКІЛ КОМАНДА") : t("РАЗВИТИЕ КАЖДОГО УЧАСТНИКА", "ӘР ҚАТЫСУШЫНЫ ДАМЫТУ")}</span>
          <h2>{kind === "team" ? selectedCampaign?.name : t("Полная картина результатов", "Нәтижелердің толық көрінісі")}</h2>
          <p>{kind === "team" ? t("Профили команды, сравнение головного офиса и филиалов, экспертная матрица потенциала и план развития группы.", "Команда бейіндері, бас кеңсе мен филиалдарды салыстыру, сараптамалық әлеует матрицасы және топтың даму жоспары.") : t("Графики по тестам, сильные стороны, зоны развития и индивидуальный план с конкретными действиями и сроками.", "Тест графиктері, күшті жақтар, даму бағыттары және нақты әрекеттері мен мерзімдері бар жеке жоспар.")}</p>
          <div className="report-intro-meta"><span>{t("PDF · формат А4", "PDF · А4 пішімі")}</span><span>{locale === "ru" ? "Русский" : "Қазақша"}</span><span>{t("Скачивание сразу после генерации", "Жасалғаннан кейін бірден жүктеу")}</span></div>
        </div>
        <div className="report-intro-count"><strong>{kind === "team" ? withScores : ready}<small> / {participants.length}</small></strong><span>{kind === "team" ? t("участников с результатами", "нәтижесі бар қатысушылар") : t("готовы к формированию отчёта", "есеп жасауға дайын")}</span></div>
      </section>
      {running ? <GenerationNotice /> : null}
      {kind === "team" ? <>
        <Panel title={t("Отчёт по выбранной кампании", "Таңдалған науқан бойынша есеп")}>
          <div className="panel-body report-team-current"><div><ReportState report={current} /><p className="text-muted">{current ? timestamp(current.createdAt) : t("AI подготовит выводы и рекомендации по доступным результатам участников.", "AI қатысушылардың қолжетімді нәтижелері бойынша қорытындылар мен ұсыныстар дайындайды.")}</p>{current?.status === "failed" ? <p role="alert">{current.error}</p> : null}</div>
            <div className="report-actions">{current?.status === "completed" ? <PdfActions report={current} /> : null}
              {canGenerate ? <Button variant={current?.status === "completed" ? "secondary" : "primary"} busy={busyId === "team"} disabled={!withScores || inProgress(current)} onClick={() => generate(undefined, current?.status === "completed")}><Sparkles size={16} />{current?.status === "completed" ? t("Сформировать заново", "Қайта жасау") : t("Сформировать отчёт", "Есеп жасау")}</Button> : null}
            </div>
          </div>
        </Panel>
        <Panel className="section-gap" title={t("История командных отчётов", "Командалық есептер тарихы")}>
          {!rows.length ? <Empty title={t("Отчётов пока нет", "Әзірге есептер жоқ")} /> : <div className="report-history">{rows.map(row => <div key={row.id}><div><strong>{timestamp(row.createdAt)}</strong><p className="text-muted">{row.participantCount} {t("участников", "қатысушы")} · {row.language.toUpperCase()} · {t("Сформировал", "Жасаған")}: {row.createdByName || "—"}</p></div><ReportState report={row} />{row.status === "completed" ? <PdfActions report={row} /> : null}</div>)}</div>}
        </Panel>
      </> : <Panel title={t("Отчёты участников", "Қатысушылардың есептері")} action={<label className="report-search"><span className="sr-only">{t("Поиск участника", "Қатысушыны іздеу")}</span><input placeholder={t("Найти участника", "Қатысушыны табу")} value={search} onChange={e => setSearch(e.target.value)} /></label>}>
        <div className="table-wrap"><table><thead><tr><th>{t("УЧАСТНИК", "ҚАТЫСУШЫ")}</th><th>{t("ТЕСТЫ", "ТЕСТТЕР")}</th><th>{t("AI-ОТЧЁТ", "AI-ЕСЕП")}</th><th>{t("ДЕЙСТВИЯ", "ӘРЕКЕТТЕР")}</th></tr></thead><tbody>
          {participants.filter(p => (p.user.name + " " + p.unit).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(p => {
            const report = rows.find(r => r.membershipId === p.id && r.language === locale);
            const history = rows.filter(r => r.membershipId === p.id && r.status === "completed");
            return <tr key={p.id}><td><Link href={"/people/" + p.id} className="cell-person"><Avatar name={p.user.name} /><div><strong>{p.user.name}</strong><small>{p.unit}</small></div></Link></td><td>{p.completed} / {p.total}</td>
              <td><ReportState report={report} />{report?.createdByName ? <p className="text-small text-muted">{t("Сформировал", "Жасаған")}: {report.createdByName}</p> : null}{report?.error ? <p className="text-small text-muted">{report.error}</p> : null}{history.length ? <details className="report-version-list"><summary>{t("История файлов", "Файлдар тарихы")} ({history.length})</summary>{history.map(r => <button key={r.id} type="button" onClick={() => download("/generated-reports/" + r.id + "/pdf", "AssessFlow-" + r.language + ".pdf").catch(e => notify(e.message, "error"))}>{timestamp(r.createdAt)} · {r.language.toUpperCase()} · {r.createdByName || "—"} <Download size={13} /></button>)}</details> : null}</td>
              <td><div className="report-row-actions">{report?.status === "completed" ? <PdfActions report={report} /> : null}
                {canGenerate ? <Button variant={report?.status === "completed" ? "ghost" : "secondary"} busy={busyId === p.id} disabled={p.status !== "completed" || inProgress(report)} onClick={() => generate(p.id, report?.status === "completed")}><Sparkles size={15} />{report?.status === "completed" ? t("Сформировать новую версию", "Жаңа нұсқасын жасау") : t("Сформировать", "Жасау")}</Button> : null}
              </div></td></tr>;
          })}
        </tbody></table></div>
        {!participants.length ? <Empty title={t("В кампании пока нет участников", "Науқанда әзірге қатысушылар жоқ")} /> : null}
      </Panel>}
    </LoadState>}
  </>;
}
