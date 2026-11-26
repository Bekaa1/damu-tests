import ExcelJS from "exceljs";
import { pathToFileURL } from "node:url";
import { db } from "../apps/api/src/db";

export async function readParticipantSchedule(file: string, year: number) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  const sheet = book.worksheets.find(s => s.getCell("F1").text.trim() === "Электронная почта" && s.getCell("G1").text.trim() === "Примечание");
  if (!sheet || !Number.isInteger(year) || year < 2000 || year > 2099) throw Error("Expected an AssessFlow schedule and a four-digit year");
  const slots: { rowNumber: number; email: string; scheduledAt: Date }[] = [];
  const emails = new Set<string>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const email = row.getCell(6).text.trim().toLowerCase();
    const note = row.getCell(7).text.trim();
    if (!email && !note && !row.getCell(5).text.trim()) return;
    const match = note.match(/^(\d{1,2})\.(\d{1,2})\s+[^\d]*(\d{1,2}):(\d{2})\s*$/u);
    if (!match || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || emails.has(email)) throw Error("Invalid or duplicate schedule at row " + rowNumber);
    const [, day, month, hour, minute] = match.map(Number);
    const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || hour > 23 || minute > 59)
      throw Error("Invalid date/time at row " + rowNumber);
    // The confirmed clock time in the workbook is Kazakhstan time (UTC+5).
    slots.push({ rowNumber, email, scheduledAt: new Date(local.getTime() - 5 * 3_600_000) });
    emails.add(email);
  });
  if (!slots.length) throw Error("The schedule is empty");
  return slots;
}

export async function importParticipantSchedule(file: string, organizationId: string, campaignId: string, year: number, apply: boolean) {
  const slots = await readParticipantSchedule(file, year);
  return db.$transaction(async tx => {
    await tx.campaign.findFirstOrThrow({ where: { id: campaignId, organizationId, status: "active" }, select: { id: true } });
    const members = await tx.membership.findMany({
      where: { organizationId, role: "employee", status: "active", assignments: { some: { campaignId } },
        user: { email: { in: slots.map(s => s.email), mode: "insensitive" } } },
      select: { id: true, user: { select: { email: true } } },
    });
    const ids = new Map(members.map(m => [m.user.email.trim().toLowerCase(), m.id]));
    const missing = slots.filter(s => !ids.has(s.email));
    if (missing.length || ids.size !== members.length)
      throw Error("Cannot uniquely match all participants. Check rows: " + missing.map(s => s.rowNumber).join(", "));
    let changed = 0;
    if (apply) {
      for (const slot of slots) {
        changed += await tx.$executeRaw`
          INSERT INTO participant_schedules ("membershipId", "campaignId", "organizationId", "scheduledAt")
          VALUES (${ids.get(slot.email)!}, ${campaignId}, ${organizationId}, ${slot.scheduledAt})
          ON CONFLICT ("membershipId","campaignId") DO UPDATE
          SET "scheduledAt" = EXCLUDED."scheduledAt", "acknowledgedAt" = NULL, revision = participant_schedules.revision + 1
          WHERE participant_schedules."scheduledAt" <> EXCLUDED."scheduledAt"
        `;
      }
    }
    return { matched: slots.length, applied: apply, changed };
  }, { timeout: 30_000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, org, campaign, year, flag, ...rest] = process.argv.slice(2);
  if (!file || !org || !campaign || !year || rest.length || (flag && !["--apply", "--dry-run"].includes(flag)))
    throw Error("Usage: import-participant-schedule <xlsx> <organization-id> <campaign-id> <year> [--dry-run|--apply]");
  try { console.log(await importParticipantSchedule(file, org, campaign, Number(year), flag === "--apply")); }
  finally { await db.$disconnect(); }
}
