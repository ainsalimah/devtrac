import "dotenv/config";
import { execFileSync } from "node:child_process";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("E2E requires a dedicated *_test database.");
process.env.DATABASE_URL = url;
process.env.PORT = "4201";
process.env.APP_ORIGIN = "http://127.0.0.1:4201";
process.env.COOKIE_SECURE = "false";
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { env: process.env, stdio: "inherit" },
);
const { db } = await import("../server/db");
for (const table of [
  "Review",
  "Submission",
  "Comment",
  "ChecklistItem",
  "Activity",
  "Task",
  "ProjectMember",
  "Project",
  "Session",
  "Invitation",
  "User",
])
  await db.$executeRawUnsafe(`DELETE FROM "${table}"`);
execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
  env: process.env,
  stdio: "inherit",
});
const { http } = (await import("../server/app")).createApplication();
http.listen(4201, "127.0.0.1", () => console.log("E2E workspace ready."));
