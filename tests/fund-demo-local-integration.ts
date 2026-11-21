// Opt-in disposable PostgreSQL only. No dotenv/provider import before this guard.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assertFundDemoEnvironment, FUND_DEMO_PLAN, FUND_DEMO_ORGANIZATION_ID as targetId, FUND_DEMO_CAMPAIGN_ID, fundDemoPlanDigest } from "../packages/core/fund-demo-policy";
const options = { reviewedPlan: structuredClone(FUND_DEMO_PLAN), apply: true };
assert.equal(process.env.RUN_FUND_DEMO_LOCAL_INTEGRATION, "1", "Explicit local integration opt-in required");
assertFundDemoEnvironment(process.env, options);
assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/assessflow_holding_20261121_fund_demo");
assert.equal(process.env.S3_BUCKET, "fund-demo-local-integration-only");
assert.equal(process.env.S3_ENDPOINT, "http://127.0.0.1:3901");
const { PrismaClient } = await import("@prisma/client");
const { prepareFundClientDemo } = await import("../scripts/prepare-fund-client-demo");
const { buildHoldingScoringKey } = await import("../packages/core/holding-key");
const { HOLDING_MODEL_VERSION } = await import("../packages/core/holding");
const { defaultMatrix } = await import("../packages/core/contracts");
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const J = (v: unknown) => JSON.parse(JSON.stringify(v));
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const catalog = JSON.parse(await readFile(new URL("../data/catalog.json", import.meta.url), "utf8"));
async function snapshot() {
  const tables = ["organization","campaign","membership","testAssignment","testAttempt","userAnswer","testResult","generatedReport","reportArtifact","account","session","testVersion","question","answerOption","scoringKey","competencyModel","auditLog"] as const;
  const result: Record<string,unknown> = {};
  for (const table of tables) result[table] = await (db[table] as any).findMany({ orderBy: table === "reportArtifact" ? { reportId: "asc" } : { id: "asc" } });
  result.user = await db.user.findMany({ orderBy: { id: "asc" } });
  return result;
}
async function targetAbsent() {
  assert.equal(await db.organization.count({ where: { id: targetId } }),0);
  assert.equal(await db.auditLog.count({ where: { organizationId: targetId } }),0);
  assert.equal(await db.auditLog.count({ where: { action: "fund.identity_presentation_preserved", entityId: targetId } }),0);
  assert.equal(await db.user.count({ where: { demoOnly: true } }),0);
}
const checks: string[] = [];
try {
  assert.equal(await db.user.count(),0,"Disposable integration database must be empty; no cleanup/adoption");
  for (const form of catalog) {
    await db.test.create({ data: { id: form.id, name: form.name, description: form.description, direction: form.direction, source: form.source, licenseStatus: form.licenseStatus, scientificBasis: form.scientificBasis } });
    await db.testVersion.create({ data: { id: `${form.id}-v2`, testId: form.id, version: form.version, status: "published", durationMinutes: form.durationMinutes, timeLimitSeconds: form.timeLimitSeconds, delivery: form.delivery, instructions: form.instructions, limitations: form.limitations,
      questions: { create: form.questions.map((q: any,i: number) => ({ id:q.id,position:i,type:q.type,text:q.text,content:q.content || {},options:{create:q.options.map((o:any,j:number)=>({...o,position:j}))} })) },
      keys: { create: { id:`${form.id}-key-v2`,version:"2.0-preliminary",algorithm:form.algorithm,config:form.config,source:form.source,controlExamples:form.controlExamples,status:"preliminary" } },
    } });
    if (form.id === "situations") await db.scoringKey.create({data:{id:"holding-integration-key",testVersionId:"situations-v2",version:HOLDING_MODEL_VERSION,algorithm:"sjt",config:J(buildHoldingScoringKey(form.config,form.questions)),source:"Synthetic local setup from authoritative pure key",status:"preliminary",controlExamples:[]}});
  }
  for (const id of ["damu-organization","pilot-workspace"]) await db.organization.create({data:{id,slug:id,name:id==="damu-organization"?"KKK":"Local synthetic pilot",purpose:id==="pilot-workspace"?"pilot":"assessment",dataMode:"real",matrixConfig:J(defaultMatrix)}});
  const sourceUsers = [...FUND_DEMO_PLAN.identities, {userId:"report-demo-1",email:"report-demo1@assessflow.local",name:"Демо участник 1",sourceOrganizationId:"damu-organization",sourceMembershipId:"report-demo-1",sourceRole:"employee"}, {userId:"real-operator",email:"real-operator@example.invalid",name:"Synthetic protected control",sourceOrganizationId:"damu-organization",sourceMembershipId:"real-operator-member",sourceRole:"admin"}];
  for (const u of sourceUsers) {
    await db.user.create({data:{id:u.userId,email:u.email,name:u.userId==="employee"?"SYNTHETIC OLD DISPLAY — PRIVATE":u.name,demoOnly:false,platformAdmin:u.userId==="real-operator",mustChangePassword:false,accounts:{create:{id:`account-${u.userId}`,accountId:u.userId,providerId:"credential",password:"synthetic-local-preservation-marker-not-a-real-credential"}},sessions:{create:{id:`session-${u.userId}`,token:`synthetic-local-session-${u.userId}`,expiresAt:new Date("2027-01-01T00:00:00Z")}}}});
    await db.membership.create({data:{id:u.sourceMembershipId,organizationId:u.sourceOrganizationId,userId:u.userId,role:u.sourceRole,createdAt:new Date("2026-01-01T00:00:00Z")}});
  }
  await db.campaign.create({data:{id:FUND_DEMO_PLAN.sourceCampaignId,organizationId:FUND_DEMO_PLAN.sourceOrganizationId,name:"Historical synthetic review",description:FUND_DEMO_PLAN.sourceCampaignDescription,startsAt:new Date("2026-11-19"),endsAt:new Date("2026-11-20")}});
  for (let n=1;n<=5;n++) for (const f of catalog) {
    const assignmentId=`old-${n}-${f.id}`,attemptId=`${assignmentId}-attempt`;
    await db.testAssignment.create({data:{id:assignmentId,organizationId:"damu-organization",campaignId:FUND_DEMO_PLAN.sourceCampaignId,membershipId:`report-demo-${n}`,testVersionId:`${f.id}-v2`}});
    await db.testAttempt.create({data:{id:attemptId,organizationId:"damu-organization",assignmentId,status:"completed",language:"ru",scoringKeyId:`${f.id}-key-v2`,startedAt:new Date("2026-11-19"),submittedAt:new Date("2026-11-19")}});
    await db.testResult.create({data:{id:`${attemptId}-result`,organizationId:"damu-organization",attemptId,scoringKeyId:`${f.id}-key-v2`,reason:"synthetic_review_fixture",result:{total:28,legacy:true}}});
    await db.userAnswer.create({data:{id:`${attemptId}-answer`,organizationId:"damu-organization",attemptId,questionId:f.questions[0].id,value:{legacy:"never copy"}}});
  }
  await db.generatedReport.create({data:{id:"historical-pdf",organizationId:"damu-organization",campaignId:FUND_DEMO_PLAN.sourceCampaignId,kind:"individual",language:"ru",status:"ready",participantIds:["report-demo-1"],membershipId:"report-demo-1",snapshot:{legacy:"immutable"},inputHash:"old",model:"local-data",prompt:"",promptVersion:"old",providerConfig:{},createdBy:"admin",artifact:{create:{bytes:Buffer.from("legacy synthetic pdf bytes"),sha256:"local-sentinel"}}}});
  const baseline = await snapshot();
  const dry = await prepareFundClientDemo(db,{reviewedPlan:FUND_DEMO_PLAN},process.env);
  assert.equal(dry.action,"create"); assert.equal(dry.dryRun,true); assert.deepEqual(await snapshot(),baseline); checks.push("dry-run no writes");
  await db.testResult.update({where:{id:"old-1-situations-attempt-result"},data:{reason:"real_result"}});
  await assert.rejects(prepareFundClientDemo(db,options,process.env),/source.*provenance/i); await targetAbsent();
  await db.testResult.update({where:{id:"old-1-situations-attempt-result"},data:{reason:"synthetic_review_fixture"}});
  await db.user.update({where:{id:"admin"},data:{platformAdmin:true}});
  await assert.rejects(prepareFundClientDemo(db,options,process.env),/identity|privilege/i); await targetAbsent();
  await db.user.update({where:{id:"admin"},data:{platformAdmin:false}});
  await db.membership.update({where:{id:"cmwoqt4ax000cqr0u8envo60j"},data:{organizationId:"damu-organization"}});
  await assert.rejects(prepareFundClientDemo(db,options,process.env),/source.*membership/i); await targetAbsent();
  await db.membership.update({where:{id:"cmwoqt4ax000cqr0u8envo60j"},data:{organizationId:"pilot-workspace"}});
  await db.user.update({where:{id:"admin"},data:{email:"conflicting-identity@example.invalid"}});
  await assert.rejects(prepareFundClientDemo(db,options,process.env),/identity|conflicting/i); await targetAbsent();
  await db.user.update({where:{id:"admin"},data:{email:"admin@assessflow.local"}});
  await db.account.update({where:{id:"account-admin"},data:{providerId:"synthetic-missing-control"}});
  await assert.rejects(prepareFundClientDemo(db,options,process.env),/credential account/i); await targetAbsent();
  await db.account.update({where:{id:"account-admin"},data:{providerId:"credential"}});
  await db.account.update({where:{id:"account-admin"},data:{password:null}});
  await assert.rejects(prepareFundClientDemo(db,options,process.env),/credential account/i); await targetAbsent();
  await db.account.update({where:{id:"account-admin"},data:{password:"synthetic-local-preservation-marker-not-a-real-credential"}});
  checks.push("wrong source provenance/platform privilege/tenant/email/missing credential reject before writes");
  // Trigger failure at the final presentation conversion: all new tenant rows must roll back.
  await db.$executeRawUnsafe(`CREATE FUNCTION fund_demo_fail_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."demoOnly" THEN RAISE EXCEPTION 'synthetic forced rollback'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER fund_demo_fail_identity BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fund_demo_fail_identity()`);
  await assert.rejects(prepareFundClientDemo(db,options,process.env)); await targetAbsent();
  await db.$executeRawUnsafe(`DROP TRIGGER fund_demo_fail_identity ON users`); await db.$executeRawUnsafe(`DROP FUNCTION fund_demo_fail_identity()`);
  checks.push("final identity failure atomically rolls back complete scope");
  const beforeApply = await snapshot();
  const lockTransactions: {table:string;id:string}[][]=[];
  const tracingDb=new Proxy(db,{get(object,key){if(key==="$transaction")return (callback:any,settings:any)=>object.$transaction(async tx=>{
    const events:{table:string;id:string}[]=[];lockTransactions.push(events);
    const tracingTx=new Proxy(tx,{get(transaction,key){
      if(key==="$queryRaw")return (...args:any[])=>{const sql=Array.isArray(args[0])?args[0].join("?"):"";const table=/FROM (users|memberships|organizations).*FOR UPDATE/.exec(sql)?.[1];if(table)events.push({table,id:args[1]});return (transaction.$queryRaw as any).apply(transaction,args);};
      const value=Reflect.get(transaction,key);return typeof value==="function"?value.bind(transaction):value;
    }});
    return callback(tracingTx);
  },settings);const value=Reflect.get(object,key);return typeof value==="function"?value.bind(object):value;}});
  const created = await prepareFundClientDemo(tracingDb as any,options,process.env);
  for(const events of lockTransactions){
    const phases=events.map(e=>["users","memberships","organizations"].indexOf(e.table));assert.deepEqual(phases,[...phases].sort((a,b)=>a-b));
    for(const table of ["users","memberships","organizations"]){const ids=events.filter(e=>e.table===table).map(e=>e.id);assert.deepEqual(ids,[...ids].sort(),`${table} locks sorted`);}
    assert.deepEqual(events.filter(e=>e.table==="users").map(e=>e.id),FUND_DEMO_PLAN.identities.map(p=>p.userId).sort());
  }
  checks.push("actual PostgreSQL locks: sorted users then all old/new memberships then organizations");
  assert.equal(created.action,"created"); assert.equal(created.syntheticParticipants,5); assert.deepEqual(created.sjtTotals,[15,18,21,24,26]);
  const afterApply = await snapshot();
  const archivedPresentation = await db.auditLog.findMany({where:{action:"fund.identity_presentation_preserved",entityId:targetId},orderBy:{organizationId:"asc"}});
  assert.equal(archivedPresentation.length,2,"old presentation must be privately archived in source tenants atomically");
  assert(archivedPresentation.some(a=>JSON.stringify(a.detail).includes("SYNTHETIC OLD DISPLAY — PRIVATE")));
  assert(archivedPresentation.every(a=>a.organizationId!==targetId));
  const oldRows = (rows:any[]) => rows.filter(r=>r.organizationId!==targetId && r.id!==targetId && !r.id?.startsWith("fund-client-demo") && r.action!=="fund.identity_presentation_preserved");
  for (const table of Object.keys(beforeApply).filter(k=>k!=="user")) assert.deepEqual(oldRows(afterApply[table] as any[]),oldRows(beforeApply[table] as any[]),`${table}: original rows unchanged`);
  assert.deepEqual((afterApply.user as any[]).find(u=>u.id==="real-operator"),(beforeApply.user as any[]).find(u=>u.id==="real-operator"));
  assert.deepEqual((afterApply.user as any[]).find(u=>u.id==="report-demo-1"),(beforeApply.user as any[]).find(u=>u.id==="report-demo-1"));
  for(const tableUser of beforeApply.user as any[]){
    const current=(afterApply.user as any[]).find(u=>u.id===tableUser.id),keep=(u:any)=>Object.fromEntries(Object.entries(u).filter(([key])=>!["name","demoOnly","updatedAt"].includes(key)));
    assert.deepEqual(keep(current),keep(tableUser),"no other global user fields may change");
  }
  const storedResults=await db.testResult.findMany({where:{organizationId:targetId},include:{attempt:{include:{assignment:{include:{membership:true}}}}}});
  assert.equal(storedResults.length,30);assert(storedResults.every(r=>(r.result as any).validity?.eligible===true && r.reason==="synthetic_fund_demo_fixture_not_browser"));
  const actualSjt=storedResults.filter(r=>r.attempt.assignment.testVersionId==="situations-v2").sort((a,b)=>a.attempt.assignment.membership.profileRow!-b.attempt.assignment.membership.profileRow!);
  assert.deepEqual(actualSjt.map(r=>(r.result as any).total),[15,18,21,24,26]);
  for(const r of actualSjt){const score=r.result as any;assert.equal(score.holdingProfile.length,8);assert.equal(score.holdingProfile.reduce((sum:number,row:any)=>sum+row.total,0),score.total);assert.equal(score.provenance.browserVerified,false);assert.equal(score.provenance.timerVerified,false);}
  const consent = await db.membership.findMany({where:{organizationId:targetId}});assert.equal(consent.length,7);assert(consent.every(m=>m.consentAt===null&&m.consentVersion===null));
  const repeatBaseline=await snapshot();const repeated=await prepareFundClientDemo(db,options,process.env);assert.equal(repeated.action,"unchanged");assert.deepEqual(await snapshot(),repeatBaseline);
  const repeatedDry=await prepareFundClientDemo(db,{reviewedPlan:FUND_DEMO_PLAN},process.env);assert.equal(repeatedDry.action,"unchanged");assert.deepEqual(await snapshot(),repeatBaseline);
  checks.push("7 converted identities; source history/credentials/sessions/PDF bytes/operator unchanged","30 calculated complete results; varied SJT; 8-row Holding profiles; source profile model","null consent; unchanged repeat performs zero writes/audits");
  // Readback failure must be visible even after the apply commit has succeeded.
  let txCalls=0;
  const readbackFailure=new Proxy(db,{get(object,key){if(key==="$transaction")return (...args:any[])=>{if(++txCalls===2)throw Error("synthetic readback unavailable");return (object.$transaction as any).apply(object,args);};return Reflect.get(object,key);}});
  await assert.rejects(prepareFundClientDemo(readbackFailure as any,options,process.env),/readback/i);
  await db.campaign.create({data:{id:"extra-contamination",organizationId:targetId,name:"Synthetic negative control",endsAt:new Date("2026-11-20")}});
  const contaminated=hash(await snapshot());await assert.rejects(prepareFundClientDemo(db,options,process.env),/scope|campaign|contamination/i);assert.equal(hash(await snapshot()),contaminated);
  await db.campaign.delete({where:{id:"extra-contamination"}});
  await db.membership.create({data:{id:"extra-synthetic-participant-control",organizationId:targetId,userId:"report-demo-1",role:"employee"}});
  const extraPeople=hash(await snapshot());await assert.rejects(prepareFundClientDemo(db,options,process.env),/scope|contamination/i);assert.equal(hash(await snapshot()),extraPeople);
  await db.membership.delete({where:{id:"extra-synthetic-participant-control"}});
  const firstResult=storedResults[0],originalResult=J(firstResult.result);
  await db.testResult.update({where:{id:firstResult.id},data:{result:{...originalResult,unexpectedSyntheticTamper:true}}});
  const changedResult=hash(await snapshot());await assert.rejects(prepareFundClientDemo(db,options,process.env),/result|provenance/i);assert.equal(hash(await snapshot()),changedResult);
  await db.testResult.update({where:{id:firstResult.id},data:{result:originalResult}});
  const audit=await db.auditLog.findFirstOrThrow({where:{organizationId:targetId,action:"fund.synthetic_demo_created"}});
  assert.equal((audit.detail as any).planDigest,fundDemoPlanDigest(FUND_DEMO_PLAN));assert(!JSON.stringify(audit.detail).includes("SYNTHETIC OLD DISPLAY"));
  await db.auditLog.delete({where:{id:audit.id}});const unowned=hash(await snapshot());await assert.rejects(prepareFundClientDemo(db,options,process.env),/creation audit|provenance/i);assert.equal(hash(await snapshot()),unowned);
  await db.auditLog.create({data:{...audit,detail:J(audit.detail)}});
  assert.equal((await prepareFundClientDemo(db,options,process.env)).action,"unchanged","leave a verified valid fixture after negative controls");
  checks.push("readback errors never success; extra campaign/people, altered result and unowned target rejected without writes","new-tenant audit contains no previous display names; private source archives preserved");
  console.log(JSON.stringify({status:"pass",syntheticOnly:true,checks,sourcePreservationDigest:hash(beforeApply),planDigest:fundDemoPlanDigest(FUND_DEMO_PLAN),organizationId:targetId,campaignId:FUND_DEMO_CAMPAIGN_ID},null,2));
} finally { await db.$disconnect(); }
