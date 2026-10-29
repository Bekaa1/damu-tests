import "dotenv/config";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {createHash} from 'node:crypto';
import { PrismaClient } from "@prisma/client";
import { openRouterKey } from "../apps/api/src/secrets";
const catalog = JSON.parse(readFileSync("data/new-forms.json", "utf8")).filter(
  (x: any) => x.id !== "logical",
);
const original = JSON.parse(readFileSync("data/catalog.json", "utf8")).find(
  (x: any) => x.id === "logical",
);
const book = new ExcelJS.Workbook();
await book.xlsx.readFile("data/sources/omib/items.xlsx");
const ids = [
  4, 2, 25, 50, 70, 38, 139, 126, 37, 84, 78, 101, 110, 100, 145, 125, 152, 190,
  185, 171, 166, 164, 213, 215,
];
const L = (ru: string) => ({ ru, kk: ru });
const paths = [
  "0,0 25,0 0,25",
  "25,100 0,100 0,75",
  "100,75 100,100 75,100",
  "75,0 100,0 100,25",
  "12.5,50 50,12.5",
  "12.5,50 50,87.5",
  "50,87.5 87.5,50",
  "50,12.5 87.5,50",
  "37.5,0 62.5,0 62.5,12.5 37.5,12.5",
  "0,37.5 0,62.5 12.5,62.5 12.5,37.5",
  "37.5,87.5 62.5,87.5 62.5,100 37.5,100",
  "87.5,37.5 87.5,62.5 100,62.5 100,37.5",
];
const arrows = [
  "50,12.5 37.5,25 62.5,25",
  "12.5,50 25,37.5 25,62.5",
  "50,87.5 37.5,75 62.5,75",
  "87.5,50 75,37.5 75,62.5",
];
function svg(code: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/>${[...code].map((bit, i) => (bit !== "1" ? "" : i < 12 ? `<polygon points="${paths[i]}" fill="${i >= 4 && i < 8 ? "none" : "black"}" stroke="black"/>` : i < 16 ? (i < 14 ? `<rect x="40" y="40" width="20" height="20" fill="${i % 2 ? "none" : "black"}" stroke="black"/>` : `<circle cx="50" cy="50" r="10" fill="${i % 2 ? "none" : "black"}" stroke="black"/>`) : `<polygon points="${arrows[i - 16]}" fill="black" stroke="black"/>`)).join("")}</svg>`;
}
function variants(item: number) {
  const row = book.worksheets[0].getRow(item + 1);
  const solution = String(row.getCell(14).value);
  const cells = String(row.getCell(15).value).split(",");
  const candidates = new Set<string>();
  const add = (s: string) => {
    if (/^[01]{20}$/.test(s) && s !== solution && s.includes("1"))
      candidates.add(s);
  };
  // Typical rule errors: copy a neighbour, union instead of intersection/XOR,
  // reverse subtraction, rotate in the wrong direction, omit a component group.
  for (const [a, b] of [
    [6, 7],
    [3, 4],
    [0, 1],
  ])
    for (const mode of ["or", "and", "xor", "sub", "rev"])
      add(
        [...cells[a]]
          .map((v, i) =>
            mode === "or"
              ? String(Number(v === "1" || cells[b][i] === "1"))
              : mode === "and"
                ? String(Number(v === "1" && cells[b][i] === "1"))
                : mode === "xor"
                  ? String(Number(v !== cells[b][i]))
                  : mode === "sub"
                    ? String(Number(v === "1" && cells[b][i] === "0"))
                    : String(Number(v === "0" && cells[b][i] === "1")),
          )
          .join(""),
      );
  for (const c of [...cells.slice(0, 8), solution])
    for (const shift of [1, 3])
      add(
        Array.from({ length: 5 }, (_, g) =>
          c
            .slice(g * 4, g * 4 + 4)
            .split("")
            .map((_, i) => c[g * 4 + ((i + shift) % 4)])
            .join(""),
        ).join(""),
      );
  for (const c of cells.slice(0, 8)) add(c);
  for (let g = 0; g < 5; g++)
    add(solution.slice(0, g * 4) + "0000" + solution.slice(g * 4 + 4));
  const incorrect = [...candidates]
    .sort((a, b) => distance(b, solution) - distance(a, solution))
    .slice(0, 5);
  if (incorrect.length !== 5)
    throw Error("Insufficient rule-based distractors " + item);
  return {
    solution,
    codes: [solution, ...incorrect],
    b: Number(row.getCell(12).value),
    a: Number(row.getCell(13).value),
  };
}
function distance(a: string, b: string) {
  return [...a].filter((x, i) => x !== b[i]).length;
}
const o = {
  ...original,
  version: "2.0-2026-10-26",
  name: L("Абстрактно-логическое мышление"),
  durationMinutes: 20,
  timeLimitSeconds: 1200,
  questions: [] as any[],
  config: { items: {} as any, bands: [7, 11, 15, 19, 24] },
  controlExamples: [],
  delivery: {
    shuffleOptions: true,
    practice: [] as any[],
    reviewStatus: "requires_methodologist_review",
  },
  instructions: L(
    "Найдите закономерности в строках матрицы и выберите недостающий элемент. Всего 24 задания, на основной тест — 20 минут. Можно пропускать вопросы и возвращаться. За неверный ответ или пропуск — 0 баллов. Сначала выполните два тренировочных задания без таймера. Таймер запустится после кнопки «Начать тест».",
  ),
  source:
    "OMIB https://osf.io/4km79/; короткая форма по документу заказчика 26.10.2026",
  limitations: L(
    "Короткая форма и варианты ответов подготовлены для методологической проверки.",
  ),
};
for (const [i, item] of [...ids, 1, 11].entries()) {
  const v = variants(item),
    prefix = `v2-item-${item}`;
  copyFileSync(
    `data/sources/omib/matrices/Item_${item}.svg`,
    `data/assets/omib/${prefix}.svg`,
  );
  const token=(code:string)=>createHash('sha256').update(prefix+':'+code).digest('hex').slice(0,16);
  v.codes.forEach((code) =>
    writeFileSync(`data/assets/omib/${prefix}-option-${token(code)}.svg`, svg(code)),
  );
  if (i < 24) {
    const id = `logical-v2-${item}`;
    o.questions.push({
      id,
      type: "image",
      text: L("Выберите недостающий элемент матрицы."),
      imageUrl: `/api/assets/omib/${prefix}.svg`,
      content: { sourceItem: item, b: v.b, a: v.a },
      options: v.codes.map((_, k) => ({
        id: `${id}-${token(v.codes[k])}`,
        text: L('Вариант ответа'),
        imageUrl: `/api/assets/omib/${prefix}-option-${token(v.codes[k])}.svg`,
      })),
    });
    o.config.items[id] = { correct: `${id}-${token(v.solution)}` };
  } else
    o.delivery.practice.push({
      text: L("Выберите недостающий элемент."),
      imageUrl: `/api/assets/omib/${prefix}.svg`,
      options: v.codes.map((_, k) => L(`Вариант ${k + 1}`)),
      images: v.codes.map(
        (_, k) => `/api/assets/omib/${prefix}-option-${token(v.codes[k])}.svg`,
      ),
      correct: 0,
      explanation: L(
        item === 1
          ? "В каждой строке фигуры первой и второй клетки складываются."
          : "Фигура поворачивается на один и тот же угол из клетки в клетку.",
      ),
    });
}
catalog.splice(2, 0, o);
for (const m of catalog) {
  m.description = L(
    (
      {
        verbal: "Анализ деловых текстов и обоснованность выводов.",
        numerical: "Работа с таблицами, процентами и управленческими данными.",
        logical: "Поиск закономерностей в графических матрицах.",
        personality: "Особенности привычного поведения и личностный профиль.",
        motivation: "Рабочие мотиваторы и индивидуальные приоритеты.",
        situations: "Выбор действий в управленческих ситуациях.",
      } as any
    )[m.id],
  );
  m.delivery.questionCount = m.questions.filter(
    (q: any) => q.type !== "ranking",
  ).length;
}
writeFileSync("data/new-forms.json", JSON.stringify(catalog, null, 2));
const strings = new Set<string>();
function collect(v: any) {
  if (!v || typeof v !== "object") return;
  if (typeof v.ru === "string" && typeof v.kk === "string") {
    strings.add(v.ru);
    return;
  }
  for (const x of Object.values(v)) collect(x);
}
collect(catalog);
const cachePath = "data/forms-kk.json";
let cache: Record<string, string> = {};
try {
  cache = JSON.parse(readFileSync(cachePath, "utf8"));
} catch {}
cache['Вариант ответа']='Жауап нұсқасы';
if (process.argv.includes("--translate")) {
  if (!process.env.OPENROUTER_API_KEY) {
    const db = new PrismaClient();
    const settings = await db.platformSettings.findUnique({
      where: { id: "default" },
    });
    process.env.OPENROUTER_API_KEY = openRouterKey(settings);
    if (settings?.aiModel) process.env.OPENROUTER_MODEL = settings.aiModel;
    await db.$disconnect();
  }
  if (!process.env.OPENROUTER_API_KEY)
    throw Error("OpenRouter key is not configured");
  const todo = [...strings].filter((s) => !cache[s]);
  const batches: string[][] = [];
  let part: string[] = [];
  let size = 0;
  for (const s of todo) {
    if (size + s.length > 9000 && part.length) {
      batches.push(part);
      part = [];
      size = 0;
    }
    part.push(s);
    size += s.length;
  }
  if (part.length) batches.push(part);
  console.log("Translation batches:", batches.length);
  async function run(batch: string[], i: number) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: process.env.OPENROUTER_MODEL || "openai/gpt-5.2",
              messages: [
                {
                  role: "system",
                  content:
                    'Translate Russian assessment test materials into professional natural Kazakh. Preserve every number, date, formula, negation, exception, table layout and Latin A–E option labels exactly. Do not answer the questions, explain, omit or add information. Return JSON {"translations":[...]} with exactly one Kazakh string for every input string, in the same order. This is a working translation for later specialist review.',
                },
                { role: "user", content: JSON.stringify(batch) },
              ],
              response_format: { type: "json_object" },
              max_tokens: 22000,
            }),
            signal: AbortSignal.timeout(240000),
          },
        );
        if (!response.ok) throw Error("Translation HTTP " + response.status);
        const r: any = await response.json();
        const raw = r.choices?.[0]?.message?.content;
        const parsed = JSON.parse(
          raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
        );
        const a = parsed.translations;
        if (
          !Array.isArray(a) ||
          a.length !== batch.length ||
          a.some((x: any) => typeof x !== "string" || !x.trim())
        )
          throw Error("Translation shape mismatch");
        batch.forEach((s, k) => (cache[s] = a[k]));
        writeFileSync(cachePath, JSON.stringify(cache, null, 2));
        console.log("Translated batch", i + 1, "/", batches.length);
        return;
      } catch (e) {
        console.log("Retry translation batch", i + 1, (e as Error).message);
        if (attempt === 2) throw e;
      }
    }
  }
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < batches.length) {
        const i = cursor++;
        await run(batches[i], i);
      }
    }),
  );
}
function translate(v: any) {
  if (!v || typeof v !== "object") return;
  if (typeof v.ru === "string" && typeof v.kk === "string") {
    if (cache[v.ru]) v.kk = cache[v.ru];
    return;
  }
  for (const x of Object.values(v)) translate(x);
}
translate(catalog);
if (process.argv.includes("--translate") || process.argv.includes("--final")) {
  if ([...strings].some((s) => !cache[s]))
    throw Error("Missing Kazakh translations");
  writeFileSync("data/catalog.json", JSON.stringify(catalog, null, 2));
  console.log("New six-form catalog ready");
}
