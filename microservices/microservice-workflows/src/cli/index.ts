import { Command } from "commander";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { startServer } from "../http/index.js";

const pkg = { name: "@hasna/microservice-workflows", version: "0.0.1" };
const program = new Command(pkg.name).version(pkg.version);

program
  .command("serve")
  .description("Start the workflows HTTP server")
  .option("-p, --port <port>", "Port", "3000")
  .action(async ({ port }) => { await startServer(Number(port)); });

program
  .command("migrate")
  .description("Run database migrations")
  .action(async () => {
    const sql = getDb();
    await migrate(sql);
    console.log("Migrations complete");
    await sql.end();
  });

program.parse();
