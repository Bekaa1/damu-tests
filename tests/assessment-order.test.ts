import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({findMany:vi.fn(),unexpected:()=>{throw Error('Unexpected database write/provider access');}}));
vi.mock('../apps/api/src/db',()=>({db:{testAssignment:{findMany:f.findMany}},audit:f.unexpected,json:(v:unknown)=>v}));
vi.mock('../apps/api/src/report-lifecycle',()=>({queueCompletedAssessment:f.unexpected}));
vi.mock('../apps/api/src/participant-write',()=>({withParticipantWriteFence:f.unexpected}));
vi.mock('../apps/api/src/access',()=>({orgId:(ctx:any)=>ctx.org.id,requireRole:f.unexpected,participant:f.unexpected}));
import {myAssignments} from '../apps/api/src/attempts';
const canonical=['verbal','numerical','logical','personality','motivation','situations'];
const ctx:any={org:{id:'order-fixture-org'},member:{id:'order-fixture-member'},user:{id:'order-fixture-user'},role:'employee'};
const row=(id:string,n=0)=>({id:`assignment-${id}-${n}`,organizationId:ctx.org.id,membershipId:ctx.member.id,campaignId:'campaign',createdAt:new Date('2026-11-22T10:00:00Z'),testVersion:{testId:id,id:`${id}-v${n}`,timeLimitSeconds:1200},attempts:[] as any[]});
beforeEach(()=>vi.clearAllMocks());
describe('employee canonical assessment order through actual assignment handler',()=>{
 it('returns the TZ order despite assignment creation order',async()=>{
  const rows=['logical','motivation','numerical','personality','situations','verbal'].map(id=>row(id));f.findMany.mockResolvedValue(rows);
  const result=await myAssignments(ctx,'campaign');expect(result.map(r=>r.testVersion.testId)).toEqual(canonical);expect(f.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:ctx.org.id,membershipId:ctx.member.id,campaignId:'campaign'}}));
 });
 it('keeps additional methods after canonical forms in their original relative order',async()=>{
  f.findMany.mockResolvedValue([row('extra-b'),row('situations'),row('verbal'),row('extra-a'),row('logical')]);
  expect((await myAssignments(ctx)).map(r=>r.testVersion.testId)).toEqual(['verbal','logical','situations','extra-b','extra-a']);
 });
 it('does not collapse two assignments or versions of the same method',async()=>{
  f.findMany.mockResolvedValue([row('situations'),row('verbal',2),row('verbal',1),row('logical')]);
  expect((await myAssignments(ctx)).map(r=>r.id)).toEqual(['assignment-verbal-2','assignment-verbal-1','assignment-logical-0','assignment-situations-0']);
 });
 it('preserves source objects, creation timestamps and completed attempt data',async()=>{
  const rows=['situations','verbal'].map(id=>row(id));rows[0].attempts=[{id:'done-attempt',attemptNumber:1,status:'completed',scoringKeyId:'saved-key',_count:{answers:14}}];const before=JSON.stringify(rows);Object.freeze(rows);f.findMany.mockResolvedValue(rows);
  const result=await myAssignments(ctx,'campaign');expect(JSON.stringify(rows)).toBe(before);expect(result.find(r=>r.id===rows[0].id)?.attempts).toBe(rows[0].attempts);expect(result.every(r=>r.serverTime instanceof Date)).toBe(true);
 });
 it('returns no rows for an unassigned employee',async()=>{f.findMany.mockResolvedValue([]);expect(await myAssignments(ctx)).toEqual([]);});
});
