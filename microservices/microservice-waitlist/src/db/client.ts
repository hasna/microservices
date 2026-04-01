/**
 * PostgreSQL client for microservice-waitlist.
 *
 * Usage:
 *   import { getDb } from './client.js'
 *   const sql = getDb()
 *   const rows = await sql`SELECT * FROM waitlist.campaigns`
 *
 * Config via env:
 *   DATABASE_URL=postgres://user:pass@host:5432/dbname
 */

import postgres from "postgres";

let _client: ReturnType<typeof postgres> | null = null;

export function getDb(connectionString?: string): ReturnType<typeof postgres> {
  if (_client) return _client;

  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is required");

  _client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {}, // suppress notices
  });

  return _client;
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
  }
}
