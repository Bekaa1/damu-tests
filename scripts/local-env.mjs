import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
const path = ".env";
let env = existsSync(path)
  ? readFileSync(path, "utf8")
  : readFileSync(".env.example", "utf8");
if (
  !/^BETTER_AUTH_SECRET=.{32,}$/m.test(env) ||
  env.includes("replace-with-a-random-secret")
)
  env = env.replace(
    /^BETTER_AUTH_SECRET=.*$/m,
    `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
  );
writeFileSync(path, env);
console.log("Local environment is ready. Secrets were not printed.");
