import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
if (process.env.DEMO_MODE !== "true") throw new Error("Sample generation is only available in the local demo");
const origin = process.env.APP_URL || "http://localhost:3000";
const language = process.argv.includes("--language=kk") ? "kk" : "ru";
const kinds = process.argv.includes("--kind=individual") ? ["individual"] : process.argv.includes("--kind=team") ? ["team"] : ["individual", "team"];
const auth = await fetch(origin + "/api/auth/sign-in/email", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@assessflow.local", password: process.env.SEED_PASSWORD || "AssessFlow!2026" }),
});
assert(auth.ok, "Demo authentication failed");
const cookie = auth.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "x-organization-id": "demo-organization" };
async function request(path: string, body?: unknown) {
  const response = await fetch(origin + "/api" + path, { headers, method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(response.status + " " + await response.text());
  return response.json();
}
const people = await request("/people?campaignId=demo-campaign");
const person = people.find((p: any) => p.role === "employee" && p.status === "completed");
assert(person, "A completed local demo participant is required");
await mkdir("output/pdf", { recursive: true });
for (const kind of kinds) {
  const row = await request("/generated-reports", { campaignId: "demo-campaign", kind, language, ...(kind === "individual" ? { membershipId: person.id } : {}) });
  console.log(kind + ": " + row.status + " (" + row.id + ")");
  let status = row;
  const deadline = Date.now() + 12 * 60_000;
  let lastStatus = "";
  while (status.status !== "completed" && Date.now() < deadline) {
    if (status.status === "failed") throw new Error(kind + ": " + status.error);
    await new Promise(resolve => setTimeout(resolve, 4000));
    const rows = await request("/generated-reports?campaignId=demo-campaign&kind=" + kind);
    status = rows.find((r: any) => r.id === row.id);
    assert(status, "Report disappeared");
    if (lastStatus !== status.status) { console.log(kind + ": " + status.status); lastStatus = status.status; }
  }
  assert.equal(status.status, "completed", "Generation timed out");
  const pdf = await fetch(origin + "/api/generated-reports/" + row.id + "/pdf", { headers });
  assert(pdf.ok, "PDF rendering failed");
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0,4).toString(), "%PDF");
  const filename = "output/pdf/assessflow-" + kind + "-" + language + ".pdf";
  await writeFile(filename, bytes);
  console.log("Saved " + filename + " (" + bytes.length + " bytes)");
}
