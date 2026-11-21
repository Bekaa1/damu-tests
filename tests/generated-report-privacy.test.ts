import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked=vi.hoisted(()=>({
  fallback:vi.fn(), findReport:vi.fn(),findOrg:vi.fn(),update:vi.fn(),settings:vi.fn(),add:vi.fn(),fetch:vi.fn(), members:vi.fn(), campaign:vi.fn(),
}));
vi.mock("../apps/api/src/db",()=>({
  db:{generatedReport:{findUnique:mocked.findReport,updateMany:mocked.update},organization:{findUnique:mocked.findOrg},platformSettings:{findUnique:mocked.settings},membership:{findMany:mocked.members},campaign:{findFirst:mocked.campaign}},
  audit:vi.fn(),json:(x:any)=>x,
}));
vi.mock("../apps/api/src/access",()=>({orgId:(ctx:any)=>ctx.org?.id,requireRole:vi.fn(),participant:vi.fn()}));
vi.mock("bullmq",()=>({Queue:class{on(){} add=mocked.add;},Worker:class{on(){}}}));
vi.mock("../apps/api/src/report-lifecycle",()=>({persistReportPdf:vi.fn(),makeFallbackAvailable:mocked.fallback}));
vi.mock("../packages/core/data-policy",async(importOriginal)=>({...await importOriginal<any>(),externalAiAllowed:()=>false}));
import {generateReport} from "../apps/api/src/generated-reports";

describe("Generated PDF worker does not send unapproved participant data",()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  mocked.findReport.mockResolvedValue({id:"report",organizationId:"org",campaignId:"campaign",membershipId:"synthetic-subject",participantIds:["synthetic-subject"],kind:"individual",snapshot:{campaign:{id:"campaign"},people:[{id:"synthetic-subject"}]},status:"pending",generationMode:"ai"});
  mocked.findOrg.mockResolvedValue({id:"org",purpose:"assessment",status:"active",dataMode:"real"});
  mocked.campaign.mockResolvedValue({id:"campaign"});
  mocked.members.mockResolvedValue([{id:"synthetic-subject",organizationId:"org",userId:"synthetic-user",role:"employee",status:"active",createdAt:new Date(),user:{id:"synthetic-user",platformAdmin:false}}]);
  mocked.fallback.mockResolvedValue(undefined);
  mocked.update.mockResolvedValue({count:1});
  mocked.settings.mockImplementation(()=>{throw Error("Provider settings accessed before privacy decision");});
  vi.stubGlobal("fetch",mocked.fetch);
 });
 it("converts a previously queued real-organization job to local data rendering before touching a provider",async()=>{
  await generateReport("report");
  expect(mocked.fallback).toHaveBeenCalledWith("report");
  expect(mocked.settings).not.toHaveBeenCalled();expect(mocked.fetch).not.toHaveBeenCalled();
 });
 it("does not generate even a local PDF for the purpose-restricted pilot",async()=>{
  mocked.findOrg.mockResolvedValue({id:"org",purpose:"pilot"});
  await generateReport("report");
  expect(mocked.fallback).not.toHaveBeenCalled();expect(mocked.settings).not.toHaveBeenCalled();expect(mocked.fetch).not.toHaveBeenCalled();
  expect(mocked.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"failed"})}));
 });
 it("does not contact a provider for an orphaned organization",async()=>{
  mocked.findOrg.mockResolvedValue(null);
  await generateReport("report");
  expect(mocked.fetch).not.toHaveBeenCalled();expect(mocked.settings).not.toHaveBeenCalled();
 });
});
