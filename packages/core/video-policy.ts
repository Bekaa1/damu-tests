export const videoConsentVersion = "damu-video-2026-11-26-v2";

export function videoExpiry(end: Date) {
  const expiry = new Date(end);
  const day = expiry.getUTCDate();
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + 4, 0);
  expiry.setUTCDate(Math.min(day, expiry.getUTCDate()));
  return expiry;
}

export { videoConsentText } from "./video-consent-text";
