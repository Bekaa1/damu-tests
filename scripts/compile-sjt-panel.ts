import { readFileSync, writeFileSync } from "node:fs";
import { compileEffectivenessKey } from "../packages/core/sjt-calibration";
import { calculateScore } from "../packages/core/scoring";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw Error(
    "Usage: npx tsx scripts/compile-sjt-panel.ts <panel.json> <import.json>",
  );
const draft = JSON.parse(readFileSync("data/review/sjt-16-draft.json", "utf8"));
const config = compileEffectivenessKey(
  draft.questions,
  JSON.parse(readFileSync(input, "utf8")),
);
const controls = [
  ["Идеальные разности", "ideal"],
  ["Обратный выбор", "reverse"],
  ["Промежуточный выбор", "middle"],
].map(([name, mode]) => {
  const answers = Object.fromEntries(
    draft.questions.map((q: any) => {
      const ranked = q.options
        .map((o: any) => ({
          id: o.id,
          value: config.items[q.id].effectiveness![o.id],
        }))
        .sort(
          (a: any, b: any) => b.value - a.value || a.id.localeCompare(b.id),
        );
      return [
        q.id,
        mode === "ideal"
          ? { most: ranked[0].id, least: ranked.at(-1)!.id }
          : mode === "reverse"
            ? { most: ranked.at(-1)!.id, least: ranked[0].id }
            : { most: ranked[1].id, least: ranked.at(-2)!.id },
      ];
    }),
  );
  return {
    name,
    answers,
    expected: calculateScore("sjt", config, draft.questions, answers),
  };
});
const payload = {
  testId: draft.id,
  version: "3.0-20261117",
  name: draft.name,
  description: draft.description,
  direction: draft.direction,
  source: draft.source,
  licenseStatus: draft.licenseStatus,
  scientificBasis: draft.scientificBasis,
  durationMinutes: draft.durationMinutes,
  timeLimitSeconds: draft.timeLimitSeconds,
  delivery: draft.delivery,
  instructions: draft.instructions,
  limitations: draft.limitations,
  questions: draft.questions,
  algorithm: "sjt",
  config,
  controlExamples: controls,
};
writeFileSync(output, JSON.stringify(payload, null, 2) + "\n");
console.log(
  "Prepared calibrated import. Review translations and pilot results before publication.",
);
