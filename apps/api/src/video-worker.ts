import "dotenv/config";
import { db } from "./db";
import { startVideoConversion } from "./video-mp4";

await db.$connect();
const stopConversion = startVideoConversion();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await stopConversion();
  await db.$disconnect();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
