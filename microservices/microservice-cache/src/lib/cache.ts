import type { Sql } from "postgres";

export interface CacheEntry {
  id: string;
  namespace: string;
  key: string;
  value: Buffer;
  ttl_seconds: number;
  hits: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface SetOptions {
  ttlSeconds?: number;
  namespace?: string;
}

export async function set(
  sql: Sql,
  namespace: string,
  key: string,
  value: string | Buffer | object,
  opts: SetOptions = {},
): Promise<void> {
  const ttl = opts.ttlSeconds ?? 3600;
  const data = typeof value === "object" ? JSON.stringify(value) : value;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf-8");
  await sql`
    INSERT INTO cache.entries (namespace, key, value, ttl_seconds, expires_at, updated_at)
    VALUES (
      ${namespace}, ${key}, ${buf}, ${ttl},
      NOW() + INTERVAL '${sql.unsafe(`${ttl} seconds`)}', NOW()
    )
    ON CONFLICT (namespace, key) DO UPDATE SET
      value = EXCLUDED.value,
      ttl_seconds = EXCLUDED.ttl_seconds,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()`;
}

export async function get(
  sql: Sql,
  namespace: string,
  key: string,
): Promise<{ value: string; hits: number; ttl_seconds: number } | null> {
  const [entry] = await sql<{ value: Buffer; hits: number; ttl_seconds: number; expires_at: Date }[]>`
    UPDATE cache.entries
    SET hits = hits + 1, updated_at = NOW()
    WHERE namespace = ${namespace} AND key = ${key} AND expires_at > NOW()
    RETURNING value, hits, ttl_seconds, expires_at`;

  if (!entry) return null;
  return {
    value: entry.value.toString("utf-8"),
    hits: entry.hits,
    ttl_seconds: entry.ttl_seconds,
  };
}

export async function del(sql: Sql, namespace: string, key: string): Promise<boolean> {
  const r = await sql`DELETE FROM cache.entries WHERE namespace = ${namespace} AND key = ${key}`;
  return r.count > 0;
}

export async function exists(sql: Sql, namespace: string, key: string): Promise<boolean> {
  const [e] = await sql<{ id: string }[]>`
    SELECT id FROM cache.entries WHERE namespace = ${namespace} AND key = ${key} AND expires_at > NOW()`;
  return !!e;
}

export async function clear(sql: Sql, namespace: string): Promise<number> {
  const r = await sql`DELETE FROM cache.entries WHERE namespace = ${namespace}`;
  return r.count;
}

export async function keys(
  sql: Sql,
  namespace: string,
  opts?: { limit?: number; pattern?: string },
): Promise<string[]> {
  let query = sql<{ key: string }[]>`
    SELECT key FROM cache.entries
    WHERE namespace = ${namespace} AND expires_at > NOW()`;
  if (opts?.pattern) {
    // Simple prefix match via LIKE
    query = sql<{ key: string }>`SELECT key FROM cache.entries WHERE namespace = ${namespace} AND expires_at > NOW() AND key LIKE ${opts.pattern + '%'}`;
  }
  return query`ORDER BY updated_at DESC LIMIT ${opts?.limit ?? 100}`.then((rows) => rows.map((r) => r.key));
}

export async function getOrSet(
  sql: Sql,
  namespace: string,
  key: string,
  factory: () => Promise<string | Buffer | object>,
  opts: SetOptions = {},
): Promise<{ value: string; hits: number; cached: boolean }> {
  const cached = await get(sql, namespace, key);
  if (cached) return { value: cached.value, hits: cached.hits, cached: true };
  const fresh = await factory();
  await set(sql, namespace, key, fresh, opts);
  const val = typeof fresh === "string" ? fresh : Buffer.isBuffer(fresh) ? fresh.toString("utf-8") : JSON.stringify(fresh);
  return { value: val, hits: 0, cached: false };
}

export async function increment(sql: Sql, namespace: string, key: string, amount = 1): Promise<number> {
  const [entry] = await sql<{ value: Buffer }[]>`
    SELECT value FROM cache.entries WHERE namespace = ${namespace} AND key = ${key} AND expires_at > NOW()`;
  if (!entry) throw new Error(`Key "${key}" not found or expired`);
  const num = parseInt(entry.value.toString("utf-8"), 10) + amount;
  await sql`UPDATE cache.entries SET value = ${String(num)}, updated_at = NOW() WHERE namespace = ${namespace} AND key = ${key}`;
  return num;
}

export async function decrement(sql: Sql, namespace: string, key: string, amount = 1): Promise<number> {
  return increment(sql, namespace, key, -amount);
}

export async function touch(sql: Sql, namespace: string, key: string, ttlSeconds?: number): Promise<boolean> {
  if (ttlSeconds) {
    const r = await sql`UPDATE cache.entries SET expires_at = NOW() + INTERVAL '${sql.unsafe(`${ttlSeconds} seconds`)}', updated_at = NOW() WHERE namespace = ${namespace} AND key = ${key} AND expires_at > NOW()`;
    return r.count > 0;
  }
  const r = await sql`UPDATE cache.entries SET updated_at = NOW() WHERE namespace = ${namespace} AND key = ${key} AND expires_at > NOW()`;
  return r.count > 0;
}
