import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {FileAsset} from '@prisma/client';
import {mkdir,writeFile,readFile,chmod} from 'node:fs/promises';
import {assertLocalHoldingEnvironment,DEMO_ORGANIZATION_ID,DEMO_CAMPAIGN_ID} from '../packages/core/demo-policy';
assert.equal(process.env.RUN_LOCAL_HOLDING_RECOVERY,'1','Explicit synthetic recovery opt-in required');
assertLocalHoldingEnvironment(process.env);
const source=new URL(process.env.DATABASE_URL!);assert.equal(source.hostname,'127.0.0.1');assert.equal(source.port,'55453');assert.equal(source.pathname,'/assessflow_holding_20261121');
process.umask(0o077);
const suffix=randomBytes(5).toString('hex'),restoreName=`assessflow_holding_20261121_restore_${suffix}`;
const directory=`/root/research/damu-tests/implementation/recovery-local/${suffix}`;
await mkdir(directory,{recursive:true,mode:0o700});await mkdir(directory+'/objects',{mode:0o700});
const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();
const{uploadAsset}=await import('../apps/api/src/storage');
const{S3Client,GetObjectCommand,PutObjectCommand,DeleteObjectCommand,CreateBucketCommand,DeleteBucketCommand}=await import('@aws-sdk/client-s3');
const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:process.env.S3_ACCESS_KEY!,secretAccessKey:process.env.S3_SECRET_KEY!}});
const sourceBucket=process.env.S3_BUCKET!,restoreBucket=`qa-holding-restore-${suffix}`;
const countsFor=['user','membership','competencyModel','competencyConsensus','testAssignment','testAttempt','userAnswer','testResult','generatedReport','reportArtifact','fileAsset'] as const;
let restoreDb:InstanceType<typeof PrismaClient>|undefined,cloneCreated=false,bucketCreated=false,probe:{id:string;storageKey:string}|undefined;
const copied:{id:string;storageKey:string;sha256:string;bytes:number;backupFile:string}[]=[];
let result:any;
function run(command:string,args:string[],name:string,env=process.env){const r=spawnSync(command,args,{env,encoding:'utf8',timeout:120000});if(r.status!==0){writeFileSync(directory+'/'+name+'-error.log',(r.stderr||'')+(r.stdout||''));throw Error(`${name} failed; private log retained`);}return r.stdout;}
const pgEnv={...process.env,PGPASSWORD:decodeURIComponent(source.password)};
const pgArgs=['-h',source.hostname,'-p',source.port,'-U',decodeURIComponent(source.username)];

