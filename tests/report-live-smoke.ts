import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {hashPassword} from 'better-auth/crypto';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {calculateScore} from '../packages/core/scoring';
const db=new PrismaClient(),base='http://localhost:3000',fixture='qa-report-'+Date.now();
if(!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname))throw Error('Local smoke test only');
let cookie='',reportId='';
async function request(path:string,body?:any){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});const cookies=r.headers.getSetCookie();if(cookies.length)cookie=cookies.map(x=>x.split(';')[0]).join('; ');if(!r.ok)throw Error(path+': '+r.status+' '+(await r.text()).slice(0,300));return r}
try{
 const template=await db.membership.findFirstOrThrow({where:{user:{email:'employee@assessflow.local'}},include:{organization:true}});
 await db.user.create({data:{id:fixture,name:'Тестовая проверка отчёта',email:fixture+'@assessflow.local',emailVerified:true,mustChangePassword:false,accounts:{create:{providerId:'credential',accountId:fixture,password:await hashPassword('QA-report!2026')}},memberships:{create:{id:fixture,organizationId:template.organizationId,role:'employee',consentAt:new Date()}}}});
 await db.campaign.create({data:{id:fixture,organizationId:template.organizationId,name:'Техническая проверка отчёта',endsAt:new Date(Date.now()+86400000)}});
 const catalog=JSON.parse(readFileSync('data/catalog.json','utf8'));
 for(const m of catalog){const answers=Object.fromEntries(m.questions.map((q:any)=>{const k=m.config.items[q.id];return [q.id,k.correct??(q.type==='sjt'?{most:k.most,least:k.least}:q.type==='ranking'?{top:q.options.slice(0,3).map((o:any)=>o.id),bottom:q.options.slice(3,6).map((o:any)=>o.id)}:k.control==='К1'?2:k.control==='К2'?4:3)]}));
  const score=calculateScore(m.algorithm,m.config,m.questions,answers);
  const a=await db.testAssignment.create({data:{organizationId:template.organizationId,campaignId:fixture,membershipId:fixture,testVersionId:m.id+'-v2'}});
  const attempt=await db.testAttempt.create({data:{organizationId:template.organizationId,assignmentId:a.id,language:'ru',status:'completed',scoringKeyId:m.id+'-key-v2',timerStartedAt:new Date(),submittedAt:new Date()}});
  await db.userAnswer.createMany({data:Object.entries(answers).map(([questionId,value])=>({organizationId:template.organizationId,attemptId:attempt.id,questionId,value:value as any,durationMs:5000}))});
  await db.testResult.create({data:{organizationId:template.organizationId,attemptId:attempt.id,scoringKeyId:m.id+'-key-v2',result:JSON.parse(JSON.stringify(score))}});
 }
 await request('/auth/sign-in/email',{email:'admin@assessflow.local',password:process.env.SEED_PASSWORD||'AssessFlow!2026'});
 const created=await (await request('/generated-reports',{campaignId:fixture,membershipId:fixture,kind:'individual',language:'ru'})).json();reportId=created.id;
 console.log('Requested real OpenRouter report',reportId);
 const until=Date.now()+450000;let previous='';
 while(Date.now()<until){const r=await db.generatedReport.findUniqueOrThrow({where:{id:reportId}});if(previous!==r.status){console.log('Report status:',r.status,r.error||'');previous=r.status}if(r.status==='failed')throw Error(r.error||'Report failed');if(r.status==='completed'){const pdf=await request('/generated-reports/'+reportId+'/pdf');const bytes=Buffer.from(await pdf.arrayBuffer());if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid PDF');await mkdir('output/pdf',{recursive:true});await writeFile('output/pdf/new-forms-live-smoke.pdf',bytes);console.log(JSON.stringify({status:r.status,pdfBytes:bytes.length,promptTokens:r.promptTokens,completionTokens:r.completionTokens,cost:r.cost}));break}await new Promise(resolve=>setTimeout(resolve,2500))}
 if((await db.generatedReport.findUnique({where:{id:reportId}}))?.status!=='completed')throw Error('Report still pending after timeout');
}finally{
 const assignments=await db.testAssignment.findMany({where:{membershipId:fixture}});const attempts=await db.testAttempt.findMany({where:{assignmentId:{in:assignments.map(x=>x.id)}}});const ids=attempts.map(x=>x.id);
 // Let an in-flight paid request finish before deleting its snapshot.
 if(reportId){const r=await db.generatedReport.findUnique({where:{id:reportId}});if(r&&['pending','processing'].includes(r.status)){console.log('Preserved in-flight QA report for inspection',reportId);await db.$disconnect();process.exitCode=1}else await db.generatedReport.deleteMany({where:{id:reportId}})}
 if(!process.exitCode){await db.testResult.deleteMany({where:{attemptId:{in:ids}}});await db.userAnswer.deleteMany({where:{attemptId:{in:ids}}});await db.testAttempt.deleteMany({where:{id:{in:ids}}});await db.testAssignment.deleteMany({where:{membershipId:fixture}});await db.membership.deleteMany({where:{id:fixture}});await db.user.deleteMany({where:{id:fixture}});await db.campaign.deleteMany({where:{id:fixture}})}
 await db.$disconnect();
}
