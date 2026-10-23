import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";
import { createHash } from "node:crypto";
import { trustedOrigins } from "./origins";
if (
  !process.env.BETTER_AUTH_SECRET ||
  process.env.BETTER_AUTH_SECRET.length < 32
)
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  baseURL: process.env.APP_URL || "http://localhost:3000",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 30,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 300,
    customRules: { "/sign-in/email": { window: 60, max: 100 } },
  },
  plugins: [
    {
      id: "account-login-limit",
      onRequest: async (request) => {
        if (
          request.method !== "POST" ||
          !new URL(request.url).pathname.endsWith("/sign-in/email")
        )
          return;
        const body = await request
          .clone()
          .json()
          .catch(() => ({}));
        const email =
          typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const key =
          "login-account:" + createHash("sha256").update(email).digest("hex");
        const allowed = await db.$transaction(async (tx) => {
          await tx.rateLimit.upsert({
            where: { key },
            create: { key, count: 0, lastRequest: BigInt(Date.now()) },
            update: {},
          });
          await tx.$queryRaw`SELECT id FROM rate_limits WHERE key = ${key} FOR UPDATE`;
          const row = await tx.rateLimit.findUniqueOrThrow({ where: { key } }),
            now = Date.now();
          const expired = now - Number(row.lastRequest) >= 900000;
          if (!expired && row.count >= 8) return false;
          await tx.rateLimit.update({
            where: { key },
            data: {
              count: expired ? 1 : row.count + 1,
              lastRequest: expired ? BigInt(now) : row.lastRequest,
            },
          });
          return true;
        });
        if (!allowed)
          return {
            response: Response.json(
              {
                message:
                  "Слишком много попыток входа. Повторите через 15 минут.",
              },
              { status: 429, headers: { "Retry-After": "900" } },
            ),
          };
      },
    },
  ],
  advanced: {
    cookiePrefix: "assessflow-admin",
    ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    useSecureCookies: process.env.APP_URL?.startsWith("https://") ?? false,
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
  },
  user: {
    additionalFields: {
      mustChangePassword: { type: "boolean", defaultValue: true, input: false },
      platformAdmin: { type: "boolean", defaultValue: false, input: false },
      locale: { type: "string", defaultValue: "ru", input: false },
    },
  },
});
