/**
 * Shared database utilities for microservices
 *
 * Each microservice gets its own SQLite database stored in:
 *   .microservices/<service-name>/data.db
 *
 * Resolution order:
 *   1. HASNA_MICROSERVICES_DIR / MICROSERVICES_DIR env var
 *   2. .microservices/ in nearest ancestor directory
 *   3. ~/.hasna/microservices/ (global fallback, with backward compat from ~/.microservices/)
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

function findNearestMicroservicesDir(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".microservices");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the base .microservices directory
 */
export function getMicroservicesDir(): string {
  // 1. Environment variable override
  const explicit = process.env["HASNA_MICROSERVICES_DIR"] ?? process.env["MICROSERVICES_DIR"];
  if (explicit) {
    return explicit;
  }

  // 2. Nearest .microservices/ in cwd or parent
  const cwd = process.cwd();
  const nearest = findNearestMicroservicesDir(cwd);
  if (nearest) return nearest;

  // 3. Global fallback: ~/.hasna/microservices/ (with backward compat)
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  const newDir = join(home, ".hasna", "microservices");
  const oldDir = join(home, ".microservices");

  // Auto-migrate: copy old data to new location if needed
  if (!existsSync(newDir) && existsSync(oldDir)) {
    mkdirSync(join(home, ".hasna"), { recursive: true });
    cpSync(oldDir, newDir, { recursive: true });
  }

  return newDir;
}

/**
 * Get the data directory for a specific microservice
 */
export function getServiceDataDir(serviceName: string): string {
  const name = serviceName.startsWith("microservice-") ? serviceName : `microservice-${serviceName}`;
  return join(getMicroservicesDir(), name);
}

/**
 * Get the database path for a specific microservice
 */
export function getServiceDbPath(serviceName: string): string {
  return join(getServiceDataDir(serviceName), "data.db");
}

/**
 * Open a SQLite database for a microservice, creating directories and applying migrations
 */
export function openServiceDatabase(
  serviceName: string,
  migrations: MigrationEntry[]
): Database {
  const dbPath = getServiceDbPath(serviceName);
  const dataDir = dirname(dbPath);

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable WAL mode for concurrent reads
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Create migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Apply pending migrations
  applyMigrations(db, migrations);

  return db;
}

/**
 * Apply pending migrations to a database
 */
function applyMigrations(db: Database, migrations: MigrationEntry[]): void {
  const applied = db
    .query("SELECT id FROM _migrations ORDER BY id")
    .all() as { id: number }[];
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;

    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO _migrations (id, name) VALUES (?, ?)").run(
        migration.id,
        migration.name
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(
        `Migration ${migration.id} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Generate a UUID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current ISO datetime string
 */
export function now(): string {
  return new Date().toISOString();
}
