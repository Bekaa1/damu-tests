import { afterEach, describe, expect, it } from "vitest";
import { isTrustedOrigin, trustedOrigins } from "../apps/api/src/origins";

describe("trusted application origins", () => {
  const originalAppUrl = process.env.APP_URL;
  const originalTrustedOrigins = process.env.TRUSTED_ORIGINS;

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    if (originalTrustedOrigins === undefined)
      delete process.env.TRUSTED_ORIGINS;
    else process.env.TRUSTED_ORIGINS = originalTrustedOrigins;
  });

  it("accepts configured aliases and rejects unrelated or missing origins", () => {
    process.env.APP_URL = "https://edukz.duckdns.org/";
    process.env.TRUSTED_ORIGINS =
      "https://secondary.assessflow.test, https://edukz.duckdns.org/extra";

    expect(trustedOrigins()).toEqual([
      "https://edukz.duckdns.org",
      "https://secondary.assessflow.test",
    ]);
    expect(isTrustedOrigin("https://edukz.duckdns.org")).toBe(true);
    expect(isTrustedOrigin("https://secondary.assessflow.test")).toBe(true);
    expect(isTrustedOrigin("https://untrusted.example")).toBe(false);
    expect(isTrustedOrigin()).toBe(false);
  });
});
