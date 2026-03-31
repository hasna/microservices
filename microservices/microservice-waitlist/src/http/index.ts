/**
 * microservice-waitlist HTTP server (standalone mode).
 *
 * Starts a Bun HTTP server exposing the REST API.
 * Called via: microservice-waitlist serve [--port 3015]
 *
 * Env:
 *   DATABASE_URL      — required
 *   WAITLIST_PORT     — optional, default 3015
 */

import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { makeRouter } from "./routes.js";

export async function startServer(port: number = 3015): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const router = makeRouter(sql);

  const server = Bun.serve({ port, fetch: router });
  console.log(`microservice-waitlist listening on http://localhost:${server.port}`);
}
