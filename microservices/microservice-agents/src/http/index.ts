import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { markStaleAgents } from "../lib/health.js";
import { makeRouter } from "./routes.js";

export async function startServer(port = 3020): Promise<void> {
  const sql = getDb(); await migrate(sql);
  const server = Bun.serve({ port, fetch: makeRouter(sql) });

  // Background worker: mark stale agents every 30 seconds
  setInterval(async () => {
    try { await markStaleAgents(sql); } catch { /* swallow */ }
  }, 30_000);

  console.log(`microservice-agents listening on http://localhost:${server.port}`);
}
