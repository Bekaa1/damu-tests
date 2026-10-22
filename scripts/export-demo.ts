import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
if (process.env.DEMO_MODE !== "true")
  throw new Error("This check is only available in the local demo");
const origin = process.env.APP_URL || "http://localhost:3000";
const login = await fetch(origin + "/api/auth/sign-in/email", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "admin@assessflow.local",
    password: process.env.SEED_PASSWORD || "AssessFlow!2026",
  }),
});
assert(login.ok, "Demo authentication failed");
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const peopleResponse = await fetch(
  origin + "/api/people?campaignId=demo-campaign",
  { headers: { Cookie: cookie } },
);
assert(peopleResponse.ok);
const people = (await peopleResponse.json()) as any[];
assert.equal(people.filter((p) => p.role === "employee").length, 65);
const pdf = await fetch(origin + "/api/export/team?campaignId=demo-campaign", {
  headers: { Cookie: cookie },
});
assert(pdf.ok);
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/assessflow-team-65.pdf",
  Buffer.from(await pdf.arrayBuffer()),
);
console.log("Verified: 65 demo participants and a full team PDF.");
