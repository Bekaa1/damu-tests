import { calculateScore } from "../packages/core/scoring";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  answerWithinWindow,
  displayAttemptStatus,
  TEST_LIMITS,
  questionCountText,
} from "../packages/core/assessment-policy";
import {
  DEFAULT_COMPETENCIES,
  competencyModelSchema,
  exerciseCriteria,
  latestAssessorObservations,
} from "../packages/core/competencies";
describe("Assessment delivery policy", () => {
  it("does not label an empty active attempt as answered", () => {
    expect(
      displayAttemptStatus({ status: "in_progress", _count: { answers: 0 } }),
    ).toBe("not_started");
    expect(
      displayAttemptStatus({ status: "in_progress", _count: { answers: 1 } }),
    ).toBe("in_progress");
    expect(
      displayAttemptStatus({ status: "completed", _count: { answers: 0 } }),
    ).toBe("completed");
  });
  it("accepts delayed pre-deadline answers without imposing a delivery grace period", () => {
    const start = new Date("2026-11-17T10:00:00Z"),
      end = new Date("2026-11-17T10:25:00Z");
    expect(
      answerWithinWindow(
        new Date("2026-11-17T10:24:59Z"),
        start,
        end,
        new Date("2026-11-18T10:00:00Z"),
      ),
    ).toBe(true);
    expect(
      answerWithinWindow(
        new Date("2026-11-17T10:25:01Z"),
        start,
        end,
        new Date("2026-11-18T10:00:00Z"),
      ),
    ).toBe(false);
    expect(
      answerWithinWindow(
        new Date("2026-11-17T09:59:59Z"),
        start,
        end,
        new Date("2026-11-18T10:00:00Z"),
      ),
    ).toBe(false);
  });
  it("can still interpret historical questionnaire timeouts with missing values", () => {
    const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
    for (const id of ["personality", "motivation"]) {
      const form = catalog.find((f: any) => f.id === id);
      const score = calculateScore(
        form.algorithm,
        form.config,
        form.questions,
        {},
        { allowMissing: true },
      );
      expect(Object.values(score.scales!).every((s) => s.mean === 0)).toBe(
        true,
      );
      expect(score.answered).toBe(0);
    }
  });
  it("keeps canonical limits consistent with all six published source forms", () => {
    for (const form of JSON.parse(readFileSync("data/catalog.json", "utf8")))
      expect(form.timeLimitSeconds).toBe(TEST_LIMITS[form.id]);
  });
  it("formats Russian task counts including the teen exceptions", () => {
    for (const [count, label] of [
      [1, "1 задание"],
      [2, "2 задания"],
      [24, "24 задания"],
      [11, "11 заданий"],
      [14, "14 заданий"],
      [21, "21 задание"],
      [126, "126 заданий"],
    ] as const)
      expect(questionCountText(count, "ru")).toBe(label);
    expect(questionCountText(24, "kk")).toBe("24 тапсырма");
  });
});
describe("Competency model", () => {
  it("provides eight Holding competencies, 65 nullable profile targets and exercise criteria", () => {
    const config = competencyModelSchema.parse(DEFAULT_COMPETENCIES);
    expect(config.competencies).toHaveLength(8);
    for (const c of config.competencies) {
      expect(c.indicators.length).toBeGreaterThanOrEqual(3);
      expect(
        new Set(c.sources.map((s) => `${s.kind}:${s.id}`)).size,
      ).toBeGreaterThanOrEqual(2);
    }
    expect(config.roles).toHaveLength(65);
    expect(config.roles.every(r=>Object.values(r.targets).every(target=>target===null))).toBe(true);
    const roleplay = exerciseCriteria(config, "roleplay");
    expect(roleplay).toHaveLength(24);
    expect(roleplay.some((c) => c.competencyId === "C1")).toBe(true);
    expect(roleplay.some((c) => c.competencyId === "C8")).toBe(true);
  });
  it("preserves different assessors and keeps only each assessor's latest version", () => {
    const rows = [
      {
        expertId: "one",
        exerciseId: "roleplay",
        criteriaSnapshot: {},
        version: 2,
      },
      {
        expertId: "two",
        exerciseId: "roleplay",
        criteriaSnapshot: {},
        version: 1,
      },
      {
        expertId: "one",
        exerciseId: "roleplay",
        criteriaSnapshot: {},
        version: 1,
      },
    ];
    expect(latestAssessorObservations(rows)).toEqual(rows.slice(0, 2));
  });
});
