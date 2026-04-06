import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS cache`;
  await sql`CREATE TABLE IF NOT EXISTS cache._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_entries", m001);
  await run(sql, "002_namespaces", m002);
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] = await sql`SELECT id FROM cache._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO cache._migrations (name) VALUES (${name})`;
  });
}

async function m001(sql: Sql) {
  // Cache entries with TTL and LRU tracking
  await sql`
    CREATE TABLE cache.entries (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      namespace       TEXT NOT NULL DEFAULT 'default',
      key             TEXT NOT NULL,
      value           BYTEA NOT NULL,
      ttl_seconds     INT NOT NULL,
      hits            INT DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMPTZ NOT NULL,
      UNIQUE (namespace, key)
    )`;
  // GIN index for namespace lookups
  await sql`CREATE INDEX ON cache.entries (namespace, key)`;
  // B-tree for TTL expiration queries
  await sql`CREATE INDEX ON cache.entries (expires_at)`;
  // Partial index for non-expired entries
  await sql`CREATE INDEX ON cache.entries_active ON cache.entries (namespace, hits DESC) WHERE expires_at > NOW()`;
}

async function m002(sql: Sql) {
  // Namespaces for tenant isolation
  await sql`
    CREATE TABLE cache.namespaces (
      namespace       TEXT PRIMARY KEY,
      max_entries     INT DEFAULT 10000,
      default_ttl     INT DEFAULT 3600,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
}
