const esc = (v: unknown) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function individualTemplate(d: any, language: "ru" | "kk" = "ru") {
  const t = (ru: string, kk: string) => (language === "ru" ? ru : kk),
    loc = (v: any) =>
      typeof v === "string" ? v : v?.[language] || v?.ru || "";
  const content = d.report.content,
    approved = d.report.status === "approved";
  const status = approved
    ? t("Утверждённый экспертный отчёт", "Бекітілген сараптамалық есеп")
    : t("Предварительный отчёт", "Алдын ала есеп");
  const results = d.results.map((r: any) => ({
    ...r,
    s: r.result,
    v: r.attempt.assignment.testVersion,
  }));
  const header = `<div class="brand"><span>${esc(d.organization.name)}</span>${d.organization.logoUrl?.startsWith("data:image/") ? `<img src="${esc(d.organization.logoUrl)}"/>` : "<span>AssessFlow</span>"}</div>`;
  const title = (n: string, name: string) =>
    `${header}<div class="eyebrow">${t("ИНДИВИДУАЛЬНЫЙ ОТЧЁТ", "ЖЕКЕ ЕСЕП")} · ${n}</div><h1>${name}</h1><div class="sub">${esc(d.member.user.name)} · ${t("Версия", "Нұсқа")} ${d.report.version} · ${status}</div>`;
  const ai = (section: string) =>
    d.ai?.status === "completed"
      ? (d.ai.content?.[section] || [])
          .map((p: any) => `<p>${esc(p.text)}</p>`)
          .join("")
      : "";
  const bars = (scales: any, filter = (id: string) => true) =>
    Object.entries(scales)
      .filter(([id]) => filter(id))
      .map(
        ([id, v]: [string, any]) =>
          `<div class="keep"><div class="row"><span>${esc(loc(v.name))}</span><b>${Number(v.mean).toFixed(2)} / ${v.max}</b></div><div class="bar"><span style="width:${Math.max(0, Math.min(100, ((v.mean - v.min) / (v.max - v.min)) * 100))}%"></span></div></div>`,
      )
      .join("");
  const personality = results.find((r: any) => r.v.testId === "personality"),
    motivation = results.find((r: any) => r.v.testId === "motivation"),
    sjt = results.find((r: any) => r.s.algorithm === "sjt");
  const none = t("Данные не представлены.", "Деректер берілмеген.");
  const p1 = `<section class="page">${title("01", t("Участник и результаты тестирования", "Қатысушы және тестілеу нәтижелері"))}<div class="box"><div class="grid"><div><span class="label">${t("УЧАСТНИК", "ҚАТЫСУШЫ")}</span><h3>${esc(d.member.user.name)}</h3><p>${esc(d.member.position)}<br>${esc(d.member.unit)}</p></div><div><span class="label">${t("ОТВЕТСТВЕННЫЙ ЭКСПЕРТ", "ЖАУАПТЫ САРАПШЫ")}</span><h3>${esc(d.author?.name)}</h3><p>${approved ? new Date(d.report.approvedAt).toLocaleDateString(language === "ru" ? "ru-RU" : "kk-KZ") : t("Ожидает утверждения", "Бекітуді күтуде")}</p></div></div></div>
 <h2>${t("Используемые методики", "Қолданылған әдістемелер")}</h2><table><tr><th>${t("Методика", "Әдістеме")}</th><th>${t("Версия / язык", "Нұсқа / тіл")}</th><th>${t("Версия расчёта", "Есептеу нұсқасы")}</th></tr>${results.map((r: any) => `<tr><td>${esc(loc(r.v.test.name))}</td><td>${esc(r.v.version)} / ${r.attempt.language.toUpperCase()}</td><td>${esc(r.scoringKeyId)}</td></tr>`).join("")}</table>
 <h2>${t("Аналитические способности", "Талдау қабілеттері")}</h2><table><tr><th>${t("Направление", "Бағыт")}</th><th>${t("Первичный балл", "Бастапқы балл")}</th><th>${t("Доля верных ответов", "Дұрыс жауаптар үлесі")}</th></tr>${results
   .filter((r: any) => r.s.algorithm === "cognitive")
   .map(
     (r: any) =>
       `<tr><td>${esc(loc(r.v.test.name))}</td><td>${r.s.total} / ${r.s.maximum}</td><td>${Number(r.s.percent).toFixed(1)}%</td></tr>`,
   )
   .join("")}</table>${ai("analyticalAbilities")}
 <h3>${t("Правила интерпретации", "Түсіндіру ережелері")}</h3><p>${t("Первичный балл отражает число правильных ответов выбранной формы. Доля правильных ответов не является процентилем. Баллы разных методик не складываются в показатель профессиональной пригодности.", "Бастапқы балл таңдалған нысандағы дұрыс жауаптардың санын көрсетеді. Дұрыс жауаптардың үлесі процентиль емес. Әртүрлі әдістемелердің балдары кәсіби жарамдылық көрсеткішіне қосылмайды.")}</p>
 <p class="limit">${t("Локальные нормативы не применяются. Переводы и технические адаптации требуют методологического утверждения. Все выводы ограничены составом выбранных заданий.", "Жергілікті нормалар қолданылмайды. Аудармалар мен техникалық бейімдеулер әдістемелік бекітуді талап етеді. Қорытындылар таңдалған тапсырмалар құрамымен шектеледі.")}</p></section>`;
  const p2 = `<section class="page">${title("02", t("Личность и мотивационный профиль", "Тұлға және мотивациялық бейін"))}<h2>${t("Личностные характеристики", "Тұлғалық сипаттамалар")} · IPIP-NEO-120</h2>${personality ? bars(personality.s.scales, (id) => id.length === 1) : `<p>${none}</p>`}<p class="limit">${t("Средние значения по шкале 1–5 с обратным кодированием. Высокое значение не означает хороший результат. Личностный профиль не является диагнозом.", "Кері кодтауды ескергендегі 1–5 шкаласы бойынша орташа мәндер. Жоғары мән жақсы нәтиже дегенді білдірмейді. Тұлғалық бейін диагноз емес.")}</p>${ai("personality")}
 <h2>${t("Мотивационный профиль", "Мотивациялық бейін")} · WMPS</h2>${motivation ? bars(motivation.s.scales) : `<p>${none}</p>`}<p class="limit">${t("Средние значения по шкале 1–6. Исходная методика разработана для китайской государственной службы. Перенос на другую аудиторию требует проверки; нормативные уровни не присваиваются.", "1–6 шкаласы бойынша орташа мәндер. Бастапқы әдістеме Қытайдың мемлекеттік қызметі үшін әзірленген. Басқа аудиторияда қолдану тексеруді талап етеді; нормативтік деңгейлер берілмейді.")}</p>${ai("motivation")}
 <h3>${t("Предварительный AI-анализ", "Алдын ала AI-талдау")}</h3>${d.ai?.status === "completed" ? ai("generalProfile") : `<p>${t("AI-анализ не сформирован. Описание результатов и экспертное заключение не подменяются вымышленными выводами.", "AI-талдау жасалмаған. Нәтижелер сипаттамасы мен сараптамалық қорытынды ойдан шығарылған тұжырымдармен алмастырылмайды.")}</p>`}</section>`;
  const p3 = `<section class="page">${title("03", t("Управленческие ситуации и практика", "Басқарушылық жағдайлар және практика"))}<h2>${t("Управленческие ситуации", "Басқарушылық жағдайлар")} · SJT</h2>${sjt ? `<div class="box"><div class="grid"><div><h3>${sjt.s.total} / ${sjt.s.maximum}</h3><p>${t("Доля совпадений", "Сәйкестік үлесі")}: ${Number(sjt.s.percent).toFixed(1)}%</p></div><div><p>MOST: ${sjt.s.mostMatches} / 8<br>LEAST: ${sjt.s.leastMatches} / 8</p></div></div></div><table><tr><th>${t("Ситуация", "Жағдай")}</th><th>MOST</th><th>LEAST</th><th>${t("Баллы", "Балдар")}</th></tr>${sjt.s.details.map((q: any, i: number) => `<tr><td>${i + 1}</td><td>${q.mostMatch ? t("Совпадает", "Сәйкес келеді") : t("Не совпадает", "Сәйкес емес")}</td><td>${q.leastMatch ? t("Совпадает", "Сәйкес келеді") : t("Не совпадает", "Сәйкес емес")}</td><td>${q.score} / 2</td></tr>`).join("")}</table>` : `<p>${none}</p>`}<p class="limit">${t("Предварительный индекс совпадений AssessFlow. Не является официальной шкалой 123test, процентилем или валидированной оценкой управленческого потенциала.", "AssessFlow алдын ала сәйкестік индексі. Ресми 123test шкаласы, процентиль немесе басқарушылық әлеуеттің валидтелген бағасы емес.")}</p>${ai("situations")}
 <h2>${t("Практический ассессмент", "Практикалық бағалау")}</h2>${d.observations.length ? d.observations.map((o: any) => `<h3>${esc(loc(o.criteriaSnapshot.name))}</h3><table><tr><th>${t("Компетенция / индикаторы", "Құзырет / индикаторлар")}</th><th>${t("Оценка", "Баға")}</th></tr>${o.criteriaSnapshot.criteria.map((c: any) => `<tr><td>${esc(c.name)}<br><span class="muted">${esc(c.indicators.join("; "))}</span></td><td>${o.scores[c.id] === null ? t("Не наблюдалось", "Бақыланбады") : esc(o.scores[c.id])}<br>${esc(c.scale.find((s: any) => s.value === o.scores[c.id])?.description || "")}</td></tr>`).join("")}</table><p>${esc(o.notes)}</p><p class="limit">${t("Автор", "Автор")}: ${esc(o.expertName || o.expertId)} · v${o.version} · ${new Date(o.createdAt).toLocaleDateString(language === "ru" ? "ru-RU" : "kk-KZ")}</p>`).join("") : `<p>${t("Наблюдения не представлены. Поведенческие выводы по отсутствующим наблюдениям не формируются.", "Бақылаулар берілмеген. Жоқ бақылаулар бойынша мінез-құлық тұжырымдары жасалмайды.")}</p>`}
 <h3>${t("Матрица потенциала", "Әлеует матрицасы")}</h3><p>${esc(loc(d.organization.matrixConfig.x))}: ${d.report.matrixX ?? "—"} / 3. ${esc(loc(d.organization.matrixConfig.y))}: ${d.report.matrixY ?? "—"} / 3.</p><p>${esc(d.report.matrixReason)}</p></section>`;
  const p4 = `<section class="page">${title("04", t("Экспертное заключение и развитие", "Сараптамалық қорытынды және даму"))}<h2>${t("Интегрированное заключение", "Біріктірілген қорытынды")}</h2><p>${esc(content.conclusion)}</p><div class="grid"><div><h3>${t("Сильные стороны", "Күшті жақтар")}</h3><p>${esc(content.strengths) || none}</p></div><div><h3>${t("Зоны развития", "Даму бағыттары")}</h3><p>${esc(content.development) || none}</p></div></div><h3>${t("Риски и ограничения", "Тәуекелдер мен шектеулер")}</h3><p>${esc(content.risks) || none}</p><h3>${t("Практические рекомендации", "Практикалық ұсыныстар")}</h3><p>${esc(content.recommendations) || none}</p><h2>${t("Индивидуальный план развития", "Жеке даму жоспары")}</h2><table><tr><th>${t("Цель", "Мақсат")}</th><th>${t("Действие", "Әрекет")}</th><th>${t("Срок", "Мерзім")}</th><th>${t("Критерий результата", "Нәтиже критерийі")}</th></tr>${(content.developmentPlan || []).map((p: any) => `<tr><td>${esc(p.goal)}</td><td>${esc(p.action)}</td><td>${esc(p.deadline)}</td><td>${esc(p.success)}</td></tr>`).join("")}</table><div class="box"><p>${t("Эксперт", "Сарапшы")}: ${esc(d.author?.name)}. ${status}. v${d.report.version}.</p><p class="limit">${t("Результаты применяются с учётом рабочего контекста и наблюдений. Платформа не принимает кадровые решения. Предыдущие версии заключений и расчётов сохраняются.", "Нәтижелер жұмыс жағдайы мен бақылауларды ескере отырып қолданылады. Платформа кадрлық шешімдер қабылдамайды. Қорытындылар мен есептеулердің алдыңғы нұсқалары сақталады.")}</p></div></section>`;
  return { html: p1 + p2 + p3 + p4, label: status };
}
