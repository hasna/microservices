/**
 * Database connection for microservice-wiki
 */

import { SqliteAdapter } from "@hasna/cloud";
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MIGRATIONS } from "./migrations.js";

let _db: Database | null = null;

function getDbPath(): string {
  const explicit = process.env["HASNA_MICROSERVICES_DIR"] ?? process.env["MICROSERVICES_DIR"];
  if (explicit) {
    return join(explicit, "microservice-wiki", "data.db");
  }

  let dir = resolve(process.cwd());
  while (true) {
    const msDir = join(dir, ".microservices");
    if (existsSync(msDir)) return join(msDir, "microservice-wiki", "data.db");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  const newDir = join(home, ".hasna", "microservices");
  const oldDir = join(home, ".microservices");
  if (!existsSync(newDir) && existsSync(oldDir)) {
    mkdirSync(join(home, ".hasna"), { recursive: true });
    cpSync(oldDir, newDir, { recursive: true });
  }
  return join(newDir, "microservice-wiki", "data.db");
}

export function getDatabase(): Database {
  if (_db) return _db;

  const dbPath = getDbPath();
  const dir = dirname(resolve(dbPath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const adapter = new SqliteAdapter(dbPath);
  _db = adapter.raw;
  // SqliteAdapter already sets WAL and foreign_keys

  _db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = _db
    .query("SELECT id FROM _migrations ORDER BY id")
    .all() as { id: number }[];
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;

    _db.exec("BEGIN");
    try {
      _db.exec(migration.sql);
      _db.prepare("INSERT INTO _migrations (id, name) VALUES (?, ?)").run(
        migration.id,
        migration.name
      );
      _db.exec("COMMIT");
    } catch (error) {
      _db.exec("ROLLBACK");
      throw new Error(
        `Migration ${migration.id} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
