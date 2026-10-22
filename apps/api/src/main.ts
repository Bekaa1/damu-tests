import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import {
  Module,
  Catch,
  HttpException,
  type ExceptionFilter,
  type ArgumentsHost,
} from "@nestjs/common";
import { toNodeHandler } from "better-auth/node";
import express from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { auth } from "./auth";
import { AppController } from "./controller";
import { db } from "./db";
import { startAiWorker, aiQueue } from "./ai";
@Catch()
class ApiErrors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = 500,
      message = "Не удалось выполнить запрос. Повторите попытку.";
    if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.message;
    } else if (error instanceof ZodError) {
      status = 400;
      message = error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } else if (error.code === "P2002") {
      status = 409;
      message = "Такая запись уже существует";
    } else if (error.code === "P2025") {
      status = 404;
      message = "Запись не найдена";
    } else console.error(error);
    res.status(status).json({ message, status });
  }
}
@Module({ controllers: [AppController] })
class AppModule {}
if (
  process.env.NODE_ENV === "production" &&
  (process.env.DEMO_MODE === "true" ||
    (await db.organization.findUnique({ where: { id: "demo-organization" } })))
)
  throw new Error(
    "Production requires a clean database without demonstration accounts.",
  );
const app = await NestFactory.create(AppModule, {
  bodyParser: false,
  logger: ["error", "warn", "log"],
});
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
  }),
);
app.getHttpAdapter().get("/api/health", async (_req: any, res: any) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "database_unavailable" });
  }
});
app
  .getHttpAdapter()
  .get("/api/public-config", (_req: any, res: any) =>
    res.json({ demo: process.env.DEMO_MODE === "true" }),
  );
app.getHttpAdapter().all("/api/auth/{*path}", toNodeHandler(auth));
app.use(express.json({ limit: "12mb" }));
app.use((req: any, res: any, next: any) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.useGlobalFilters(new ApiErrors());
const worker = startAiWorker();
await app.listen(Number(process.env.API_PORT || 4000), "0.0.0.0");
console.log("AssessFlow API ready on port " + (process.env.API_PORT || 4000));
async function shutdown() {
  await worker.close();
  await aiQueue.close();
  await app.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
