/**
 * microservice-__name__ HTTP server (standalone mode).
 *
 * Starts a Bun HTTP server exposing the REST API.
 * Called via: microservice-__name__ serve [--port 3000]
 *
 * Env:
 *   DATABASE_URL  — required
 *   __NAME___PORT     — optional, default 3000
 */

import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { router } from "./routes.js";

export async function startServer(port: number = 3000): Promise<void> {
  const sql = getDb();
  await migrate(sql);

  const server = Bun.serve({
    port,
    fetch: router,
  });

  console.log(
    `microservice-__name__ listening on http://localhost:${server.port}`,
  );
}
