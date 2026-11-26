import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readParticipantSchedule } from "../scripts/import-participant-schedule";

async function withWorkbook(rows: string[][], run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "assessflow-schedule-"));
  try {
    const file = join(dir, "schedule.xlsx");
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("График");
    sheet.addRow(["№", "Блок", "Регион", "Должность", "ФИО", "Электронная почта", "Примечание"]);
    for (const [email, note] of rows) sheet.addRow([1, "", "", "", "Участник", email, note]);
    await book.xlsx.writeFile(file);
    await run(file);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("participant schedules", () => {
  it("uses the confirmed clock time and Kazakhstan zone, regardless of the descriptive label", async () => {
    await withWorkbook([[" Preview@Example.Invalid ", "27.11 до обеда 14:30"]], async file => {
      const [slot] = await readParticipantSchedule(file, 2026);
      expect(slot.email).toBe("preview@example.invalid");
      expect(slot.scheduledAt.toISOString()).toBe("2026-11-27T09:30:00.000Z");
    });
  });
  it("rejects duplicate addresses even if their case differs", async () => {
    await withWorkbook([["a@example.invalid", "27.11 10:00"], ["A@example.invalid", "30.11 10:00"]], async file => {
      await expect(readParticipantSchedule(file, 2026)).rejects.toThrow("row 3");
    });
  });
  it.each(["31.11 10:00", "27.11 24:30", "27.11 до обеда"])("rejects an ambiguous or invalid slot %s", async note => {
    await withWorkbook([["a@example.invalid", note]], async file => {
      await expect(readParticipantSchedule(file, 2026)).rejects.toThrow("row 2");
    });
  });
});
