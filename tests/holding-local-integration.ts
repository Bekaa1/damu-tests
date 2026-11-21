import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {assertLocalHoldingEnvironment,DEMO_ORGANIZATION_ID,DEMO_CAMPAIGN_ID} from '../packages/core/demo-policy';
import {HOLDING_MODEL_VERSION,HOLDING_PROFILES,HOLDING_COMPETENCIES} from '../packages/core/holding';
import {DEFAULT_COMPETENCIES,exerciseCriteria} from '../packages/core/competencies';
assert.equal(process.env.RUN_HOLDING_LOCAL_INTEGRATION,'1','Explicit synthetic local opt-in required');
assertLocalHoldingEnvironment(process.env);
assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/assessflow_holding_20261121');
const base=process.env.BASE_URL||'http://localhost:3301';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const directory='/root/research/damu-tests/implementation/model-local-acceptance';
const credentialFile='/root/research/damu-tests/implementation/demo/.local-credentials.json';
assert.equal((await stat(credentialFile)).mode&0o777,0o600);
const credentials=JSON.parse(await readFile(credentialFile,'utf8'));
const db=new PrismaClient();let cookie='';
async function request(path:string,data?:unknown,expected=200):Promise<any>{
 const response=await fetch(base+'/api'+path,{method:data===undefined?'GET':'POST',headers:{cookie,origin:base,'content-type':'application/json','x-organization-id':DEMO_ORGANIZATION_ID},body:data===undefined?undefined:JSON.stringify(data)});
 assert.equal(response.status,expected,`${path}: expected${expected}, got${response.status}`);
 return response.json();
}
try{
 const login=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(credentials.expert)});
 assert.equal(login.status,200,'Synthetic expert sign-in');
 cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert(cookie);
 const model=await request('/competency-model');
 assert.equal(model.content.holdingModelVersion,HOLDING_MODEL_VERSION);
 assert.equal(model.content.competencies.length,8);assert.equal(model.content.roles.length,65);
 assert.deepEqual(model.content.competencies.map((c:any)=>c.name.ru),HOLDING_COMPETENCIES.map(c=>c.name.ru));
 const members=await db.membership.findMany({where:{organizationId:DEMO_ORGANIZATION_ID,role:'employee'},orderBy:{profileRow:'asc'}});
 assert.equal(members.length,65);
 for(const member of members){const p=HOLDING_PROFILES.find(p=>p.profileRow===member.profileRow)!;assert(p);assert.equal(member.unit,p.unit);assert.equal(member.position,p.position);assert.equal(member.block,p.block);assert.equal(member.targetLevelModel,'В');}
 for(const pair of [[55,56],[58,59]])assert.notEqual(members.find(m=>m.profileRow===pair[0])!.id,members.find(m=>m.profileRow===pair[1])!.id);
 const sjt=await request('/sjt-expert-key');assert.equal(sjt.questions.length,14);assert.equal(sjt.cases.length,14);assert.equal(sjt.status,'unapproved');assert.equal(sjt.keyPanelLabel,'Ключ не утверждён экспертной панелью');
 await request('/sjt-expert-key',{version:0,approve:true,ratings:{}},400);
 const member=members.find(m=>m.profileRow===65)!;
 // Explicit synthetic setup only; never pretend a fixture is an observed interview.
 const exercise=await db.assessmentExercise.upsert({where:{id:'holding-local-acceptance-interview'},update:{},create:{id:'holding-local-acceptance-interview',organizationId:DEMO_ORGANIZATION_ID,type:'interview',name:{ru:'Синтетическое интервью — техническая проверка'},criteria:JSON.parse(JSON.stringify(exerciseCriteria(DEFAULT_COMPETENCIES,'interview')))}});
 assert.deepEqual(exercise.criteria,JSON.parse(JSON.stringify(exerciseCriteria(DEFAULT_COMPETENCIES,'interview'))));
 const exercises=await request('/exercises');const interview=exercises.find((e:any)=>e.id===exercise.id);assert(interview);
 const criterionScores=Object.fromEntries(interview.criteria.map((c:any)=>[c.id,c.competencyId==='C2'?3:null]));
 const indicatorExamples=Object.fromEntries(interview.criteria.filter((c:any)=>c.competencyId==='C2').map((c:any)=>[c.id,'СИНТЕТИЧЕСКАЯ ТЕХНИЧЕСКАЯ ПРОВЕРКА: значение3, не описание реального поведения.']));
 const observation=await request('/observations',{campaignId:DEMO_CAMPAIGN_ID,membershipId:member.id,exerciseId:interview.id,scores:criterionScores,indicatorExamples,notes:'СИНТЕТИЧЕСКАЯ ТЕХНИЧЕСКАЯ ПРОВЕРКА полей хранения. Наблюдения реального человека не проводились.'},201);
 const evidence=await request(`/participants/${member.id}/competencies?campaignId=${DEMO_CAMPAIGN_ID}`);
 assert.equal(evidence.model.id,model.id);assert(evidence.cards.find((c:any)=>c.id==='C2').sourceIds.includes(observation.id));
 const ratings=HOLDING_COMPETENCIES.map(c=>({competencyId:c.id,value:c.id==='C2'?1:null,notObserved:c.id!=='C2',evidenceIds:c.id==='C2'?[observation.id]:[],reason:'СИНТЕТИЧЕСКАЯ ПРОВЕРКА сохранения независимых полей; не заключение о реальном человеке.'}));
 const body={campaignId:DEMO_CAMPAIGN_ID,modelId:model.id,roleId:model.content.roles.find((r:any)=>r.profileRow===65).id,ratings};
 const first=await request(`/participants/${member.id}/consensus`,body,201);
 const second=await request(`/participants/${member.id}/consensus`,body,201);assert.equal(second.version,first.version+1);
 const saved=await db.competencyConsensus.findUniqueOrThrow({where:{id:first.id}});assert.deepEqual(saved.scores,first.scores);
 const snapshot=saved.scores as any;assert.equal(snapshot.profileRow,65);assert.equal(snapshot.targetLevelModel,'В');
 for(const row of snapshot.ratings){assert.equal(row.targetScore,null);assert.equal(row.criticality,HOLDING_PROFILES.find(p=>p.profileRow===65)!.criticality[row.competencyCode]);if(row.competencyCode==='C2'){assert.equal(row.score,1);assert.equal(row.notObserved,false);assert.equal(row.assessorScores[0].scores[0].score,3);}else{assert.equal(row.score,null);assert.equal(row.notObserved,true);assert.equal(row.methodCount,0);}}
 const count=await db.competencyConsensus.count({where:{organizationId:DEMO_ORGANIZATION_ID,membershipId:member.id}});
 await request(`/participants/${member.id}/consensus`,{...body,ratings:ratings.map(r=>r.competencyId==='C2'?{...r,notObserved:true}:r)},400);
 assert.equal(await db.competencyConsensus.count({where:{organizationId:DEMO_ORGANIZATION_ID,membershipId:member.id}}),count);
 const readback=await request(`/participants/${member.id}/competencies?campaignId=${DEMO_CAMPAIGN_ID}`);assert.equal(readback.consensus.id,second.id);
 const result={status:'pass',at:new Date().toISOString(),target:base,syntheticOnly:true,competencies:8,indicators:24,profiles:65,criticalityCells:520,sjtCases:14,modelId:model.id,observationId:observation.id,consensusIds:[first.id,second.id],checks:['65 exact numbered profile labels persisted','Almaty/Astana deputy IDs distinct','actual14-case read-only unapproved API','weighted legacy approval rejected','nullable numeric target separate fromcriticality','explicit notObserved separate fromscore1','assessor3 not overwritten byconsensus1','append-only consensus versions','contradictory observedstatus+score rejected','HTTPPOST plus exactPostgreSQL and HTTPGET readback']};
 await mkdir(directory,{recursive:true});await writeFile(directory+'/evidence.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
 if(cookie)await fetch(base+'/api/auth/sign-out',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:'{}'}).catch(()=>{});
 await db.$disconnect();
}
