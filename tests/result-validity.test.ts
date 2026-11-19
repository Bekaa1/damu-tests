import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { assessmentCompletion } from "../packages/core/result-validity";
import { calculateScore } from "../packages/core/scoring";
import { responseQuality } from "../packages/core/response-quality";
const forms = JSON.parse(readFileSync("data/catalog.json", "utf8"));
const config = (f: any) => f.config;
const answer = (q: any, c: any) =>
  q.type === "sjt"
    ? { most: q.options[0].id, least: q.options[1].id }
    : q.type === "ranking"
      ? {
          top: q.options.slice(0, 3).map((o: any) => o.id),
          bottom: q.options.slice(3, 6).map((o: any) => o.id),
        }
      : q.type === "scale"
        ? 3
        : c.items[q.id].correct;
describe("minimum completed responses", () => {
  for (const [id, required] of [
    ["verbal", 24],
    ["numerical", 15],
    ["logical", 20],
    ["situations", 12],
  ] as const) {
    it(`${id}: ${required} complete responses required, never zero-answer completion`, () => {
      const f = forms.find((x: any) => x.id === id),
        c = config(f);
      const values = Object.fromEntries(
        f.questions
          .slice(0, required - 1)
          .map((q: any) => [q.id, answer(q, c)]),
      );
      expect(assessmentCompletion(f.questions, {}, c, false).eligible).toBe(
        false,
      );
      expect(assessmentCompletion(f.questions, values, c, false)).toMatchObject(
        { eligible: false, required },
      );
      const q = f.questions[required - 1];
      values[q.id] = answer(q, c);
      expect(assessmentCompletion(f.questions, values, c, false)).toMatchObject(
        { eligible: true, answered: required },
      );
      if (id === "situations") {
        values[q.id] = { most: q.options[0].id, least: "" };
        expect(
          assessmentCompletion(f.questions, values, c, false).eligible,
        ).toBe(false);
      }
    });
  }
  for (const id of ["personality", "motivation"])
    it(`${id}: requires all items including controls/ranking`, () => {
      const f = forms.find((x: any) => x.id === id),
        c = config(f);
      const values = Object.fromEntries(
        f.questions.map((q: any) => [q.id, answer(q, c)]),
      );
      expect(assessmentCompletion(f.questions, values, c, true).eligible).toBe(
        true,
      );
      delete values[f.questions.at(-1).id];
      expect(assessmentCompletion(f.questions, values, c, true).eligible).toBe(
        false,
      );
      if (id === "motivation") {
        values[f.questions.at(-1).id] = { top: [], bottom: [] };
        expect(
          assessmentCompletion(f.questions, values, c, true).eligible,
        ).toBe(false);
      }
    });
  it("missing scale values produce no zero scores or artificial scale minimum", () => {
    const f = forms.find((x: any) => x.id === "personality"),
      c = config(f);
    const empty = calculateScore(
      "scales",
      c,
      f.questions,
      {},
      { allowMissing: true },
    );
    expect(empty.scales).toEqual({});
    const q = f.questions[0];
    const partial = calculateScore(
      "scales",
      c,
      f.questions,
      { [q.id]: 3 },
      { allowMissing: true },
    );
    for (const s of Object.values(partial.scales!)) {
      expect(s.mean).toBeGreaterThanOrEqual(1);
      expect(s.min).toBe(1);
    }
  });
});
describe("quality telemetry", () => {
  const f = forms.find((x: any) => x.id === "personality"),
    questions = f.questions.slice(0, 12);
  it("counts individual sub-2-second answers even with a slow average", () => {
    const answers = Object.fromEntries(
      questions.map((q: any, i: number) => [q.id, 1 + (i % 5)]),
    );
    const durations = Object.fromEntries(
      questions.map((q: any, i: number) => [q.id, i === 0 ? 1999 : 10000]),
    );
    expect(responseQuality(questions, answers, durations)).toMatchObject({
      fastAnswers: 1,
      timedAnswers: 12,
    });
  });
  it("does not bridge unanswered gaps and does not invent timing for legacy zeros", () => {
    const answers = Object.fromEntries(questions.map((q: any) => [q.id, 3]));
    expect(responseQuality(questions, answers).longestRun).toBe(12);
    delete answers[questions[6].id];
    expect(
      responseQuality(questions, answers, { [questions[0].id]: 0 }),
    ).toMatchObject({ longestRun: 6, fastAnswers: 0, timedAnswers: 0 });
  });
});
