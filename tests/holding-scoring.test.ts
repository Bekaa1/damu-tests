import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calculateScore } from "../packages/core/scoring";

const forms = JSON.parse(readFileSync("data/new-forms.json", "utf8"));
const form = forms.find((f: any) => f.id === "situations");
const version = "holding-2026-11-21";
const key = { ...form.config, holdingModelVersion: version };
const correct = Object.fromEntries(form.questions.map((q: any) => [q.id, {
  most: key.items[q.id].most,
  least: key.items[q.id].least,
}]));
const calculate = (answers = correct, questions = form.questions, config = key) =>
  calculateScore("sjt", config, questions, answers, { allowMissing: true }) as any;

describe("Holding SJT source-only profile", () => {
  it("keeps +1 MOST/+1 LEAST, max28, and aggregates only the source primary competency", () => {
    const score = calculate();
    expect(score.total).toBe(28);
    expect(score.maximum).toBe(28);
    expect(score.holdingModelVersion).toBe(version);
    expect(score.holdingProfile).toHaveLength(8);
    expect(Object.fromEntries(score.holdingProfile.map((c: any) => [c.code, [c.total,c.maximum,c.caseCount]]))).toEqual({
      C1:[2,2,1], C2:[4,4,2], C3:[4,4,2], C4:[6,6,3],
      C5:[2,2,1], C6:[2,2,1], C7:[6,6,3], C8:[2,2,1],
    });
    expect(score.holdingProfile.reduce((n: number, c: any) => n+c.total,0)).toBe(score.total);
    expect(score.holdingProfile.reduce((n: number, c: any) => n+c.maximum,0)).toBe(score.maximum);
  });
  it("preserves stable answer IDs when both question and option display orders are reversed", () => {
    const shuffled = [...form.questions].reverse().map((q: any) => ({...q,options:[...q.options].reverse()}));
    expect(calculate(correct,shuffled).holdingProfile).toEqual(calculate().holdingProfile);
  });
  it("does not inflate a case by its additional indicator or turn criticality into a weight", () => {
    const first = { "situations-v2-1": correct["situations-v2-1"] };
    const score = calculate(first);
    expect(score.total).toBe(2);
    expect(score.holdingProfile.find((c: any) => c.code === "C2").total).toBe(2);
    expect(score.holdingProfile.filter((c: any) => c.code !== "C2").every((c: any) => c.total === 0)).toBe(true);
    expect(calculate(correct,form.questions,{...key,criticality:{C2:3,C4:1}}).holdingProfile).toEqual(calculate().holdingProfile);
  });
  it("marks single-case competencies as additional sources without standalone row permission", () => {
    const profile=calculate().holdingProfile;
    expect(profile.filter((c:any)=>c.showSeparate).map((c:any)=>c.code)).toEqual(["C2","C3","C4","C7"]);
    for (const c of profile.filter((c:any)=>!c.showSeparate)) {
      expect(c.note).toBe("один кейс — дополнительный источник; основная оценка — по упражнениям и интервью");
    }
  });
  it("does not attach a new model to a historical unversioned scoring key", () => {
    const historic=calculate(correct,form.questions,form.config);
    expect(historic.holdingProfile).toBeUndefined();
    expect(historic.holdingModelVersion).toBeUndefined();
  });
  it("does not silently label a different SJT form with this Holding mapping", () => {
    const wrong=form.questions.map((q:any)=>({...q,id:q.id.replace("situations-v2-","other-form-")}));
    const items=Object.fromEntries(Object.entries(key.items).map(([id,v])=>[id.replace("situations-v2-","other-form-"),v]));
    expect(()=>calculate({},wrong,{...key,items})).toThrow(/Холдинг|Holding|кейсы|соответств/i);
  });
});
