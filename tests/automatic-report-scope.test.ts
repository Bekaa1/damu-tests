import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({tasks:vi.fn(),member:vi.fn(),create:vi.fn()}));
vi.mock('../apps/api/src/db',()=>({db:{testAssignment:{findMany:m.tasks},membership:{findFirst:m.member}},audit:vi.fn(),json:(x:any)=>x}));
vi.mock('../apps/api/src/auth',()=>({auth:{api:{getSession:vi.fn()}}}));
vi.mock('../apps/api/src/generated-reports',()=>({createGeneratedReport:m.create}));
import {queueCompletedAssessment} from '../apps/api/src/report-lifecycle';
import {requireRole} from '../apps/api/src/access';
const subject=()=>({id:'synthetic-employee',organizationId:'synthetic-org',role:'employee',status:'active',createdAt:new Date(),organization:{id:'synthetic-org',purpose:'assessment',dataMode:'synthetic'},user:{id:'synthetic-user',demoOnly:true,platformAdmin:false,locale:'ru'}});
describe('Automatic local PDF uses an explicit tenant system principal, not a forged demo employee role',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.tasks.mockResolvedValue([{attempts:[{status:'completed'}]}]);m.member.mockResolvedValue(subject());m.create.mockImplementation(async(ctx:any)=>{requireRole(ctx,'admin','expert');return{id:'synthetic-local-pdf'};});});
 it('preserves the demo role boundary while creating its own completed data PDF',async()=>{
  await expect(queueCompletedAssessment('synthetic-org','campaign','synthetic-employee')).resolves.toBeUndefined();
  expect(m.create).toHaveBeenCalledOnce();const[ctx,body,automatic]=m.create.mock.calls[0];
  expect(ctx.user.id).toBe('system-report-lifecycle');expect(ctx.user.demoOnly).toBe(false);expect(ctx.user.platformAdmin).toBe(false);expect(ctx.member).toBeNull();expect(ctx.role).toBe('admin');
  expect(ctx.org.id).toBe('synthetic-org');expect(body.membershipId).toBe('synthetic-employee');expect(automatic).toBe(true);
 });
 it.each(['blocked','expired'])('does not start a fresh personal report for a %s subject',async(kind)=>{
  const s=subject();if(kind==='blocked')s.status='blocked';else s.createdAt=new Date('2000-01-01T00:00:00Z');m.member.mockResolvedValue(s);
  await queueCompletedAssessment('synthetic-org','campaign','synthetic-employee');expect(m.create).not.toHaveBeenCalled();
 });
 it('preserves pilot no-PDF and incomplete-battery boundaries',async()=>{
  const s=subject();s.organization.purpose='pilot';m.member.mockResolvedValue(s);await queueCompletedAssessment('synthetic-org','campaign','synthetic-employee');expect(m.create).not.toHaveBeenCalled();
  m.member.mockResolvedValue(subject());m.tasks.mockResolvedValue([{attempts:[{status:'running'}]}]);await queueCompletedAssessment('synthetic-org','campaign','synthetic-employee');expect(m.create).not.toHaveBeenCalled();
 });
});
