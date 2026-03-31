import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { makeRouter } from "./routes.js";

export async function startServer(port: number = 3005): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const router = makeRouter(sql);

  const server = Bun.serve({ port, fetch: router });
  console.log(`microservice-files listening on http://localhost:${server.port}`);
}
