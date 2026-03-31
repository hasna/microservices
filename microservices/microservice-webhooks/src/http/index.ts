import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { makeRouter } from "./routes.js";
import { processPendingDeliveries } from "../lib/deliver.js";

export async function startServer(port = 3011): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const server = Bun.serve({ port, fetch: makeRouter(sql) });
  console.log(`microservice-webhooks listening on http://localhost:${server.port}`);

  // Background worker: process pending deliveries every 5 seconds
  setInterval(async () => {
    try {
      await processPendingDeliveries(sql);
    } catch {
      // Silently ignore worker errors
    }
  }, 5_000);
}
