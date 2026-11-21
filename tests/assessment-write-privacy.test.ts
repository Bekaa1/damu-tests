import {beforeEach,describe,expect,it,vi} from 'vitest';
import {DEFAULT_COMPETENCIES} from '../packages/core/competencies';
const m=vi.hoisted(()=>({fence:vi.fn(),transaction:vi.fn(),tasks:vi.fn(),observations:vi.fn(),exercise:vi.fn(),model:vi.fn(),consensus:vi.fn(),members:vi.fn(),ai:vi.fn()}));
vi.mock('../apps/api/src/participant-write',()=>({withParticipantWriteFence:m.fence}));
vi.mock('../apps/api/src/db',()=>({db:{$transaction:m.transaction,testAssignment:{findMany:m.tasks},expertObservation:{findMany:m.observations},assessmentExercise:{findFirst:m.exercise},competencyModel:{findFirst:m.model},competencyConsensus:{findFirst:m.consensus},membership:{findMany:m.members},aiReport:{findFirst:m.ai}},audit:vi.fn(),json:(x:any)=>x}));
vi.mock('../apps/api/src/access',()=>({requireRole:vi.fn(),orgId:()=> 'org',participant:vi.fn(async()=>({id:'member',profileRow:65,role:'employee',status:'active'}))}));
import {saveObservation,saveReport} from '../apps/api/src/assessment';
import {saveConsensus} from '../apps/api/src/competencies';
const ctx={org:{id:'org'},user:{id:'expert'},member:{id:'expert'},role:'expert'} as any;
describe('All expert participant writers recheck retention under the shared erasure fence',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.fence.mockRejectedValue(Error('retention fence rejected'));m.transaction.mockImplementation(()=>{throw Error('unsafe unfenced participant write reached');});m.tasks.mockResolvedValue([{testVersion:{testId:'verbal',test:{direction:'verbal',name:{ru:'Synthetic'}}},attempts:[{status:'completed',results:[]}]}]);m.observations.mockResolvedValue([]);m.exercise.mockResolvedValue({id:'exercise',type:'interview',name:{ru:'Synthetic'},criteria:[{id:'C2.1',allowNotObserved:true,competencyId:'C2',scale:[{value:3}]}]});m.model.mockResolvedValue({id:'model',content:DEFAULT_COMPETENCIES});m.consensus.mockResolvedValue(null);m.members.mockResolvedValue([]);m.ai.mockResolvedValue(null);});
 it('fences an observation after initial authorization rather than trusting its stale eligibility',async()=>{
  await expect(saveObservation(ctx,{campaignId:'campaign',membershipId:'member',exerciseId:'exercise',scores:{'C2.1':null},indicatorExamples:{},notes:'Synthetic persistence regression only.'})).rejects.toThrow('retention fence rejected');
  expect(m.fence).toHaveBeenCalledWith('org',['member'],expect.any(Function));expect(m.transaction).not.toHaveBeenCalled();
 });
 it('fences a final expert conclusion before appending participant references',async()=>{
  await expect(saveReport(ctx,{campaignId:'campaign',membershipId:'member',content:{conclusion:'Synthetic persistence regression only.',strengths:'',development:'',risks:'',recommendations:'',developmentPlan:[]},matrixX:1,matrixY:1,matrixReason:'Synthetic persistence regression only.',approve:false})).rejects.toThrow('retention fence rejected');
  expect(m.fence).toHaveBeenCalledWith('org',['member'],expect.any(Function));expect(m.transaction).not.toHaveBeenCalled();
 });
 it('fences versioned consensus after gathering source evidence',async()=>{
  await expect(saveConsensus(ctx,'member',{campaignId:'campaign',modelId:'model',roleId:DEFAULT_COMPETENCIES.roles.find(r=>r.profileRow===65)!.id,ratings:DEFAULT_COMPETENCIES.competencies.map(c=>({competencyId:c.id,value:null,notObserved:true,evidenceIds:[],reason:'Synthetic persistence regression only.'}))})).rejects.toThrow('retention fence rejected');
  expect(m.fence).toHaveBeenCalledWith('org',['member'],expect.any(Function));expect(m.transaction).not.toHaveBeenCalled();
 });
});
