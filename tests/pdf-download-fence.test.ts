import {beforeEach,describe,expect,it,vi} from 'vitest';
import {REPORT_POLICY_VERSION} from '../packages/core/report-policy';
const m=vi.hoisted(()=>({access:vi.fn(),initial:vi.fn(),sourceCount:vi.fn(),artifact:vi.fn(),txAudit:vi.fn(),globalArtifact:vi.fn(),globalAudit:vi.fn(),persist:vi.fn(),current:null as any}));
vi.mock('../apps/api/src/db',()=>({db:{testResult:{count:m.sourceCount},reportArtifact:{findUnique:m.globalArtifact,findUniqueOrThrow:m.globalArtifact}},audit:m.globalAudit}));
vi.mock('../apps/api/src/access',()=>({orgId:()=> 'org',requireRole:vi.fn(),participant:vi.fn()}));
vi.mock('../apps/api/src/people',()=>({createPerson:vi.fn(),listPeople:vi.fn()}));
vi.mock('../apps/api/src/assessment',()=>({getReport:vi.fn()}));
vi.mock('../apps/api/src/generated-reports',()=>({getGeneratedReport:m.initial,withGeneratedReportAccess:m.access}));
vi.mock('../apps/api/src/report-lifecycle',()=>({persistReportPdf:m.persist}));
vi.mock('../packages/core/reporting',async original=>({...await original<any>(),generatedContentSchema:{parse:(x:any)=>x}}));
import {exportGeneratedPdf} from '../apps/api/src/exports';
const ctx={org:{id:'org'},user:{id:'synthetic-expert'}} as any;
const tx={testResult:{count:m.sourceCount},reportArtifact:{findUnique:m.artifact},auditLog:{create:m.txAudit}};
describe('PDF final byte read and export receipt share fresh report subject authorization',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.current={id:'report',organizationId:'org',status:'completed',policyVersion:REPORT_POLICY_VERSION,content:{synthetic:true},snapshot:{people:[{id:'subject',results:[{resultId:'result',score:{total:1}}]}]}};m.initial.mockImplementation(async()=>m.current);m.access.mockImplementation(async(_ctx:any,_id:any,callback:any)=>callback(tx,m.current));m.sourceCount.mockResolvedValue(0);m.artifact.mockResolvedValue({bytes:Buffer.from('%PDF-synthetic')});m.txAudit.mockResolvedValue({});m.globalArtifact.mockImplementation(()=>{throw Error('unsafe unfenced artifact read');});m.persist.mockResolvedValue(undefined);});
 it('reads bytes and writes its audit only through the supplied final transaction',async()=>{
  expect((await exportGeneratedPdf(ctx,'report')).toString()).toBe('%PDF-synthetic');expect(m.access).toHaveBeenCalledWith(ctx,'report',expect.any(Function));expect(m.txAudit).toHaveBeenCalledWith({data:{organizationId:'org',actorId:'synthetic-expert',action:'generated_report.pdf_exported',entityId:'report'}});expect(m.globalArtifact).not.toHaveBeenCalled();expect(m.globalAudit).not.toHaveBeenCalled();
 });
 it('checks current policy, readiness and invalid sources inside that same boundary',async()=>{
  m.sourceCount.mockResolvedValue(1);await expect(exportGeneratedPdf(ctx,'report')).rejects.toThrow(/недостаточн/);expect(m.access).toHaveBeenCalledOnce();expect(m.artifact).not.toHaveBeenCalled();expect(m.txAudit).not.toHaveBeenCalled();
 });
 it('renders outside the boundary and denies a subject that expires before the final reacquisition',async()=>{
  m.artifact.mockResolvedValue(null);m.access.mockImplementationOnce(async(_ctx:any,_id:any,callback:any)=>callback(tx,m.current)).mockRejectedValueOnce(Error('expired while rendering'));
  await expect(exportGeneratedPdf(ctx,'report')).rejects.toThrow('expired while rendering');expect(m.persist).toHaveBeenCalledOnce();expect(m.access).toHaveBeenCalledTimes(2);expect(m.txAudit).not.toHaveBeenCalled();expect(m.globalArtifact).not.toHaveBeenCalled();
 });
});
