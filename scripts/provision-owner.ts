import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
const db = new PrismaClient();
const email = process.env.OWNER_EMAIL?.trim().toLowerCase(),
  password = process.env.OWNER_PASSWORD;
if (!email || !email.includes("@") || !password || password.length < 16)
  throw new Error(
    "Set OWNER_EMAIL and OWNER_PASSWORD (at least 16 characters) in a protected environment.",
  );
try {
  if (await db.user.findUnique({ where: { email } }))
    throw new Error(
      "User already exists. Provisioning never overwrites credentials.",
    );
  const hash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: process.env.OWNER_NAME || "Владелец платформы",
        emailVerified: true,
        platformAdmin: true,
        mustChangePassword: true,
      },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hash,
      },
    });
  });
  console.log(
    "Owner account created. Sign in and change the temporary password.",
  );
} finally {
  await db.$disconnect();
}
