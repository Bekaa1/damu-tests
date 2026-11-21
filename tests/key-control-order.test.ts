import 'reflect-metadata';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {calculateScore,type QuestionInput} from '../packages/core/scoring';
const m=vi.hoisted(()=>({version:vi.fn(),create:vi.fn(),audit:vi.fn()}));
vi.mock('../apps/api/src/db',()=>({db:{testVersion:{findUniqueOrThrow:m.version},$transaction:async(fn:any)=>fn({$queryRaw:async()=>[{id:'test-version'}],scoringKey:{create:m.create},auditLog:{create:m.audit}})},json:(x:any)=>JSON.parse(JSON.stringify(x)),audit:vi.fn()}));
vi.mock('../apps/api/src/auth',()=>({auth:{api:{getSession:vi.fn()}}}));
vi.mock('../apps/api/src/access',()=>({requireRole:vi.fn(),orgId:()=> 'org',participant:vi.fn(),AccessGuard:class{}}));
vi.mock('bullmq',()=>({Queue:class{on(){}},Worker:class{on(){}}}));
import {AppController} from '../apps/api/src/controller';
const ordered=[0,1].map(position=>({id:`q${position+1}`,position,type:'single' as const,text:{ru:'Synthetic ordering question',kk:'Synthetic ordering question'},content:{},options:[{id:`q${position+1}-a`,position:0,text:{ru:'A',kk:'A'}},{id:`q${position+1}-b`,position:1,text:{ru:'B',kk:'B'}}]}));
const config={items:{q1:{correct:'q1-a'},q2:{correct:'q2-b'}}};
const answers={q1:'q1-a',q2:'q2-b'};
describe('Versioned scoring key controls use canonical stored question positions',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.version.mockImplementation(async(query:any)=>({questions:query.include.questions.orderBy?.position==='asc'?ordered:[...ordered].reverse(),keys:[{id:'old-key',algorithm:'cognitive'}]}));m.create.mockImplementation(async({data}:any)=>({id:'new-key',...data}));m.audit.mockResolvedValue({});});
 it('accepts an identical control score even when PostgreSQL physical row order has changed',async()=>{
  const expected=calculateScore('cognitive',config,ordered as QuestionInput[],answers);
  const key=await new AppController().newKey({ctx:{user:{id:'synthetic-operator'}}} as any,'test-version',{version:'synthetic-ordering-regression',config,source:'synthetic controlled ordering regression',controlExamples:[{name:'same source answer IDs',answers,expected}]});
  expect(key.id).toBe('new-key');expect(key.status).toBe('preliminary');
  expect(m.version.mock.calls[0][0].include.questions).toMatchObject({orderBy:{position:'asc'},include:{options:{orderBy:{position:'asc'}}}});
  expect(m.audit).toHaveBeenCalledOnce();
 });
});
