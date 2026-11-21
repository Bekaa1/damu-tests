import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CONSENT_TEXT, CONSENT_VERSION } from "../packages/core/assessment-policy";
import { participantDeletionDate } from "../packages/core/data-policy";
import { consentPolicy } from "../packages/core/pilot";

// Execute the current real consent handler body without loading unrelated
// controller imports (auth, Prisma, queues or external providers).
function consentHandler(db: any) {
  const path = "apps/api/src/controller.ts";
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  let body: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === "consent") body = node.body?.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!body) throw Error("Current consent handler not found");
  const code = ts.transpileModule(`export async function consent(req: any, body: unknown) ${body}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  runInNewContext(code, {
    exports, z, db, Date, createHash, consentPolicy, participantDeletionDate,
    BadRequestException: class extends Error {},
    orgId: (ctx: any) => ctx.org.id,
  });
  return exports.consent as (req: any, body: unknown) => Promise<unknown>;
}

const request = () => ({ ctx: {
  org: { id: "synthetic-org", purpose: "assessment" }, user: { id: "synthetic-user", locale: "ru" },
  member: { id: "synthetic-membership", role: "employee", createdAt: new Date("2026-11-30T10:15:30.123Z") },
} });
function database() {
  const db: any = {
    membership: { update: vi.fn(async (query: any) => query.data) },
    auditLog: { create: vi.fn(async (query: any) => query.data) },
  };
  db.$transaction = vi.fn(async (operation: any) => operation(db));
  return db;
}

describe("new plain consent version through the unchanged real controller", () => {
  it.each([
    { accepted: true, version: "assessment-2026-11-21-retention" },
    { accepted: false, version: CONSENT_VERSION },
    { accepted: true, version: "" },
    { accepted: true },
  ])("rejects stale/missing versions or non-acceptance before any write: %j", async body => {
    const db = database();
    await expect(consentHandler(db)(request(), body)).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.membership.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("persists only explicit new acceptance and its exact text/hash, without moving the registration deadline", async () => {
    const db = database(), req = request(), registration = req.ctx.member.createdAt.toISOString();
    expect(await consentHandler(db)(req, { accepted: true, version: CONSENT_VERSION })).toEqual({ ok: true });
    expect(db.membership.update).toHaveBeenCalledTimes(1);
    const mutation = db.membership.update.mock.calls[0][0];
    expect(mutation.where).toEqual({ id: "synthetic-membership" });
    expect(Object.keys(mutation.data).sort()).toEqual(["consentAt", "consentVersion"]);
    expect(mutation.data.consentVersion).toBe(CONSENT_VERSION);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = db.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: "consent.accepted", entityId: "synthetic-membership" });
    expect(audit.detail).toMatchObject({
      version: CONSENT_VERSION, text: CONSENT_TEXT,
      textHash: createHash("sha256").update(JSON.stringify(CONSENT_TEXT)).digest("hex"),
      deletionDueAt: "2027-02-28T10:15:30.123Z",
    });
    expect(req.ctx.member.createdAt.toISOString()).toBe(registration);
  });
});
