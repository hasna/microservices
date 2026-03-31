import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { makeRouter } from "./routes.js";
export async function startServer(port = 3007): Promise<void> {
  const sql = getDb(); await migrate(sql);
  const server = Bun.serve({ port, fetch: makeRouter(sql) });
  console.log(`microservice-flags listening on http://localhost:${server.port}`);
}
