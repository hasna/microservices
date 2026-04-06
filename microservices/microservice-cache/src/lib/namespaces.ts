import type { Sql } from "postgres";

export interface Namespace {
  namespace: string;
  max_entries: number;
  default_ttl: number;
  created_at: string;
}

export async function createNamespace(
  sql: Sql,
  namespace: string,
  opts?: { maxEntries?: number; defaultTtl?: number },
): Promise<Namespace> {
  const [ns] = await sql<Namespace[]>`
    INSERT INTO cache.namespaces (namespace, max_entries, default_ttl)
    VALUES (${namespace}, ${opts?.maxEntries ?? 10000}, ${opts?.defaultTtl ?? 3600})
    ON CONFLICT (namespace) DO UPDATE SET
      max_entries = COALESCE(EXCLUDED.max_entries, cache.namespaces.max_entries),
      default_ttl = COALESCE(EXCLUDED.default_ttl, cache.namespaces.default_ttl)
    RETURNING *`;
  return ns;
}

export async function getNamespace(sql: Sql, namespace: string): Promise<Namespace | null> {
  const [ns] = await sql<Namespace[]>`SELECT * FROM cache.namespaces WHERE namespace = ${namespace}`;
  return ns ?? null;
}

export async function listNamespaces(sql: Sql): Promise<Namespace[]> {
  return sql<Namespace[]>`SELECT * FROM cache.namespaces ORDER BY namespace ASC`;
}

export async function deleteNamespace(sql: Sql, namespace: string): Promise<boolean> {
  await sql`DELETE FROM cache.entries WHERE namespace = ${namespace}`;
  const r = await sql`DELETE FROM cache.namespaces WHERE namespace = ${namespace}`;
  return r.count > 0;
}
