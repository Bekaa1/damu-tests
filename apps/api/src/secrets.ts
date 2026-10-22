import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
function key() {
  const secret =
    process.env.SETTINGS_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Settings encryption key is not configured");
  return createHash("sha256").update(secret).digest();
}
export function encryptSecret(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decryptSecret(value: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
export function openRouterKey(
  settings: { encryptedApiKey?: string | null } | null,
) {
  return settings?.encryptedApiKey
    ? decryptSecret(settings.encryptedApiKey)
    : process.env.OPENROUTER_API_KEY || "";
}
