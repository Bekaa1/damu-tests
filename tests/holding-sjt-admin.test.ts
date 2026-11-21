import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({model:vi.fn(),key:vi.fn(),transaction:vi.fn()}));
vi.mock('../apps/api/src/db',()=>({db:{competencyModel:{findFirst:m.model},sjtExpertKey:{findFirst:m.key},$transaction:m.transaction},json:(x:any)=>x,audit:vi.fn()}));
vi.mock('../apps/api/src/access',()=>({orgId:()=> 'org',requireRole:vi.fn()}));
import {getSjtExpertKey,saveSjtExpertKey} from '../apps/api/src/sjt-expert';
import {readFileSync} from 'node:fs';
describe('Holding admin key is a 14-case unapproved source, not the archived weighted16 form',()=>{
 it('renders the actual Holding admin screen without the obsolete weighted approval controls',async()=>{
  const ts=await import('typescript'),{runInNewContext}=await import('node:vm'),{createRequire}=await import('node:module');
  const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
  const holding=await import('../packages/core/holding');
  const require=createRequire(import.meta.url),module:any={};
  const source={data:{holdingModelVersion:'holding-2026-11-21',questions:JSON.parse(readFileSync('data/new-forms.json','utf8')).find((f:any)=>f.id==='situations').questions,cases:holding.HOLDING_SJT_CASES,ratings:{},status:'unapproved',version:0},loading:false,error:null};
  const component=({children,title}:any)=>React.createElement('div',null,title,children);
  const ui={useApp:()=>({t:(ru:string)=>ru,loc:(v:any)=>v?.ru||v,notify:vi.fn()}),useData:()=>source,Panel:component,LoadState:component,Field:component,Button:({children}:any)=>React.createElement('button',null,children),Modal:component};
  const code=ts.transpileModule(readFileSync('apps/web/components/expert-setup.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(code,{exports:module,require:(id:string)=>id==='./ui'?ui:id.endsWith('/holding')?holding:require(id)});
  const html=renderToStaticMarkup(React.createElement(module.SjtExpertSetup));
  expect(html).toContain('Ключ не утверждён экспертной панелью');
  expect((html.match(/data-holding-case=/g)||[])).toHaveLength(14);
  expect(html).not.toContain('Утвердить экспертный ключ');expect(html).not.toContain('Оценка одного специалиста');
  expect(html).not.toContain('<select');
 });
 beforeEach(()=>{vi.clearAllMocks();m.model.mockResolvedValue({content:{holdingModelVersion:'holding-2026-11-21'}});m.key.mockResolvedValue(null);m.transaction.mockImplementation(()=>{throw Error('unsafe archived weight write reached');});});
 it('returns fourteen literal mappings and the exact unapproved-panel label',async()=>{
  const key=await getSjtExpertKey({} as any) as any;
  expect(key.holdingModelVersion).toBe('holding-2026-11-21');expect(key.questions).toHaveLength(14);
  expect(key.keyPanelLabel).toBe('Ключ не утверждён экспертной панелью');expect(key.status).toBe('unapproved');
  expect(key.cases.find((c:any)=>c.caseNumber===1)).toMatchObject({competencyCode:'C2',indicatorCode:'C2.2',additionalIndicatorCode:'C2.3'});
 });
 it('does not allow the archived single-expert weighted editor to approve or replace the Holding key',async()=>{
  await expect(saveSjtExpertKey({user:{id:'synthetic-expert',name:'Тестовый эксперт'}} as any,{version:0,approve:false,ratings:{}})).rejects.toThrow(/Холдинга|панел|28/i);
  expect(m.transaction).not.toHaveBeenCalled();
 });
});
