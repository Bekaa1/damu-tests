import type { QuestionInput } from "./scoring";

export function responseQuality(
  questions: QuestionInput[],
  answers: Record<string, unknown>,
  durations: Record<string, number> = {},
) {
  let fastAnswers = 0,
    timedAnswers = 0,
    longestRun = 0,
    run = 0;
  let previous: string | undefined;
  for (const q of questions) {
    const value: any = answers[q.id];
    const ms = durations[q.id];
    // Zero is also used for historical answers without timing telemetry.
    if (value !== undefined && Number.isFinite(ms) && ms > 0) {
      timedAnswers++;
      if (ms < 2000) fastAnswers++;
    }
    let signature: string | undefined;
    if (value !== undefined && value !== null) {
      if (q.type === "scale") signature = `scale:${value}`;
      else if (["single", "image"].includes(q.type)) {
        const index = q.options.findIndex((o) => o.id === value);
        if (index >= 0) signature = `${q.type}:${index}`;
      }
    }
    run = signature === undefined ? 0 : signature === previous ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
    previous = signature;
  }
  return {
    fastAnswers,
    timedAnswers,
    fastThresholdMs: 2000,
    longestRun,
    runThreshold: 10,
  };
}
