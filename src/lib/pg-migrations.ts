/**
 * PostgreSQL migrations for open-microservices cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 * Covers the hub-level tables (_migrations tracking + feedback).
 * Individual microservice schemas are self-contained and migrate independently.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: _migrations tracking table
  `CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 2: feedback table (hub-level)
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
];
