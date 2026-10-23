export function trustedOrigins() {
  const candidates = [
    process.env.APP_URL || "http://localhost:3000",
    ...(process.env.TRUSTED_ORIGINS || "").split(","),
  ];

  return [
    ...new Set(
      candidates.flatMap((candidate) => {
        try {
          return [new URL(candidate.trim()).origin];
        } catch {
          return [];
        }
      }),
    ),
  ];
}

export function isTrustedOrigin(origin?: string) {
  if (!origin) return false;

  try {
    return trustedOrigins().includes(new URL(origin).origin);
  } catch {
    return false;
  }
}
