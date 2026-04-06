import type { Sql } from "postgres";

export interface NamespaceStats {
  namespace: string;
  total_entries: number;
  total_size_bytes: number;
  total_hits: number;
  avg_ttl_seconds: number;
  oldest_entry_at: string | null;
  newest_entry_at: string | null;
  hit_rate_pct: number;
}

/**
 * Get comprehensive stats for a namespace.
 */
export async function getNamespaceStats(
  sql: Sql,
  namespace: string,
): Promise<NamespaceStats | null> {
  const [meta] = await sql<[{ total_entries: string; total_size: string; total_hits: string; avg_ttl: string; oldest: string | null; newest: string | null } | undefined]>`
    SELECT
      COUNT(*)::text as total_entries,
      COALESCE(SUM(LENGTH(value)), 0)::text as total_size,
      COALESCE(SUM(hits), 0)::text as total_hits,
      COALESCE(AVG(ttl_seconds), 0)::text as avg_ttl,
      MIN(created_at)::text as oldest,
      MAX(created_at)::text as newest
    FROM cache.entries
    WHERE namespace = ${namespace} AND expires_at > NOW()`;

  if (!meta || parseInt(meta.total_entries, 10) === 0) return null;

  const totalHits = parseInt(meta.total_hits, 10);
  const totalEntries = parseInt(meta.total_entries, 10);
  // Estimate hit rate: hits / (hits + misses). We don't track misses directly,
  // so approximate as hits / (total lookups). Use a simpler approximation:
  // hit_rate = hits / (hits + entries_without_hits) where entries_without_hits = entries with hits=0
  const [noHitEntries] = await sql<[{ count: string }]>`
    SELECT COUNT(*)::text as count FROM cache.entries WHERE namespace = ${namespace} AND expires_at > NOW() AND hits = 0`;
  const noHitCount = parseInt(noHitEntries.count, 10);
  const hitRatePct = totalEntries > 0
    ? Math.round((totalEntries - noHitCount) / totalEntries * 100 * 100) / 100
    : 0;

  return {
    namespace,
    total_entries: totalEntries,
    total_size_bytes: parseInt(meta.total_size, 10),
    total_hits: totalHits,
    avg_ttl_seconds: Math.round(parseFloat(meta.avg_ttl) * 100) / 100,
    oldest_entry_at: meta.oldest,
    newest_entry_at: meta.newest,
    hit_rate_pct: hitRatePct,
  };
}

/**
 * Get top N keys by hit count in a namespace.
 */
export async function getTopKeys(
  sql: Sql,
  namespace: string,
  limit = 10,
): Promise<{ key: string; hits: number; ttl_seconds: number; expires_at: string }[]> {
  return sql<{ key: string; hits: number; ttl_seconds: number; expires_at: string }[]>`
    SELECT key, hits, ttl_seconds, expires_at FROM cache.entries
    WHERE namespace = ${namespace} AND expires_at > NOW()
    ORDER BY hits DESC LIMIT ${limit}`;
}
