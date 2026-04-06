/**
 * API key scoping — hierarchical scopes, permission checks, and usage audit.
 * Extends the basic API key system with fine-grained permission control.
 */

import type { Sql } from "postgres";

export type Scope =
  | "read" | "write" | "admin"
  | "memory:read" | "memory:write" | "memory:delete"
  | "llm:chat" | "llm:embed" | "llm:admin"
  | "auth:read" | "auth:write"
  | "sessions:read" | "sessions:write"
  | "billing:read" | "billing:write"
  | "traces:read" | "traces:write";

export interface ScopedPermission {
  scope: Scope;
  resource: string;
  actions: ("create" | "read" | "update" | "delete")[];
}

export interface ApiKeyScopeDetail {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  scopes: Scope[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  // Usage stats
  use_count: number;
  daily_use_count: number;
  last_24h_use: number;
}

export interface ApiKeyUsageLog {
  id: string;
  api_key_id: string;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms: number;
  created_at: string;
}

// Hierarchy: admin > write > read
const SCOPE_HIERARCHY: Record<string, Scope[]> = {
  admin: ["admin"],
  write: ["write", "read"],
  read: ["read"],
};

function expandScopes(scopes: Scope[]): Scope[] {
  const expanded = new Set<Scope>(scopes);
  for (const scope of scopes) {
    const implied = SCOPE_HIERARCHY[scope];
    if (implied) {
      for (const s of implied) expanded.add(s);
    }
  }
  return Array.from(expanded);
}

/**
 * Check if a given scope includes a required permission.
 */
export function hasScopePermission(
  keyScopes: Scope[],
  required: Scope,
): boolean {
  const expanded = expandScopes(keyScopes);
  return expanded.includes(required) || expanded.includes("admin" as Scope);
}

/**
 * Check if a key can access a specific resource action.
 */
export function canAccessResource(
  keyScopes: Scope[],
  resource: string,
  action: "create" | "read" | "update" | "delete",
): boolean {
  const resourceScope = `${resource}:${action}` as Scope;
  if (hasScopePermission(keyScopes, "admin" as Scope)) return true;

  // Try exact match
  if (keyScopes.includes(resourceScope)) return true;

  // Try action-based expansion
  const actionScope = `${resource}:${action === "read" ? "read" : action === "delete" ? "write" : "write"}` as Scope;
  return keyScopes.includes(actionScope);
}

// ─── Rotation ─────────────────────────────────────────────────────────────────

export interface RotationSchedule {
  key_id: string;
  rotate_at: Date;
  frequency_days: number;
}

export async function scheduleRotation(
  sql: Sql,
  keyId: string,
  frequencyDays: number,
): Promise<RotationSchedule> {
  const rotateAt = new Date(Date.now() + frequencyDays * 24 * 60 * 60 * 1000);
  await sql`
    UPDATE auth.api_keys
    SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{rotation}', ${JSON.stringify({ frequency_days: frequencyDays, rotate_at: rotateAt.toISOString() })})
    WHERE id = ${keyId}
  `;
  return { key_id: keyId, rotate_at: rotateAt, frequency_days: frequencyDays };
}

export async function getRotationSchedule(
  sql: Sql,
  keyId: string,
): Promise<RotationSchedule | null> {
  const [row] = await sql<{ metadata: Record<string, unknown> }[]>`
    SELECT metadata FROM auth.api_keys WHERE id = ${keyId}
  `;
  if (!row?.metadata?.rotation) return null;
  const r = row.metadata.rotation as { frequency_days: number; rotate_at: string };
  return { key_id: keyId, rotate_at: new Date(r.rotate_at), frequency_days: r.frequency_days };
}

export async function getKeysDueForRotation(
  sql: Sql,
): Promise<{ id: string; name: string; user_id: string; rotate_at: string }[]> {
  const now = new Date().toISOString();
  const [rows] = await sql<{ id: string; name: string; user_id: string; rotate_at: string }[]>`
    SELECT id, name, user_id, (metadata->'rotation'->>'rotate_at') as rotate_at
    FROM auth.api_keys
    WHERE metadata->'rotation'->>'rotate_at' IS NOT NULL
      AND (metadata->'rotation'->>'rotate_at')::timestamptz <= ${now}
  `;
  return rows;
}

// ─── Usage tracking ─────────────────────────────────────────────────────────────

export async function logApiKeyUsage(
  sql: Sql,
  keyId: string,
  endpoint: string,
  method: string,
  statusCode: number,
  responseTimeMs: number,
): Promise<void> {
  await sql`
    INSERT INTO auth.api_key_usage_log
      (api_key_id, endpoint, method, status_code, response_time_ms)
    VALUES (${keyId}, ${endpoint}, ${method}, ${statusCode}, ${responseTimeMs})
  `;
}

export async function getApiKeyUsageStats(
  sql: Sql,
  keyId: string,
): Promise<{ total: number; last_24h: number; avg_response_ms: number }> {
  const [totalRow] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM auth.api_key_usage_log WHERE api_key_id = ${keyId}
  `;
  const [dayRow] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM auth.api_key_usage_log
    WHERE api_key_id = ${keyId}
      AND created_at >= NOW() - INTERVAL '24 hours'
  `;
  const [avgRow] = await sql<[{ avg_ms: number }]>`
    SELECT COALESCE(AVG(response_time_ms), 0) as avg_ms FROM auth.api_key_usage_log WHERE api_key_id = ${keyId}
  `;
  return {
    total: totalRow?.count ?? 0,
    last_24h: dayRow?.count ?? 0,
    avg_response_ms: avgRow?.avg_ms ?? 0,
  };
}

export async function getDetailedKeyInfo(
  sql: Sql,
  keyId: string,
): Promise<ApiKeyScopeDetail | null> {
  const [row] = await sql<any[]>`
    SELECT ak.*,
           COUNT(ul.id) as use_count,
           COALESCE(SUM(CASE WHEN ul.created_at >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0) as last_24h_use
    FROM auth.api_keys ak
    LEFT JOIN auth.api_key_usage_log ul ON ul.api_key_id = ak.id
    WHERE ak.id = ${keyId}
    GROUP BY ak.id
  `;
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    key_prefix: row.key_prefix,
    scopes: row.scopes,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    use_count: Number(row.use_count),
    daily_use_count: 0,
    last_24h_use: Number(row.last_24h_use),
  };
}

/**
 * Get API key with expanded scopes (hierarchy resolved).
 */
export async function getApiKeyWithExpandedScopes(
  sql: Sql,
  keyId: string,
): Promise<{ key: ApiKeyScopeDetail; expanded_scopes: Scope[] } | null> {
  const key = await getDetailedKeyInfo(sql, keyId);
  if (!key) return null;
  return { key, expanded_scopes: expandScopes(key.scopes) };
}