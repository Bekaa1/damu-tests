import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "../apps/api/src/secrets";
import { aiContentSchema } from "../packages/core/contracts";
process.env.SETTINGS_ENCRYPTION_KEY = "unit-test-key-not-for-production-123456";
describe("Защита настроек и контракт AI", () => {
  it("шифрует ключ с уникальным nonce и восстанавливает исходное значение", () => {
    const key = "sk-test-not-a-real-key",
      a = encryptSecret(key),
      b = encryptSecret(key);
    expect(a).not.toContain(key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(key);
  });
  it("отклоняет повреждённый шифротекст", () => {
    const parts = encryptSecret("test").split(".");
    parts[1] = Buffer.alloc(16).toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
  it("не принимает AI-вывод без измеренного основания", () => {
    expect(() =>
      aiContentSchema.parse({
        generalProfile: [{ text: "Необоснованный вывод", evidenceIds: [] }],
        analyticalAbilities: [],
        personality: [],
        motivation: [],
        situations: [],
        strengths: [],
        developmentAreas: [],
        recommendations: [],
        limitations: ["Нет норм"],
      }),
    ).toThrow();
  });
});