try{
 assert.equal(await db.organization.count({where:{dataMode:'real'}}),0,'Synthetic-only recovery target');
 const identities=await db.user.findMany({select:{id:true,email:true,demoOnly:true}});assert(identities.every(u=>u.email.endsWith('@example.invalid')&&(u.demoOnly||/^holding-browser-[0-9]+-[a-f0-9]+-local-operator$/.test(u.id))));
 const org=await db.organization.findUniqueOrThrow({where:{id:DEMO_ORGANIZATION_ID}}),expert=await db.membership.findUniqueOrThrow({where:{id:'holding-demo-expert'},include:{user:true}});
 const png=await readFile('/root/research/damu-tests/implementation/demo/team-sample-cover.png');
 const upload=await uploadAsset({org,user:expert.user,member:expert,role:'expert'},{campaignId:DEMO_CAMPAIGN_ID,membershipId:'holding-demo-participant-65',name:`synthetic-recovery-probe-${suffix}.png`,contentType:'image/png',base64:png.toString('base64')});
 const asset=await db.fileAsset.findUniqueOrThrow({where:{id:upload.id}});probe={id:asset.id,storageKey:asset.storageKey};
 const snapshot=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const[{snapshotId}]=await tx.$queryRaw<{snapshotId:string}[]>`SELECT pg_export_snapshot() AS "snapshotId"`;
  const sourceCounts:Record<string,number>={};for(const model of countsFor)sourceCounts[model]=await(tx[model] as any).count();
  const files=await tx.fileAsset.findMany({orderBy:{id:'asc'}});assert(files.length<=1000);
  run('pg_dump',[...pgArgs,'-d',source.pathname.slice(1),'-Fc','--no-owner','--no-acl','--snapshot',snapshotId,'-f',directory+'/database.dump'],'pg-dump',pgEnv);
  for(const file of files){assert(file.storageKey.startsWith(file.organizationId+'/'+file.membershipId+'/'));const response=await s3.send(new GetObjectCommand({Bucket:sourceBucket,Key:file.storageKey}));const bytes=Buffer.from(await response.Body!.transformToByteArray());assert.equal(bytes.length,file.size);const sha256=createHash('sha256').update(bytes).digest('hex');const backupFile=directory+'/objects/'+sha256;await writeFile(backupFile,bytes);copied.push({id:file.id,storageKey:file.storageKey,sha256,bytes:bytes.length,backupFile});}
  return{snapshotId,sourceCounts};
 },{isolationLevel:'RepeatableRead',timeout:120000,maxWait:10000});
 await chmod(directory+'/database.dump',0o600);
 const listing=run('pg_restore',['--list',directory+'/database.dump'],'restore-list');assert(listing.includes('TABLE DATA public memberships'));await writeFile(directory+'/database-list.txt',listing);
 run('createdb',[...pgArgs,'-O',decodeURIComponent(source.username),restoreName],'create-test-clone',pgEnv);cloneCreated=true;
 run('pg_restore',[...pgArgs,'-d',restoreName,'--no-owner','--no-acl','--exit-on-error',directory+'/database.dump'],'restore-database',pgEnv);
 const restoredUrl=new URL(source);restoredUrl.pathname='/'+restoreName;restoreDb=new PrismaClient({datasourceUrl:restoredUrl.toString()});
 const restoredCounts:Record<string,number>={};for(const model of countsFor)restoredCounts[model]=await(restoreDb[model] as any).count();assert.deepEqual(restoredCounts,snapshot.sourceCounts);
 await s3.send(new CreateBucketCommand({Bucket:restoreBucket}));bucketCreated=true;
 for(const file of copied){const bytes=await readFile(file.backupFile);await s3.send(new PutObjectCommand({Bucket:restoreBucket,Key:file.storageKey,Body:bytes}));const response=await s3.send(new GetObjectCommand({Bucket:restoreBucket,Key:file.storageKey}));assert.equal(createHash('sha256').update(await response.Body!.transformToByteArray()).digest('hex'),file.sha256);const restoredAsset:FileAsset=await restoreDb.fileAsset.findUniqueOrThrow({where:{id:file.id}});assert.equal(restoredAsset.storageKey,file.storageKey);assert.equal(restoredAsset.size,file.bytes);}
 result={status:'pass',syntheticOnly:true,createdAt:new Date().toISOString(),target:'loopback-only separate PostgreSQL clone and S3 bucket',consistentPostgresSnapshot:true,sourceSnapshot:snapshot.snapshotId,sourceCounts:snapshot.sourceCounts,restoredCounts,dumpSha256:createHash('sha256').update(await readFile(directory+'/database.dump')).digest('hex'),objectCount:copied.length,objects:copied.map(({id,sha256,bytes})=>({id,sha256,bytes,restoredReadbackMatches:true})),dump:directory+'/database.dump',claim:'Actual local DB+file restore only; not production/off-site/scheduled-backup acceptance'};
}finally{
 await restoreDb?.$disconnect();
 if(bucketCreated){for(const file of copied)await s3.send(new DeleteObjectCommand({Bucket:restoreBucket,Key:file.storageKey}));await s3.send(new DeleteBucketCommand({Bucket:restoreBucket}));}
 if(cloneCreated)run('dropdb',[...pgArgs,restoreName],'drop-owned-test-clone',pgEnv);
 if(probe){await s3.send(new DeleteObjectCommand({Bucket:sourceBucket,Key:probe.storageKey}));await db.fileAsset.deleteMany({where:{id:probe.id,organizationId:DEMO_ORGANIZATION_ID,storageKey:probe.storageKey}});await db.auditLog.deleteMany({where:{organizationId:DEMO_ORGANIZATION_ID,entityId:probe.id}});assert.equal(await db.fileAsset.count({where:{id:probe.id}}),0);}
 await db.$disconnect();const{db:workerDb}=await import('../apps/api/src/db');await workerDb.$disconnect();s3.destroy();
}
result.cleanupVerified=true;await writeFile(directory+'/evidence.json',JSON.stringify(result,null,2));await writeFile('/root/research/damu-tests/implementation/recovery-local/latest.json',JSON.stringify({evidence:directory+'/evidence.json'},null,2));console.log(JSON.stringify(result,null,2));
