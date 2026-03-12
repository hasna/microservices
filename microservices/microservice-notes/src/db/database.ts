/**
 * Database connection for microservice-notes
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MIGRATIONS } from "./migrations.js";

let _db: Database | null = null;

function getDbPath(): string {
  // Environment variable override
  if (process.env["MICROSERVICES_DIR"]) {
    return join(process.env["MICROSERVICES_DIR"], "microservice-notes", "data.db");
  }

  // Check for .microservices in current or parent directories
  let dir = resolve(process.cwd());
  while (true) {
    const candidate = join(dir, ".microservices", "microservice-notes", "data.db");
    const msDir = join(dir, ".microservices");
    if (existsSync(msDir)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Global fallback
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  return join(home, ".microservices", "microservice-notes", "data.db");
}

function ensureDir(filePath: string): void {
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getDatabase(): Database {
  if (_db) return _db;

  const dbPath = getDbPath();
  ensureDir(dbPath);

  _db = new Database(dbPath);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");

  // Create migrations table
  _db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Apply pending migrations
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
