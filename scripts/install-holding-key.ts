import "dotenv/config";
import {PrismaClient} from "@prisma/client";

import {pathToFileURL} from "node:url";
import {buildHoldingScoringKey,holdingKeyInstallAction,holdingKeyFingerprint} from "../packages/core/holding-key";
import {HOLDING_MODEL_VERSION} from "../packages/core/holding";
import {calculateScore,type QuestionInput} from "../packages/core/scoring";

export async function installHoldingKey(db:PrismaClient, options:{apply?:boolean;actorId?:string;reason?:string;allowProduction?:boolean}={}) {
  const url=new URL(process.env.DATABASE_URL||'');
  const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(!local&&!options.allowProduction)throw Error('Remote key installation requires explicit production authorization');
  if(options.apply && (!options.reason || options.reason.trim().length<10))throw Error('A detailed change-log reason is required before changing a scoring-key version');
  const version=await db.testVersion.findFirst({where:{testId:'situations',version:'2.0-2026-10-26'},include:{questions:{orderBy:{position:'asc'},include:{options:{orderBy:{position:'asc'}}}},keys:{orderBy:{createdAt:'desc'}}}});
  if(!version || !version.keys.length)throw Error('Install the original 14-case situations-v2 package before the Holding key');
  const questions=version.questions.map(q=>({id:q.id,type:q.type,text:q.text,content:q.content,imageUrl:q.imageUrl??undefined,options:q.options.map(o=>({id:o.id,text:o.text,imageUrl:o.imageUrl??undefined}))})) as QuestionInput[];
  const original=version.keys.find(k=>k.algorithm==='sjt' && (k.config as any)?.mode!=='effectiveness');
  if(!original)throw Error('The original +1 MOST/+1 LEAST scoring key is missing');
  const config=buildHoldingScoringKey(original.config as any,questions);
  const previous=version.keys.find(k=>k.version===HOLDING_MODEL_VERSION) || null;
  const action=holdingKeyInstallAction(previous,config);
  const configSha256=holdingKeyFingerprint(config);
  const plan={action,testVersionId:version.id,keyVersion:HOLDING_MODEL_VERSION,questionCount:questions.length,answerKeyChanges:0,status:'preliminary',expertPanelStatus:'Ключ не утверждён экспертной панелью',configSha256};
  if(!options.apply)return {...plan,dryRun:true,keyId:previous?.id??null};
  if(action==='unchanged')return {...plan,dryRun:false,keyId:previous!.id};
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM test_versions WHERE id=${version.id} FOR UPDATE`;
    const concurrent=await tx.scoringKey.findUnique({where:{testVersionId_version:{testVersionId:version.id,version:HOLDING_MODEL_VERSION}}});
    if(holdingKeyInstallAction(concurrent,config)==='unchanged')return {...plan,action:'unchanged',dryRun:false,keyId:concurrent!.id};
    const answers=Object.fromEntries(questions.map(q=>[q.id,{most:config.items[q.id].most!,least:config.items[q.id].least!}]));
    const key=await tx.scoringKey.create({data:{testVersionId:version.id,version:HOLDING_MODEL_VERSION,algorithm:'sjt',config:config as any,source:'Данные_для_AssessFlow_модель_Холдинга_21_11_26.xlsx, листы 3–4',status:'preliminary',approvedBy:null,approvedAt:null,controlExamples:[{name:'Все исходные ID совпадают с черновым ключом, 28/28',answers,expected:calculateScore('sjt',config,questions,answers)}] as any}});
    await tx.testVersion.update({where:{id:version.id},data:{delivery:{...(version.delivery as object),holdingModelVersion:HOLDING_MODEL_VERSION,keyPanelStatus:'unapproved',keyPanelLabel:'Ключ не утверждён экспертной панелью'}}});
    await tx.auditLog.create({data:{organizationId:null,actorId:options.actorId||'local-holding-install',action:'scoring.key_version_created',entityId:key.id,detail:{previousKeyId:original.id,newKeyId:key.id,version:HOLDING_MODEL_VERSION,reason:options.reason!,source:'Holding 21.11.2026 sheet3',configSha256,answerKeyChanges:0}}});
    return {...plan,dryRun:false,keyId:key.id};
  });
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const db=new PrismaClient();
  try{
    const args=process.argv.slice(2);
    const reason=args.find(x=>x.startsWith('--reason='))?.slice('--reason='.length);
    console.log(JSON.stringify(await installHoldingKey(db,{apply:args.includes('--apply'),allowProduction:args.includes('--production'),reason,actorId:process.env.HOLDING_ACTOR_ID}),null,2));
  } finally {await db.$disconnect();}
}
