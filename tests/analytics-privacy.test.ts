import { describe, expect, it } from "vitest";
import { privateAnalytics } from "../packages/core/analytics-privacy";
const person = (id: string, unit="Большая группа", language="ru") => ({
  id, role:"employee", unit, position:"Руководитель", status:"completed",
  results:[{testVersionId:"verbal-v2",scoringKeyId:"key-1",language,name:{ru:"Вербальный анализ",kk:"Вербалды талдау"},score:{total:12,maximum:30}}],
});

describe("Analytical group confidentiality",()=>{
 it("withholds labels and scores for four people",()=>{
  const output=privateAnalytics(Array.from({length:4},(_,i)=>person(String(i))),"unit");
  expect(output.groups).toEqual([]); expect(output.methods).toEqual([]); expect(output.suppressed).toBe(true);
 });
 it("withholds the five-person complement of a hidden four beside method N=9",()=>{
  const people=[...Array.from({length:5},(_,i)=>person('a'+i)),...Array.from({length:4},(_,i)=>person('b'+i,"Секретная малая группа"))];
  const output=privateAnalytics(people,"unit");
  expect(output.groups).toEqual([]);
  expect(JSON.stringify(output)).not.toContain("Секретная малая группа");
  expect(output.methods[0].n).toBe(9);
  expect(output.complementarySuppressed).toBe(true);
 });
 it("suppresses method/key/language strata below five even in a larger overall group",()=>{
  const people=[...Array.from({length:5},(_,i)=>person('a'+i)),...Array.from({length:4},(_,i)=>person('b'+i,"Большая группа","kk"))];
  const output=privateAnalytics(people,"unit");
  expect(output.methods).toHaveLength(1);expect(output.methods[0].n).toBe(5);expect(output.methods[0].id).toBe("verbal-v2:key-1:ru");
  // N=9 must not remain available in either selectable grouping beside N=5.
  expect(output.groups).toEqual([]);
  expect(privateAnalytics(people,"position").groups).toEqual([]);
 });
 it("does not count duplicate rows or multiple results as additional participants",()=>{
  const a=person("a"); a.results.push({...a.results[0]});
  const output=privateAnalytics([a,a,person("b"),person("c"),person("d")],"unit");
  expect(output.groups).toEqual([]);expect(output.methods).toEqual([]);
 });
 it("does not count staff or excluded results toward a score disclosure threshold",()=>{
  const people=Array.from({length:5},(_,i)=>person(String(i)));
  (people[0].results[0].score as any).validity={eligible:false};
  const output=privateAnalytics([...people,{...person("admin"),role:"admin"}],"position");
  expect(output.groups[0].count).toBe(5);expect(output.methods).toEqual([]);
 });
 it("prevents the real 6/5/1 unit-position toggle from revealing the singleton's completion",()=>{
  const people=Array.from({length:6},(_,i)=>({...person(String(i),"Allsix"),position:i<5?"Visiblefive":"hiddenone",status:i<5?"completed":"in_progress"}));
  const before=JSON.stringify(people), unit=privateAnalytics(people,"unit"), position=privateAnalytics(people,"position");
  expect(unit.groups).toEqual([{label:"Allsix",count:6,completed:5,percent:83}]);
  expect(position.groups).toEqual([]);
  expect(unit.methods[0].n).toBe(6);
  expect(position.methods).toEqual(unit.methods);
  expect(unit.complementarySuppressed).toBe(true);
  expect(position.complementarySuppressed).toBe(true);
  expect(JSON.stringify([unit,position])).not.toMatch(/Visiblefive|hiddenone/);
  expect(JSON.stringify(people)).toBe(before);
 });
 it("coordinates category with the unit/position family without adding a UI mode",()=>{
  const people=Array.from({length:6},(_,i)=>({...person(String(i)),category:i<5?"Visiblecategory":"hiddencategory"}));
  const output=privateAnalytics(people,"category");
  expect(output.groups).toEqual([]);
  expect(output.methods[0].n).toBe(6);
  expect(privateAnalytics(people,"unit").complementarySuppressed).toBe(true);
 });
 it("withholds overlapping unit/position partitions even when every marginal has six",()=>{
  const people=Array.from({length:12},(_,i)=>({...person(String(i),i<6?"Unit A":"Unit B"),position:i<5||i===6?"Position A":"Position B"}));
  for (const grouping of ["unit","position"] as const) {
   const output=privateAnalytics(people,grouping);
   expect(output.groups).toEqual([]);
   expect(output.methods[0].n).toBe(12);
   expect(output.complementarySuppressed).toBe(true);
  }
 });
 it("withholds overlapping method cohorts of six and five while retaining the true overall method",()=>{
  const people=Array.from({length:6},(_,i)=>person(String(i)));
  for(const p of people.slice(0,5)) p.results.push({...p.results[0],testVersionId:"subset-v2"});
  const output=privateAnalytics(people,"unit");
  expect(output.methods.map(m=>[m.id,m.n])).toEqual([["verbal-v2:key-1:ru",6]]);
  expect(output.groups[0].count).toBe(6);
  expect(output.complementarySuppressed).toBe(true);
 });
 it("withholds overlapping scale cohorts without changing method N or complete scale values",()=>{
  const people=Array.from({length:6},(_,i)=>({...person(String(i)),results:[{
   testVersionId:"personality-v2",scoringKeyId:"key-1",language:"ru",name:"Personality",
   score:{scales:{complete:{name:"Complete",mean:3,min:1,max:5},...(i<5?{partial:{name:"Partial",mean:4,min:1,max:5}}:{})}},
  }]}));
  const output=privateAnalytics(people,"unit");
  expect(output.methods[0].n).toBe(6);
  expect(output.methods[0].score).toEqual({scales:{complete:{name:"Complete",mean:3,min:1,max:5,count:6}}});
  expect(output.complementarySuppressed).toBe(true);
 });
 it("keeps aligned safe five/six cohorts, true values, and distinct version/key/language strata",()=>{
  const people=[...Array.from({length:5},(_,i)=>({...person('a'+i,"Unit five"),position:"Position five"})),
   ...Array.from({length:6},(_,i)=>({...person('b'+i,"Unit six","kk"),position:"Position six"}))];
  for(const p of people.slice(5)) p.results[0]={...p.results[0],testVersionId:"verbal-v3",scoringKeyId:"key-2"};
  const output=privateAnalytics([...people,people[0],{...person("staff","Other"),role:"admin"}],"unit");
  expect(output.groups).toEqual([{label:"Unit five",count:5,completed:5,percent:100},{label:"Unit six",count:6,completed:6,percent:100}]);
  expect(output.methods.map(m=>[m.id,m.n,m.score])).toEqual([
   ["verbal-v2:key-1:ru",5,{total:12,maximum:30}],
   ["verbal-v3:key-2:kk",6,{total:12,maximum:30}],
  ]);
  expect(output.suppressed).toBe(false);
  expect(privateAnalytics(people,"position").groups.map(g=>g.count)).toEqual([5,6]);
 });
 it("keeps a safe disclosed five without publishing its four-person residual denominator",()=>{
  const people=[...Array.from({length:5},(_,i)=>person('a'+i,"Visible five")),
   ...Array.from({length:4},(_,i)=>({...person('b'+i,"Hidden four"),results:[]}))];
  expect(privateAnalytics(people,"unit").groups).toEqual([{label:"Visible five",count:5,completed:5,percent:100}]);
  expect(privateAnalytics(people,"unit").methods[0].n).toBe(5);
  expect(privateAnalytics(people,"position").groups).toEqual([]);
 });
 it("does not let excluded/review-required results join a comparable cohort",()=>{
  for(const flag of [{excluded:true},{reviewRequired:true}]) {
   const people=Array.from({length:5},(_,i)=>person(String(i)));
   Object.assign(people[0].results[0].score,flag);
   expect(privateAnalytics(people,"unit").methods).toEqual([]);
  }
 });
 it.each([5,6])("keeps a safe whole cohort of %i without identifiers",(count)=>{
  const output=privateAnalytics(Array.from({length:count},(_,i)=>person('sensitive-'+i)),"unit");
  expect(output.groups[0]).toMatchObject({count,completed:count,percent:100});
  expect(output.methods[0].n).toBe(count);
  expect(output.suppressed).toBe(false);
  expect(JSON.stringify(output)).not.toContain("sensitive-");
 });
 it("returns a numeric aggregate without a participant registry",()=>{
  const output=privateAnalytics(Array.from({length:5},(_,i)=>person('participant-sensitive-'+i)),"unit");
  expect(output.methods[0].score).toEqual({total:12,maximum:30});
  expect(JSON.stringify(output)).not.toContain("participant-sensitive");
 });
});
