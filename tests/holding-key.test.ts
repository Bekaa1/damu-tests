import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {buildHoldingScoringKey, holdingKeyInstallAction, holdingKeyFingerprint} from "../packages/core/holding-key";
import {calculateScore} from "../packages/core/scoring";
const form=JSON.parse(readFileSync('data/new-forms.json','utf8')).find((x:any)=>x.id==='situations');
describe('Versioned Holding key installation',()=>{
 it('records the same config fingerprint after PostgreSQL JSONB reorders object keys',()=>{
  expect(holdingKeyFingerprint({b:{z:1,a:2},a:[{q:3,p:4}]})).toBe(holdingKeyFingerprint({a:[{p:4,q:3}],b:{a:2,z:1}}));
  expect(holdingKeyFingerprint({a:[1,2]})).not.toBe(holdingKeyFingerprint({a:[2,1]}));
 });
 it('adds literal indicator provenance without changing any original correct option ID',()=>{
  const config=buildHoldingScoringKey(form.config,form.questions);
  expect(config.holdingModelVersion).toBe('holding-2026-11-21');
  for(const q of form.questions){
   expect(config.items[q.id].most).toBe(form.config.items[q.id].most);
   expect(config.items[q.id].least).toBe(form.config.items[q.id].least);
   expect(config.items[q.id].competency).toBeUndefined();
  }
  expect(config.items['situations-v2-1']).toMatchObject({competencyCode:'C2',indicatorCode:'C2.2',additionalIndicatorCode:'C2.3'});
  const answers=Object.fromEntries(form.questions.map((q:any)=>[q.id,{most:config.items[q.id].most,least:config.items[q.id].least}]));
  expect(calculateScore('sjt',config,form.questions,answers).total).toBe(28);
 });
 it('refuses answer-key drift rather than silently changing a used answer',()=>{
  const config=structuredClone(form.config);config.items['situations-v2-1'].most='situations-v2-1-A';
  expect(()=>buildHoldingScoringKey(config,form.questions)).toThrow(/ключ|вариант|совпад/i);
 });
 it('never installs the experimental effectiveness formula as the approved 28-point form',()=>{
  expect(()=>buildHoldingScoringKey({...form.config,mode:'effectiveness'},form.questions)).toThrow(/формул|effectiveness|28/i);
 });
 it('is idempotent only for an identical immutable existing version',()=>{
  const config=buildHoldingScoringKey(form.config,form.questions);
  expect(holdingKeyInstallAction(null,config)).toBe('create');
  expect(holdingKeyInstallAction({config},structuredClone(config))).toBe('unchanged');
  expect(()=>holdingKeyInstallAction({config:{...config,holdingModelVersion:'different'}},config)).toThrow(/верси|измен|immutable/i);
 });
});
