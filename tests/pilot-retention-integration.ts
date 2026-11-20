import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { eraseExpiredPilotParticipant } from "../apps/api/src/pilot-retention";
import { db as workerDb } from "../apps/api/src/db";
import { pilotDeletionDate } from "../packages/core/pilot";
if (!["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw Error("Local verification only");
const db=new PrismaClient(),id=`qa-retention-${Date.now()}`,other=id+'-assessment',old=new Date(),now=new Date(+old+100*86400000);
const bucket=process.env.S3_BUCKET||'assessflow',key=`${id}/${id}-expired/file`;
const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY!,secretAccessKey:process.env.S3_SECRET_KEY!}});
try {
 for(const [organizationId,purpose] of [[id,'pilot'],[other,'assessment']]) {
  await db.organization.create({data:{id:organizationId,name:'Retention verification',slug:organizationId,purpose,matrixConfig:{}}});
  await db.campaign.create({data:{id:organizationId,organizationId,name:'Retention verification',endsAt:new Date(+now+86400000)}});
 }
 for(const label of ['expired','shared','fresh','staff','assessment']) {
  const userId=id+'-'+label,organizationId=label==='assessment'?other:id;
  await db.user.create({data:{id:userId,name:'Synthetic retention '+label,email:userId+'@assessflow.local',accounts:{create:{providerId:'credential',accountId:userId,password:'not-a-login-credential'}},sessions:{create:{id:userId,token:userId,expiresAt:new Date(+now+86400000)}},memberships:{create:{id:userId,organizationId,role:label==='staff'?'admin':'employee',createdAt:label==='fresh'?now:old}}}});
  if(label==='shared') await db.membership.create({data:{id:userId+'-other',organizationId:other,userId,role:'employee'}});
 }
 const person=id+'-expired';
 const version=await db.testVersion.findUniqueOrThrow({where:{id:'verbal-v2'},include:{keys:{take:1},questions:{take:1}}});
 await db.testAssignment.create({data:{id:person,organizationId:id,campaignId:id,membershipId:person,testVersionId:version.id}});
 await db.testAttempt.create({data:{id:person,organizationId:id,assignmentId:person,language:'ru',scoringKeyId:version.keys[0].id,answers:{create:{questionId:version.questions[0].id,value:'verification'}},results:{create:{scoringKeyId:version.keys[0].id,result:{raw:1}}}}});
 await db.assessmentExercise.create({data:{id,organizationId:id,type:'interview',name:{ru:'QA'},criteria:{}}});
 await db.expertObservation.create({data:{id:person,organizationId:id,campaignId:id,membershipId:person,expertId:id+'-staff',exerciseId:id,criteriaSnapshot:{},scores:{},notes:'personal observation',version:1}});
 await db.competencyModel.create({data:{id,organizationId:id,version:1,content:{},authorId:id+'-staff'}});
 await db.competencyConsensus.create({data:{id:person,organizationId:id,campaignId:id,membershipId:person,modelId:id,version:1,scores:{},authorId:id+'-staff'}});
 await db.finalReport.create({data:{id:person,organizationId:id,campaignId:id,membershipId:person,authorId:id+'-staff',version:1,content:{name:'personal'},resultIds:[],observationIds:[]}});
 await db.aiReport.create({data:{id:person,organizationId:id,campaignId:id,membershipId:person,model:'qa',promptVersion:'qa',inputHash:'qa',resultIds:[]}});
 await db.generatedReport.create({data:{id:person,organizationId:id,campaignId:id,kind:'team',language:'ru',participantIds:[person,id+'-fresh'],snapshot:{person},inputHash:'qa',model:'qa',prompt:'',promptVersion:'qa',providerConfig:{},createdBy:id+'-staff',artifact:{create:{bytes:Buffer.from('qa'),sha256:'qa'}}}});
 await db.frozenNorm.create({data:{id:person,organizationId:id,campaignId:id,excludedCount:0,metrics:{},sourceHash:'qa',createdBy:id+'-staff'}});
 await db.auditLog.createMany({data:[
  {id:person+'-audit',organizationId:id,actorId:person,action:'consent.accepted',entityId:person,detail:{email:person+'@assessflow.local'}},
  {id:person+'-batch',organizationId:id,actorId:id+'-staff',action:'tests.assigned',entityId:id,detail:{membershipIds:[person,id+'-fresh']}},
  {id:id+'-keep',organizationId:id,actorId:id+'-staff',action:'unrelated',entityId:id+'-fresh'},
 ]});
 await db.verification.create({data:{identifier:person+'@assessflow.local',value:'qa',expiresAt:new Date(+now+86400000)}});
 try {await s3.send(new CreateBucketCommand({Bucket:bucket}))}catch{}
 await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:'synthetic private file'}));
 await db.fileAsset.create({data:{id:person,organizationId:id,campaignId:id,membershipId:person,uploadedBy:id+'-staff',name:'private.txt',contentType:'text/plain',size:22,storageKey:key}});
 assert.equal(await eraseExpiredPilotParticipant(person,new Date(+pilotDeletionDate(old)-1)),false);
 assert.equal(await eraseExpiredPilotParticipant(person,now),true);
 assert.equal(await eraseExpiredPilotParticipant(person,now),false);
 for(const model of ['membership','user','account','session','verification','testAssignment','testAttempt','userAnswer','testResult','expertObservation','competencyConsensus','finalReport','aiReport','generatedReport','reportArtifact','fileAsset'] as const) {
  const rows=await (db[model] as any).findMany();
  assert(!JSON.stringify(rows).includes(person),model+' still references expired participant');
 }
 assert.equal(await db.frozenNorm.count({where:{organizationId:id}}),0);
 assert.equal(await db.auditLog.count({where:{organizationId:id,action:'pilot.retention_erased'}}),1);
 assert.equal(await db.auditLog.count({where:{id:id+'-keep'}}),1);
 assert.equal(await db.auditLog.count({where:{id:{in:[person+'-audit',person+'-batch']}}}),0);
 await assert.rejects(s3.send(new GetObjectCommand({Bucket:bucket,Key:key})),e=>(e as any).$metadata?.httpStatusCode===404);
 console.log('PASS expired participant: answers, results, files, reports, consensus, consent/audit identifiers and auth credentials erased; retry idempotent');
 assert.equal(await eraseExpiredPilotParticipant(id+'-shared',now),true);
 assert(await db.user.findUnique({where:{id:id+'-shared'}}));
 assert(await db.membership.findUnique({where:{id:id+'-shared-other'}}));
 assert(await db.session.findUnique({where:{id:id+'-shared'}}));
 for(const label of ['fresh','staff','assessment']) assert.equal(await eraseExpiredPilotParticipant(id+'-'+label,now),false);
 console.log('PASS fresh participant, pilot staff, assessment organization and shared external account preserved');
} finally {
 await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key})).catch(()=>{});
 const orgs=[id,other];
 for(const model of ['generatedReport','finalReport','aiReport','expertObservation','competencyConsensus','competencyModel','frozenNorm','participantGroup','fileAsset','userAnswer','testResult','testAttempt','testAssignment','assessmentExercise','auditLog'] as const) await (db[model] as any).deleteMany({where:{organizationId:{in:orgs}}});
 await db.campaign.deleteMany({where:{organizationId:{in:orgs}}});
 await db.organization.deleteMany({where:{id:{in:orgs}}});
 await db.user.deleteMany({where:{id:{startsWith:id+'-'}}});
 await db.verification.deleteMany({where:{identifier:{startsWith:id+'-'}}});
 await db.$disconnect();await workerDb.$disconnect();s3.destroy();
}
