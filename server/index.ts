import "dotenv/config";
import { createApplication } from "./app";
import { db } from "./db";
const { http, io } = createApplication();
const port = Number(process.env.PORT || 4100);
http.listen(port, "127.0.0.1", () =>
  console.log(`DevTrack server: http://127.0.0.1:${port}`),
);
async function shutdown() {
  io.close();
  http.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
