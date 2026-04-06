import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { router } from "./routes.js";

export async function startServer(port: number = 3000): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const server = Bun.serve({ port, fetch: router });
  console.log(`microservice-cache listening on http://localhost:${server.port}`);
}
