// No dotenv or runtime database/provider imports: CLI guards run first.
import type { Prisma, PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import catalog from "../data/catalog.json";
import { defaultMatrix } from "../packages/core/contracts";
import { DEFAULT_COMPETENCIES } from "../packages/core/competencies";
import { HOLDING_MODEL_VERSION } from "../packages/core/holding";
import { buildHoldingScoringKey } from "../packages/core/holding-key";
import { sameJsonValue, type QuestionInput, type ScoringConfig } from "../packages/core/scoring";
import {
  FUND_DEMO_PLAN, FUND_DEMO_ORGANIZATION_ID as ORG, FUND_DEMO_CAMPAIGN_ID as CAMPAIGN,
  FUND_DEMO_CREATION_ACTION, FUND_DEMO_RESULT_REASON, FUND_DEMO_ACTOR, FUND_DEMO_PROVENANCE,
  assertFundDemoEnvironment, fundDemoPlanDigest, fundDemoRoster, fundDemoFixture, type FundDemoOptions,
} from "../packages/core/fund-demo-policy";

type Tx = Prisma.TransactionClient;
const J = (value: unknown): any => JSON.parse(JSON.stringify(value));
const fail = (message: string): never => { throw Error(`Fund demo readiness: ${message}`); };
const ensure = (condition: unknown, message: string): void => { if (!condition) fail(message); };
const roster = () => fundDemoRoster();
const assignmentId = (memberId: string, testId: string) => `${memberId}-${testId}`;
const attemptId = (id: string) => `${id}-attempt-1`;
const resultId = (id: string) => `${id}-result`;
const MODEL = `${ORG}-holding-model-1`;
const expectedCampaign = () => ({ id: CAMPAIGN, organizationId: ORG, name: FUND_DEMO_PLAN.campaign.name,
  description: JSON.stringify({ ...FUND_DEMO_PROVENANCE, sampleBoundariesExplicit: true, sampleStartsAt: FUND_DEMO_PLAN.campaign.startsAt, sampleEndsAt: FUND_DEMO_PLAN.campaign.endsAt, sampleSize: 5, planDigest: fundDemoPlanDigest(FUND_DEMO_PLAN) }),
  country: FUND_DEMO_PLAN.campaign.country, startsAt: new Date(FUND_DEMO_PLAN.campaign.startsAt), endsAt: new Date(FUND_DEMO_PLAN.campaign.endsAt), status: "active" });
/** Prisma's JSONB float transport can differ by one ULP; integer scores stay exact. */
export function fundDemoScoreMatches(left:unknown,right:unknown):boolean {
  if (left===right) return true;
  if (typeof left==="number" && typeof right==="number") return Number.isFinite(left) && Number.isFinite(right) && !Number.isInteger(left) && !Number.isInteger(right) && Math.abs(left-right)<=Number.EPSILON*Math.max(1,Math.abs(left),Math.abs(right))*2;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length===right.length && left.every((value,i)=>fundDemoScoreMatches(value,right[i]));
  if (left && right && typeof left==="object" && typeof right==="object") {
    const a=left as Record<string,unknown>,b=right as Record<string,unknown>;
    return Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(key=>Object.hasOwn(b,key) && fundDemoScoreMatches(a[key],b[key]));
  }
  return false;
}
const matches = (actual: any, expected: Record<string,any>, message: string) => {
  for (const [key,value] of Object.entries(expected)) {
    const saved = actual?.[key];
    ensure(value instanceof Date ? saved instanceof Date && saved.getTime() === value.getTime() : key==="result" ? fundDemoScoreMatches(saved,value) : sameJsonValue(saved,value),`${message} (${key})`);
  }
};

async function lockCurrentScope(tx: Tx) {
  // Global participant-writer fence: sorted users -> old/new memberships -> orgs.
  for (const id of FUND_DEMO_PLAN.identities.map(p => p.userId).sort()) await tx.$queryRaw`SELECT id FROM users WHERE id=${id} FOR UPDATE`;
  const memberships = await tx.membership.findMany({where:{OR:[{userId:{in:FUND_DEMO_PLAN.identities.map(p=>p.userId)}},{id:{in:roster().map(p=>p.membershipId)}}]},select:{id:true,organizationId:true},orderBy:{id:"asc"}});
  for (const m of memberships) await tx.$queryRaw`SELECT id FROM memberships WHERE id=${m.id} FOR UPDATE`;
  const organizations = [...new Set([ORG,FUND_DEMO_PLAN.sourceOrganizationId,...memberships.map(m=>m.organizationId)])].sort();
  for (const id of organizations) await tx.$queryRaw`SELECT id FROM organizations WHERE id=${id} FOR UPDATE`;
}
async function verifyConnection(tx: Tx, env: Record<string,string|undefined>, production: boolean) {
  const rows = await tx.$queryRaw<{database:string;address:string|null}[]>`SELECT current_database() AS database, host(inet_server_addr()) AS address`;
  ensure(rows.length===1 && rows[0].database===new URL(env.DATABASE_URL!).pathname.slice(1),"injected database does not match explicit environment");
  if (!production) ensure(rows[0].address === "127.0.0.1" || rows[0].address === "::1", "injected database must be loopback");
}
async function verifyIdentities(tx: Tx, converted: boolean) {
  const users = await tx.user.findMany({where:{OR:[{id:{in:FUND_DEMO_PLAN.identities.map(p=>p.userId)}},{email:{in:FUND_DEMO_PLAN.identities.map(p=>p.email)}}]},include:{accounts:{select:{id:true,providerId:true,accountId:true,userId:true}}},orderBy:{id:"asc"}});
  ensure(users.length===7,"exact reviewed identity map missing/conflicting");
  for (const person of roster()) {
    const user=users.find(u=>u.id===person.userId);
    ensure(user && user.email===person.email && user.platformAdmin===false && user.mustChangePassword===false && user.demoOnly===converted,"reviewed identity/privilege conflict");
    ensure(user!.accounts.filter(a=>a.providerId==="credential").length===1,"reviewed credential account missing/conflicting; no account reset allowed");
    ensure(await tx.account.count({where:{userId:person.userId,providerId:"credential",AND:[{password:{not:null}},{password:{not:""}}]}})===1,"reviewed credential account has no usable stored credential; no account reset allowed");
    if (converted) ensure(user!.name===person.name,"converted identity presentation conflict");
    else if (person.userId.startsWith("report-demo-")) ensure(user!.name===person.name,"reviewed synthetic identity presentation conflict");
    const membership = await tx.membership.findUnique({where:{id:person.sourceMembershipId}});
    ensure(membership && membership.organizationId===person.sourceOrganizationId && membership.userId===person.userId && membership.role===person.sourceRole,"reviewed source membership conflict");
  }
  return users;
}
async function verifySource(tx: Tx) {
  const source = await tx.organization.findUnique({where:{id:FUND_DEMO_PLAN.sourceOrganizationId}});
  ensure(source && source.dataMode==="real" && source.purpose==="assessment" && source.name==="KKK","reviewed source organization conflict");
  const campaign=await tx.campaign.findUnique({where:{id:FUND_DEMO_PLAN.sourceCampaignId},include:{assignments:{include:{membership:{include:{user:{select:{id:true,email:true,name:true}}}},attempts:{include:{results:{select:{reason:true,organizationId:true}}}}}}}});
  ensure(campaign && campaign.organizationId===FUND_DEMO_PLAN.sourceOrganizationId && campaign.description===FUND_DEMO_PLAN.sourceCampaignDescription,"reviewed source campaign provenance conflict");
  const assignments=campaign!.assignments;
  ensure(assignments.length===30,"source synthetic provenance requires exact five by six review assignments");
  const seen=new Set<string>();
  for (const a of assignments) {
    const serial=/^report-demo-([1-5])$/.exec(a.membershipId)?.[1];
    ensure(serial && a.membership.userId===`report-demo-${serial}` && a.membership.organizationId===source!.id && a.organizationId===source!.id && a.membership.user.email===`report-demo${serial}@assessflow.local` && a.membership.user.name===`Демо участник ${serial}` && FUND_DEMO_PLAN.testVersionIds.includes(a.testVersionId),"source synthetic provenance/tenant conflict");
    const identity=`${a.membershipId}:${a.testVersionId}`;ensure(!seen.has(identity),"source synthetic provenance duplicate");seen.add(identity);
    ensure(a.attempts.length>0 && a.attempts.every(t=>t.organizationId===source!.id && t.results.length>0 && t.results.every(r=>r.organizationId===source!.id && r.reason===FUND_DEMO_PLAN.sourceFixtureReason)),"source result provenance is not explicitly synthetic");
  }
}
async function loadFixtures(tx: Tx) {
  const versions = await tx.testVersion.findMany({where:{id:{in:FUND_DEMO_PLAN.testVersionIds}},include:{questions:{orderBy:{position:"asc"},include:{options:{orderBy:{position:"asc"}}}},keys:{orderBy:[{createdAt:"desc"},{version:"desc"},{id:"desc"}]}}});
  const forms=FUND_DEMO_PLAN.testVersionIds.map(id=>{
    const v=versions.find(v=>v.id===id), source=catalog.find(f=>`${f.id}-v2`===id)!;
    ensure(v && v.testId===source.id && v.status==="published" && v.version===source.version && v.timeLimitSeconds===source.timeLimitSeconds && v.questions.length===source.questions.length,"published canonical form readiness conflict");
    const key=v!.keys[0];
    const expectedConfig=source.id==="situations" ? buildHoldingScoringKey(source.config as unknown as ScoringConfig,source.questions as QuestionInput[]) : source.config;
    ensure(key && key.version===(source.id==="situations"?HOLDING_MODEL_VERSION:"2.0-preliminary") && key.status==="preliminary" && key.approvedAt===null && key.approvedBy===null && key.algorithm===source.algorithm && sameJsonValue(key.config,expectedConfig),"exact installed preliminary key required; keys will not be installed or modified");
    for (const [i,q] of v!.questions.entries()) {
      const expected=source.questions[i];
      ensure(q.id===expected.id && q.type===expected.type && sameJsonValue(q.options.map(o=>o.id),expected.options.map(o=>o.id)),"canonical question/option-ID order conflict");
    }
    return {version:v!,key,questions:v!.questions as unknown as QuestionInput[]};
  });
  return roster().filter(p=>p.role==="employee").flatMap(person=>forms.map(({version,key,questions})=>{
    const fixture=fundDemoFixture({testId:version.testId,algorithm:key.algorithm,config:key.config as unknown as ScoringConfig,questions,timeLimitSeconds:version.timeLimitSeconds},person.profileRow!,person.sjtTarget!);
    const id=assignmentId(person.membershipId,version.testId);
    // Explicit fixed synthetic sample, never inferred from report generation time.
    const submittedAt=new Date("2026-11-20T12:00:00.000Z"),startedAt=new Date(submittedAt.getTime()-fixture.elapsedMs);
    return {person,version,key,questions,fixture,id,attemptId:attemptId(id),resultId:resultId(attemptId(id)),submittedAt,startedAt};
  }));
}
type Fixtures = Awaited<ReturnType<typeof loadFixtures>>;
async function readTarget(tx: Tx, fixtures: Fixtures) {
  const memberIds=roster().map(p=>p.membershipId),assignmentIds=fixtures.map(f=>f.id),attemptIds=fixtures.map(f=>f.attemptId),resultIds=fixtures.map(f=>f.resultId);
  const organizations=await tx.organization.findMany({where:{OR:[{id:ORG},{slug:ORG}]}});
  const memberships=await tx.membership.findMany({where:{OR:[{organizationId:ORG},{id:{in:memberIds}}]}});
  const campaigns=await tx.campaign.findMany({where:{OR:[{organizationId:ORG},{id:CAMPAIGN}]}});
  const models=await tx.competencyModel.findMany({where:{OR:[{organizationId:ORG},{id:MODEL}]}});
  const assignments=await tx.testAssignment.findMany({where:{OR:[{organizationId:ORG},{campaignId:CAMPAIGN},{id:{in:assignmentIds}},{membershipId:{in:memberIds}}]}});
  const attempts=await tx.testAttempt.findMany({where:{OR:[{organizationId:ORG},{id:{in:attemptIds}},{assignmentId:{in:assignmentIds}}]}});
  const results=await tx.testResult.findMany({where:{OR:[{organizationId:ORG},{id:{in:resultIds}},{attemptId:{in:attemptIds}}]}});
  const answers=await tx.userAnswer.findMany({where:{OR:[{organizationId:ORG},{attemptId:{in:attemptIds}}]}});
  const audits=await tx.auditLog.findMany({where:{OR:[{organizationId:ORG},{action:FUND_DEMO_CREATION_ACTION,entityId:ORG}]}});
  const observations=await tx.expertObservation.count({where:{organizationId:ORG}}), consensus=await tx.competencyConsensus.count({where:{organizationId:ORG}}), exercises=await tx.assessmentExercise.count({where:{organizationId:ORG}});
  return {organizations,memberships,campaigns,models,assignments,attempts,results,answers,audits,observations,consensus,exercises};
}
type Scope = Awaited<ReturnType<typeof readTarget>>;
function verifyExisting(scope: Scope, fixtures: Fixtures) {
  ensure(scope.organizations.length===1 && scope.memberships.length===7 && scope.campaigns.length===1 && scope.models.length===1 && scope.assignments.length===30 && scope.attempts.length===30 && scope.results.length===30 && scope.answers.length===fixtures.reduce((n,f)=>n+f.questions.length,0) && !scope.observations && !scope.consensus && !scope.exercises,"target scope contamination/count mismatch");
  matches(scope.organizations[0],{...FUND_DEMO_PLAN.targetOrganization,employeeLimit:5,assessmentLimit:1000,matrixConfig:J(defaultMatrix)},"target organization conflict");
  const audit=scope.audits.filter(a=>a.action===FUND_DEMO_CREATION_ACTION && a.entityId===ORG);
  ensure(audit.length===1 && audit[0].organizationId===ORG && audit[0].actorId===FUND_DEMO_ACTOR && sameJsonValue(audit[0].detail,creationDetail(fixtures)),"matching creation audit/provenance required; refusing adoption");
  const modelAudit=scope.audits.filter(a=>a.action==="competency.model_created" && a.entityId===MODEL);
  ensure(modelAudit.length===1 && sameJsonValue(modelAudit[0].detail,{synthetic:true,planDigest:fundDemoPlanDigest(FUND_DEMO_PLAN),holdingModelVersion:HOLDING_MODEL_VERSION,methodologicalApproval:false}),"target model creation audit conflict");
  matches(scope.campaigns[0],{...expectedCampaign(),employerPermission:null},"target campaign/sample boundaries conflict");
  matches(scope.models[0],{id:MODEL,organizationId:ORG,version:1,status:"draft",content:J(DEFAULT_COMPETENCIES),authorId:FUND_DEMO_ACTOR,approvedAt:null},"target authoritative model conflict");
  for (const person of roster()) matches(scope.memberships.find(m=>m.id===person.membershipId),membershipData(person),"target profile/member conflict");
  for (const f of fixtures) {
    matches(scope.assignments.find(a=>a.id===f.id),assignmentData(f),"target assignment/expert scope conflict");
    matches(scope.attempts.find(a=>a.id===f.attemptId),attemptData(f),"target attempt fixture conflict");
    matches(scope.results.find(r=>r.id===f.resultId),resultData(f),"target calculated result/provenance conflict");
    for (const q of f.questions) matches(scope.answers.find(a=>a.attemptId===f.attemptId && a.questionId===q.id),answerData(f,q.id),"target generated answer/duration conflict");
  }
}
const membershipData=(p:ReturnType<typeof roster>[number])=>({id:p.membershipId,organizationId:ORG,userId:p.userId,role:p.role,profileRow:p.profileRow,targetLevelModel:p.targetLevelModel??"В",block:p.block??null,position:p.position??"",unit:p.unit??"",category:"Руководитель",status:"active"});
const assignmentData=(f:Fixtures[number])=>({id:f.id,organizationId:ORG,campaignId:CAMPAIGN,membershipId:f.person.membershipId,testVersionId:f.version.id,expertId:"fund-client-demo-expert",assessorIds:["fund-client-demo-expert"]});
const attemptData=(f:Fixtures[number])=>({id:f.attemptId,organizationId:ORG,assignmentId:f.id,attemptNumber:1,scoringKeyId:f.key.id,language:"ru",status:"completed",startedAt:f.startedAt,timerStartedAt:f.startedAt,submittedAt:f.submittedAt,manuallySubmittedAt:f.submittedAt,expiresAt:f.version.timeLimitSeconds?new Date(f.startedAt.getTime()+f.version.timeLimitSeconds*1000):null,departures:0,awayMs:0,extraSeconds:0});
const resultData=(f:Fixtures[number])=>({id:f.resultId,organizationId:ORG,attemptId:f.attemptId,scoringKeyId:f.key.id,reason:FUND_DEMO_RESULT_REASON,calculatedBy:FUND_DEMO_ACTOR,result:J(f.fixture.score)});
const answerData=(f:Fixtures[number],questionId:string)=>({organizationId:ORG,attemptId:f.attemptId,questionId,value:J(f.fixture.answers[questionId]),durationMs:f.fixture.durations[questionId],revision:1,delayed:false,answeredAt:new Date(f.startedAt.getTime()+(f.questions.findIndex(q=>q.id===questionId)+1)*f.fixture.durations[questionId]),receivedAt:f.submittedAt});
const creationDetail=(fixtures:Fixtures)=>({provenance:FUND_DEMO_PROVENANCE,planDigest:fundDemoPlanDigest(FUND_DEMO_PLAN),syntheticParticipants:5,memberships:7,assignments:30,attempts:30,results:30,answerCount:fixtures.reduce((n,f)=>n+f.questions.length,0),profileRows:[1,26,55,56,59],sjtTotals:[15,18,21,24,26],sourceSyntheticCampaignId:FUND_DEMO_PLAN.sourceCampaignId,sourcePreserved:true,identityPresentationConversionAuthorized:true,credentialsChanged:false,consentInvented:false,methodologicalApproval:false});
async function presentationArchives(tx:Tx) {
  return tx.auditLog.findMany({where:{action:"fund.identity_presentation_preserved",entityId:ORG},orderBy:{organizationId:"asc"}});
}
async function verifyPresentationArchives(tx:Tx) {
  const archives=await presentationArchives(tx);
  const organizations=[...new Set(roster().map(p=>p.sourceOrganizationId))].sort();
  ensure(archives.length===organizations.length,"private source presentation archive provenance missing/conflicting");
  for (const sourceOrganizationId of organizations) {
    const rows=archives.filter(a=>a.organizationId===sourceOrganizationId),expectedPeople=roster().filter(p=>p.sourceOrganizationId===sourceOrganizationId).sort((a,b)=>a.userId.localeCompare(b.userId));
    ensure(rows.length===1 && rows[0].actorId===FUND_DEMO_ACTOR,"private source presentation archive conflict");
    const detail=rows[0].detail as any;
    ensure(detail?.planDigest===fundDemoPlanDigest(FUND_DEMO_PLAN) && detail?.purpose==="private_identity_presentation_backup" && Array.isArray(detail?.people) && detail.people.length===expectedPeople.length,"private source presentation archive provenance conflict");
    for (const [i,person] of expectedPeople.entries()) {
      const saved=detail.people[i];
      ensure(saved?.userId===person.userId && typeof saved?.name==="string" && saved.name.length>0 && saved.demoOnly===false && saved.platformAdmin===false && saved.mustChangePassword===false && typeof saved.updatedAt==="string" && Number.isFinite(Date.parse(saved.updatedAt)),"private source presentation archive identity conflict");
    }
  }
}
async function preserveSourcePresentation(tx:Tx) {
  // PRIVATE old-tenant audit only: prior real display names never enter the new tenant.
  for (const organizationId of [...new Set(roster().map(p=>p.sourceOrganizationId))].sort()) {
    const people=[];
    for (const person of roster().filter(p=>p.sourceOrganizationId===organizationId).sort((a,b)=>a.userId.localeCompare(b.userId))) {
      const user=await tx.user.findUniqueOrThrow({where:{id:person.userId},select:{id:true,name:true,demoOnly:true,platformAdmin:true,mustChangePassword:true,updatedAt:true}});
      people.push({userId:user.id,name:user.name,demoOnly:user.demoOnly,platformAdmin:user.platformAdmin,mustChangePassword:user.mustChangePassword,updatedAt:user.updatedAt.toISOString()});
    }
    await tx.auditLog.create({data:{organizationId,actorId:FUND_DEMO_ACTOR,action:"fund.identity_presentation_preserved",entityId:ORG,detail:J({purpose:"private_identity_presentation_backup",planDigest:fundDemoPlanDigest(FUND_DEMO_PLAN),people})}});
  }
}
async function createScope(tx:Tx, fixtures:Fixtures) {
  await preserveSourcePresentation(tx);
  await tx.organization.create({data:{...FUND_DEMO_PLAN.targetOrganization,matrixConfig:J(defaultMatrix),employeeLimit:5,assessmentLimit:1000}});
  await tx.campaign.create({data:expectedCampaign()});
  await tx.competencyModel.create({data:{id:MODEL,organizationId:ORG,version:1,status:"draft",content:J(DEFAULT_COMPETENCIES),authorId:FUND_DEMO_ACTOR,approvedAt:null}});
  await tx.auditLog.create({data:{organizationId:ORG,actorId:FUND_DEMO_ACTOR,action:"competency.model_created",entityId:MODEL,detail:{synthetic:true,planDigest:fundDemoPlanDigest(FUND_DEMO_PLAN),holdingModelVersion:HOLDING_MODEL_VERSION,methodologicalApproval:false}}});
  for (const person of roster()) await tx.membership.create({data:{...membershipData(person),consentAt:null,consentVersion:null}});
  for (const f of fixtures) {
    await tx.testAssignment.create({data:assignmentData(f)});
    await tx.testAttempt.create({data:attemptData(f)});
    await tx.userAnswer.createMany({data:f.questions.map(q=>answerData(f,q.id))});
    await tx.testResult.create({data:resultData(f)});
  }
  await tx.auditLog.create({data:{organizationId:ORG,actorId:FUND_DEMO_ACTOR,action:FUND_DEMO_CREATION_ACTION,entityId:ORG,detail:J(creationDetail(fixtures))}});
  // Last operation: no account/password/session/membership history mutations.
  for (const person of [...roster()].sort((a,b)=>a.userId.localeCompare(b.userId))) await tx.user.update({where:{id:person.userId},data:{demoOnly:true,name:person.name}});
}

/**
 * API: caller injects a PrismaClient bound to env.DATABASE_URL and an exact reviewedPlan.
 * Dry-run is default. Explicit env is required; never reads dotenv or process.env here.
 * Caller must retain a PRIVATE pre-change identity-presentation/credential/history backup.
 * Does not create accounts/passwords, install keys, generate PDFs, or fabricate consent.
 * Readback errors are thrown, including post-commit errors: reconcile before retrying.
 */
export async function prepareFundClientDemo(db:PrismaClient, options:FundDemoOptions, env:Record<string,string|undefined>) {
  assertFundDemoEnvironment(env,options);
  const summary={organizationId:ORG,campaignId:CAMPAIGN,planDigest:fundDemoPlanDigest(FUND_DEMO_PLAN),syntheticParticipants:5,memberships:7,assignments:30,results:30,sjtTotals:[15,18,21,24,26],credentialsChanged:false,reportsGenerated:false,sourcePreserved:true};
  const transactionOptions={maxWait:15000,timeout:120000};
  const action=await db.$transaction(async tx=>{
    await verifyConnection(tx,env,!!options.production);
    await lockCurrentScope(tx);
    const fixtures=await loadFixtures(tx),scope=await readTarget(tx,fixtures);
    const existing=scope.organizations.length>0;
    await verifyIdentities(tx,existing);
    await verifySource(tx);
    if (existing) {verifyExisting(scope,fixtures);await verifyPresentationArchives(tx);return "unchanged" as const;}
    ensure(!(await presentationArchives(tx)).length,"private source presentation archive exists without target; refusing adoption");
    ensure(!scope.memberships.length && !scope.campaigns.length && !scope.models.length && !scope.assignments.length && !scope.attempts.length && !scope.results.length && !scope.answers.length && !scope.audits.length && !scope.observations && !scope.consensus && !scope.exercises,"target namespace contamination without matching creation audit");
    if (!options.apply) return "create" as const;
    await createScope(tx,fixtures);
    await verifyIdentities(tx,true);await verifyPresentationArchives(tx);
    verifyExisting(await readTarget(tx,fixtures),fixtures);
    return "created" as const;
  },transactionOptions);
  // Independent post-commit readback under the same fence, even on unchanged apply.
  if (options.apply) {
    try {await db.$transaction(async tx=>{
      await verifyConnection(tx,env,!!options.production);await lockCurrentScope(tx);
      const fixtures=await loadFixtures(tx);await verifyIdentities(tx,true);await verifyPresentationArchives(tx);verifyExisting(await readTarget(tx,fixtures),fixtures);
    },transactionOptions);} catch {throw Error("Fund demo readback failed; outcome must be reconciled before claiming success");}
  }
  return {...summary,action,dryRun:!options.apply};
}

export async function fundDemoCli(argv:string[],env:Record<string,string|undefined>) {
  const value=(name:string)=>argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
  const allowed=/^--(?:apply|allow-production|allow-identity-presentation-conversion)$|^--(?:source-organization|source-campaign|plan-digest|expected-release-sha)=.+$/;
  if (argv.some(a=>!allowed.test(a)) || new Set(argv.map(a=>a.split("=")[0])).size!==argv.length || value("source-organization")!==FUND_DEMO_PLAN.sourceOrganizationId || value("source-campaign")!==FUND_DEMO_PLAN.sourceCampaignId || value("plan-digest")!==fundDemoPlanDigest(FUND_DEMO_PLAN)) throw Error("Fund demo guard: exact reviewed source scope and plan digest CLI arguments required");
  const options:FundDemoOptions={reviewedPlan:structuredClone(FUND_DEMO_PLAN),apply:argv.includes("--apply"),production:argv.includes("--allow-production"),allowProduction:argv.includes("--allow-production"),allowIdentityPresentationConversion:argv.includes("--allow-identity-presentation-conversion"),expectedReleaseSha:value("expected-release-sha")};
  assertFundDemoEnvironment(env,options); // Must precede runtime DB/provider import.
  const {PrismaClient}=await import("@prisma/client");
  const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
  try {return await prepareFundClientDemo(db,options,env);} finally {await db.$disconnect();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  fundDemoCli(process.argv.slice(2),process.env).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{
    const message=error instanceof Error?error.message:"";
    // Driver errors can contain connection data. Only fixed own-domain messages escape.
    console.error(/^Fund demo (guard|readiness|readback)/.test(message)?message:"Fund demo operation failed; no success claimed; inspect privately and reconcile");process.exitCode=1;
  });
}
