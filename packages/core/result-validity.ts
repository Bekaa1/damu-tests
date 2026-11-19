import {
  validateAnswer,
  type QuestionInput,
  type ScoringConfig,
} from "./scoring";

export const COMPLETION_POLICY = "2026-11-19";

/** Only complete, valid responses count: an SJT pair and all six priority cards. */
export function assessmentCompletion(
  questions: QuestionInput[],
  answers: Record<string, unknown>,
  config: ScoringConfig,
  requireAll: boolean,
) {
  const answered = questions.filter((q) => {
    if (!(q.id in answers)) return false;
    try {
      const value = validateAnswer(q, answers[q.id], config) as any;
      if (q.type === "sjt") return Boolean(value.most && value.least);
      if (q.type === "ranking")
        return value.top.length === 3 && value.bottom.length === 3;
      return true;
    } catch {
      return false;
    }
  }).length;
  const required = requireAll
    ? questions.length
    : Math.ceil(questions.length * 0.8);
  return {
    policy: COMPLETION_POLICY,
    answered,
    total: questions.length,
    required,
    eligible: questions.length > 0 && answered >= required,
  };
}

export function usableScore(score: any): boolean {
  return Boolean(
    score && score.validity?.eligible !== false && !score.excluded,
  );
}

export function usableAttempt(attempt: any): boolean {
  return (
    attempt?.status === "completed" && usableScore(attempt.results?.[0]?.result)
  );
}
