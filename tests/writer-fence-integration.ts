import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {assertLocalHoldingEnvironment} from '../packages/core/demo-policy';
assert.equal(process.env.RUN_WRITER_FENCE_INTEGRATION,'1','Explicit synthetic writer integration opt-in required');
assertLocalHoldingEnvironment(process.env);assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/assessflow_holding_20261121');
assert(/^qa-writer-fence-[a-z0-9-]+$/.test(process.env.S3_BUCKET||''),'Dedicated writer test bucket required');
const {PrismaClient}=await import('@prisma/client');
const {withParticipantWriteFence}=await import('../apps/api/src/participant-write');
const {uploadAsset}=await import('../apps/api/src/storage');
const {eraseParticipantData}=await import('../apps/api/src/pilot-retention');
const {S3Client,GetObjectCommand,ListObjectsV2Command,DeleteObjectCommand}=await import('@aws-sdk/client-s3');
const db=new PrismaClient(),org=`qa-writer-fence-${randomUUID()}`,bucket=process.env.S3_BUCKET!;
const functionName=`qa_wf_${randomBytes(8).toString('hex')}`;assert(/^[a-z0-9_]+$/.test(functionName));
const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:process.env.S3_ACCESS_KEY!,secretAccessKey:process.env.S3_SECRET_KEY!}});
const users:string[]=[];let release=()=>{},writer:Promise<unknown>|undefined,eraser:Promise<unknown>|undefined;
const evidence:any={syntheticOnly:true,status:'in_progress',at:new Date().toISOString(),target:'loopback PostgreSQL55453/S33901',checks:[]};
async function missingObject(key:string){try{await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));return false;}catch(error:any){if(error.$metadata?.httpStatusCode===404)return true;throw error;}}
try{
 await db.organization.create({data:{id:org,name:'Synthetic writer-fence acceptance',slug:org,dataMode:'synthetic',matrixConfig:{}}});
 await db.campaign.create({data:{id:org,organizationId:org,name:'Synthetic race acceptance',endsAt:new Date('2099-01-01')}});
 const create=async(label:string,role='employee',status='active',createdAt=new Date())=>{const id=`${org}-${label}`;users.push(id);const user=await db.user.create({data:{id,name:`Synthetic ${label}`,email:`${id}@example.invalid`,demoOnly:true}});const member=await db.membership.create({data:{id,userId:id,organizationId:org,role,status,createdAt}});return{user,member};};
 const expert=await create('expert','expert'),upload=await create('upload'),race=await create('race'),blocked=await create('blocked','employee','blocked'),expired=await create('expired','employee','active',new Date('2000-01-01'));
 const ctx={org:await db.organization.findUniqueOrThrow({where:{id:org}}),user:expert.user,member:expert.member,role:'expert'} as const;
 for(const person of[upload,race,blocked,expired])await db.testAssignment.create({data:{organizationId:org,campaignId:org,membershipId:person.member.id,testVersionId:'verbal-v2',expertId:expert.member.id}});
 const bytes=await readFile('/root/research/damu-tests/implementation/demo/team-sample-cover.png');
 const payload=(membershipId:string,name:string)=>({campaignId:org,membershipId,name,contentType:'image/png',base64:bytes.toString('base64')});
 const saved=await uploadAsset(ctx,payload(upload.member.id,'synthetic-upload.png'));
 const file=await db.fileAsset.findUniqueOrThrow({where:{id:saved.id}});
 const received=await s3.send(new GetObjectCommand({Bucket:bucket,Key:file.storageKey}));
 assert.equal(createHash('sha256').update(await received.Body!.transformToByteArray()).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 assert.equal(await db.auditLog.count({where:{entityId:file.id,action:'file.uploaded'}}),1);
 assert.equal(await db.auditLog.count({where:{entityId:file.id,action:'file.upload_pending'}}),0);
 evidence.checks.push('actual acknowledged S3 PUT, FileAsset and settled receipt committed; readback SHA matches');
 const [{literal}]=await db.$queryRaw<{literal:string}[]>`SELECT quote_literal(${org}) AS literal`;
 await db.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId"=${literal} AND NEW.name='synthetic-forced-persist-failure.png' THEN RAISE EXCEPTION 'qa_persistence_failure'; END IF; RETURN NEW; END; $$`);
 await db.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE UPDATE ON file_assets FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
 await assert.rejects(uploadAsset(ctx,payload(upload.member.id,'synthetic-forced-persist-failure.png')),/qa_persistence_failure/);
 const reserved=await db.fileAsset.findFirstOrThrow({where:{organizationId:org,name:'synthetic-forced-persist-failure.png'}});
 assert(await missingObject(reserved.storageKey));assert.equal(await db.auditLog.count({where:{entityId:reserved.id,action:'file.upload_put_settled'}}),1);
 evidence.checks.push('real PostgreSQL post-PUT trigger failure compensated in S3; committed recovery reference/settled ledger retained');
 for(const person of[blocked,expired])await assert.rejects(uploadAsset(ctx,payload(person.member.id,'must-not-upload.png')));
 assert.equal(await db.fileAsset.count({where:{organizationId:org,membershipId:{in:[blocked.member.id,expired.member.id]}}}),0);
 evidence.checks.push('actual blocked and expired uploads rejected without FileAsset persistence');
 let enteredResolve=()=>{};const entered=new Promise<void>(r=>{enteredResolve=r;});const gate=new Promise<void>(r=>{release=r;});let writerPid=0;
 writer=withParticipantWriteFence(org,[race.member.id],async tx=>{const[p]=await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;writerPid=p.pid;enteredResolve();await gate;return tx.expertObservation.create({data:{organizationId:org,campaignId:org,membershipId:race.member.id,expertId:expert.member.id,exerciseId:org,criteriaSnapshot:{},scores:{},notes:'Synthetic race write only.',version:1}});});
 // The FK requires an actual same-tenant exercise; setup is explicitly synthetic.
 await db.assessmentExercise.create({data:{id:org,organizationId:org,type:'interview',name:{ru:'Synthetic race exercise'},criteria:[]}});
 await entered;eraser=eraseParticipantData(org,race.member.id);
 let blockerObserved=false;const until=Date.now()+5000;
 while(Date.now()<until){const[{n}]=await db.$queryRaw<{n:number}[]>`SELECT count(*)::int AS n FROM pg_stat_activity a WHERE ${writerPid}=ANY(pg_blocking_pids(a.pid))`;if(n>0){blockerObserved=true;break;}await new Promise(r=>setTimeout(r,25));}
 assert(blockerObserved,'actual eraser UPDATE must wait on the held participant lock');release();await writer;assert.equal(await eraser,true);
 assert.equal(await db.membership.count({where:{id:race.member.id}}),0);assert.equal(await db.expertObservation.count({where:{membershipId:race.member.id}}),0);
 await assert.rejects(withParticipantWriteFence(org,[race.member.id],async()=>{throw Error('write after erased subject was admitted');}));
 evidence.checks.push('actual PostgreSQL blocking PID proves erasure waits for writer; committed observation then erased; late writer rejected');
 assert.equal(await eraseParticipantData(org,upload.member.id),true);assert(await missingObject(file.storageKey));assert.equal(await db.fileAsset.count({where:{organizationId:org,membershipId:upload.member.id}}),0);
 assert.equal(await db.membership.count({where:{id:expert.member.id}}),1);
 evidence.checks.push('retention retry erased success and compensated-reservation objects/references while preserving expert');
 evidence.status='pass';evidence.completedAt=new Date().toISOString();

}finally{
 release();await Promise.allSettled([writer,eraser].filter((p):p is Promise<unknown>=>Boolean(p)));
 await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${functionName} ON file_assets`);await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
 const remaining=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:org+'/',MaxKeys:1000})).catch(()=>null);
 if(remaining){assert(!remaining.IsTruncated,'Owned test prefix cleanup unexpectedly truncated');for(const object of remaining.Contents||[])if(object.Key)await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:object.Key}));}
 for(const model of ['generatedReport','finalReport','aiReport','expertObservation','participantGroup','competencyConsensus','competencyModel','frozenNorm','fileAsset','userAnswer','testResult','testAttempt','testAssignment','assessmentExercise','auditLog'] as const)await(db[model] as any).deleteMany({where:{organizationId:org}});
 await db.campaign.deleteMany({where:{organizationId:org}});await db.organization.deleteMany({where:{id:org}});await db.user.deleteMany({where:{id:{in:users}}});
 assert.equal(await db.organization.count({where:{id:org}}),0);assert.equal(await db.user.count({where:{id:{in:users}}}),0);evidence.cleanupVerified=true;await db.$disconnect();
 const{db:workerDb}=await import('../apps/api/src/db');await workerDb.$disconnect();
}
await mkdir('/root/research/damu-tests/implementation/writer-local-acceptance',{recursive:true});await writeFile('/root/research/damu-tests/implementation/writer-local-acceptance/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
