import {describe,expect,it} from 'vitest';
import {resolveProfileBinding} from '../packages/core/profile-binding';
import {HOLDING_PROFILES} from '../packages/core/holding';
describe('Participant profile import contract',()=>{
 it('binds an exact profile number to original department, position and Cyrillic target level',()=>{
  const row=HOLDING_PROFILES.find(p=>p.profileRow===1)!;
  expect(resolveProfileBinding('1')).toEqual({profileRow:1,block:row.block,unit:row.unit,position:row.position,targetLevelModel:'В'});
 });
 it('does not merge identically named deputy profiles',()=>{
  expect(resolveProfileBinding(55).profileRow).not.toBe(resolveProfileBinding(56).profileRow);
  expect(resolveProfileBinding(55).unit).toBe(resolveProfileBinding(56).unit);
  expect(resolveProfileBinding(58).profileRow).not.toBe(resolveProfileBinding(59).profileRow);
 });
 it.each(['01','1.0','1e1',0,66,1.5,undefined,null,'C1'])('rejects malformed or absent profile token %s rather than repairing it',(value)=>{
  expect(()=>resolveProfileBinding(value)).toThrow(/профил|profile/i);
 });
 it('rejects a conflicting imported label instead of silently renaming it',()=>{
  expect(()=>resolveProfileBinding(1,{unit:'Другая организация'})).toThrow(/подраздел|должност|совпад/i);
  expect(()=>resolveProfileBinding(1,{position:'Другая должность'})).toThrow(/подраздел|должност|совпад/i);
 });
});
