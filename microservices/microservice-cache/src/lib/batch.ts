import type { Sql } from "postgres";

export interface BatchEntry {
  key: string;
  value: string | Buffer | object;
}

/**
 * Set multiple cache entries in one transaction.
 * Returns count of entries written.
 */
export async function setMany(
  sql: Sql,
  namespace: string,
  entries: BatchEntry[],
  opts: { ttlSeconds?: number } = {},
): Promise<number> {
  if (entries.length === 0) return 0;
  const ttl = opts.ttlSeconds ?? 3600;
  const rows = entries.map((e) => {
    const data = typeof e.value === "object" ? JSON.stringify(e.value) : e.value;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf-8");
    return { namespace, key: e.key, buf, ttl };
  });
  for (const row of rows) {
    await sql`
      INSERT INTO cache.entries (namespace, key, value, ttl_seconds, expires_at, updated_at)
      VALUES (${row.namespace}, ${row.key}, ${row.buf}, ${row.ttl},
              NOW() + INTERVAL '${sql.unsafe(`${row.ttl} seconds`)}', NOW())
      ON CONFLICT (namespace, key) DO UPDATE SET
        value = EXCLUDED.value, ttl_seconds = EXCLUDED.ttl_seconds,
        expires_at = EXCLUDED.expires_at, updated_at = NOW()`;
  }
  return rows.length;
}

/**
 * Get multiple cache entries. Returns map of key -> value (null if missing/expired).
 */
export async function getMany(
  sql: Sql,
  namespace: string,
  keys: string[],
): Promise<Record<string, { value: string; hits: number; ttl_seconds: number } | null>> {
  if (keys.length === 0) return {};
  const rows = await sql<{ key: string; value: Buffer; hits: number; ttl_seconds: number }[]>`
    UPDATE cache.entries
    SET hits = hits + 1, updated_at = NOW()
    WHERE namespace = ${namespace} AND key = ANY(${keys}::text[]) AND expires_at > NOW()
    RETURNING key, value, hits, ttl_seconds`;
  const result: Record<string, { value: string; hits: number; ttl_seconds: number } | null> = {};
  for (const k of keys) result[k] = null;
  for (const row of rows) {
    result[row.key] = { value: row.value.toString("utf-8"), hits: row.hits, ttl_seconds: row.ttl_seconds };
  }
  return result;
}

/**
 * Delete multiple cache entries. Returns count deleted.
 */
export async function delMany(
  sql: Sql,
  namespace: string,
  keys: string[],
): Promise<number> {
  if (keys.length === 0) return 0;
  const r = await sql`DELETE FROM cache.entries WHERE namespace = ${namespace} AND key = ANY(${keys}::text[])`;
  return r.count;
}

/**
 * Touch (refresh TTL) for multiple keys. Returns count touched.
 */
export async function touchMany(
  sql: Sql,
  namespace: string,
  keys: string[],
  ttlSeconds?: number,
): Promise<number> {
  if (keys.length === 0) return 0;
  if (ttlSeconds) {
    const r = await sql`UPDATE cache.entries SET expires_at = NOW() + INTERVAL '${sql.unsafe(`${ttlSeconds} seconds`)}', updated_at = NOW() WHERE namespace = ${namespace} AND key = ANY(${keys}::text[]) AND expires_at > NOW()`;
    return r.count;
  }
  const r = await sql`UPDATE cache.entries SET updated_at = NOW() WHERE namespace = ${namespace} AND key = ANY(${keys}::text[]) AND expires_at > NOW()`;
  return r.count;
}
