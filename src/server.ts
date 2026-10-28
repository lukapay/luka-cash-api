import { serve } from "@hono/node-server";
import { app } from "./app";
import { PORT } from "./config";
import { closeDb } from "./db";

const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (i) => {
  console.log(`luka-cash-api escuchando en 127.0.0.1:${i.port}`);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  });
}
