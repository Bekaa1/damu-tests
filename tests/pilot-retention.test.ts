import { describe, it, expect } from "vitest";
import { pilotDeletionDate, pilotDataExpired } from "../packages/core/pilot";
import { clearExpiredPilotCache } from "../packages/core/pilot-cache";

describe("pilot retention", () => {
  it.each([
    ["2026-11-20T10:15:30Z","2027-02-20T10:15:30.000Z"],
    ["2026-11-30T10:15:30Z","2027-02-28T10:15:30.000Z"],
    ["2027-11-30T10:15:30Z","2028-02-29T10:15:30.000Z"],
    ["2026-01-31T10:15:30Z","2026-04-30T10:15:30.000Z"],
  ])("uses calendar months: %s", (date, expected) => {
    expect(pilotDeletionDate(date).toISOString()).toBe(expected);
  });
  it("expires exactly at the deadline and never expires staff or assessment participants", () => {
    const member={role:"employee",createdAt:"2026-11-20T10:15:30Z"};
    const deadline=pilotDeletionDate(member.createdAt);
    expect(pilotDataExpired(member,{purpose:"pilot"},new Date(+deadline-1))).toBe(false);
    expect(pilotDataExpired(member,{purpose:"pilot"},deadline)).toBe(true);
    expect(pilotDataExpired(member,{purpose:"assessment"},deadline)).toBe(false);
    expect(pilotDataExpired({...member,role:"admin"},{purpose:"pilot"},deadline)).toBe(false);
    expect(pilotDataExpired({...member,role:"expert"},{purpose:"pilot"},deadline)).toBe(false);
  });
  it("clears expired pilot offline answers and session, preserving other organizations", () => {
    const now=new Date("2027-03-01T00:00:00Z");
    const values=new Map<string,string>([
      ["assessflow.offline-session",JSON.stringify({session:{member:{role:"employee",createdAt:"2026-11-20T00:00:00Z"},organization:{purpose:"pilot"}},campaigns:[{id:"pilot"}]})],
      ["assessflow.cached.old",JSON.stringify({campaignId:"pilot",dataDeletionAt:"2027-02-20T00:00:00Z"})],
      ["assessflow.answers.old","private answers"],["assessflow.presence.old","private events"],
      ["assessflow.cached.keep",JSON.stringify({campaignId:"assessment"})],["assessflow.answers.keep","keep answers"],
    ]);
    clearExpiredPilotCache({get length(){return values.size},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,removeItem:k=>{values.delete(k)}},now);
    expect([...values.keys()]).toEqual(["assessflow.cached.keep","assessflow.answers.keep"]);
  });
});
