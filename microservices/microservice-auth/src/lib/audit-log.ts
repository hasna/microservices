/**
 * Auth audit log — tracks all authentication and authorization events.
 * Provides searchable history for security reviews, compliance, and forensics.
 */

import type { Sql } from "postgres";

export type AuditEventType =
  | "login_success"
  | "login_failed"
  | "logout"
  | "token_refresh"
  | "api_key_created"
  | "api_key_revoked"
  | "api_key_used"
  | "password_changed"
  | "password_reset_requested"
  | "magic_link_sent"
  | "magic_link_used"
  | "passkey_registered"
  | "passkey_authenticated"
  | "passkey_deleted"
  | "oauth_connected"
  | "oauth_disconnected"
  | "session_created"
  | "session_revoked"
  | "device_trusted"
  | "device_revoked"
  | "user_created"
  | "user_deleted"
  | "workspace_invite_sent"
  | "workspace_invite_accepted"
  | "mfa_enabled"
  | "mfa_disabled"
  | "scope_changed"
  | "permission_denied";

export interface AuditLogEntry {
  id: string;
  event_type: AuditEventType;
  user_id: string | null;
  actor_id: string | null;     // who performed the action (could differ from user_id for admin actions)
  ip_address: string | null;
  user_agent: string | null;
  resource_type: string | null; // e.g. "api_key", "session", "user"
  resource_id: string | null; // ID of the affected resource
  metadata: Record<string, unknown>; // additional event-specific data
  created_at: string;
}

export interface AuditQueryOptions {
  user_id?: string;
  event_type?: AuditEventType;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Record a single audit event.
 */
export async function recordAuditEvent(
  sql: Sql,
  entry: {
    event_type: AuditEventType;
    user_id?: string;
    actor_id?: string;
    ip_address?: string;
    user_agent?: string;
    resource_type?: string;
    resource_id?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<AuditLogEntry> {
  const [row] = await sql<AuditLogEntry[]>`
    INSERT INTO auth.audit_log
      (event_type, user_id, actor_id, ip_address, user_agent, resource_type, resource_id, metadata)
    VALUES (
      ${entry.event_type},
      ${entry.user_id ?? null},
      ${entry.actor_id ?? null},
      ${entry.ip_address ?? null},
      ${entry.user_agent ?? null},
      ${entry.resource_type ?? null},
      ${entry.resource_id ?? null},
      ${entry.metadata ?? {}}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Record multiple audit events in a batch.
 */
export async function recordAuditEvents(
  sql: Sql,
  entries: Array<{
    event_type: AuditEventType;
    user_id?: string;
    actor_id?: string;
    ip_address?: string;
    user_agent?: string;
    resource_type?: string;
    resource_id?: string;
    metadata?: Record<string, unknown>;
  }>,
): Promise<number> {
  if (entries.length === 0) return 0;

  const values = entries.map((e) => `(${e.event_type}, ${e.user_id ?? 'NULL'}, ${e.actor_id ?? 'NULL'}, ${e.ip_address ?? 'NULL'}, ${e.user_agent ?? 'NULL'}, ${e.resource_type ?? 'NULL'}, ${e.resource_id ?? 'NULL'}, '${JSON.stringify(e.metadata ?? {})}')`).join(", ");

  const result = await sql.unsafe(`
    INSERT INTO auth.audit_log
      (event_type, user_id, actor_id, ip_address, user_agent, resource_type, resource_id, metadata)
    VALUES ${values}
  `);
  return (result as any).count ?? entries.length;
}

/**
 * Query audit log with filters.
 */
export async function queryAuditLog(
  sql: Sql,
  opts: AuditQueryOptions = {},
): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  let whereClause = "WHERE 1=1";
  const params: unknown[] = [];
  let paramIdx = 1;

  if (opts.user_id) {
    whereClause += ` AND user_id = $${paramIdx++}`;
    params.push(opts.user_id);
  }
  if (opts.event_type) {
    whereClause += ` AND event_type = $${paramIdx++}`;
    params.push(opts.event_type);
  }
  if (opts.resource_type) {
    whereClause += ` AND resource_type = $${paramIdx++}`;
    params.push(opts.resource_type);
  }
  if (opts.resource_id) {
    whereClause += ` AND resource_id = $${paramIdx++}`;
    params.push(opts.resource_id);
  }
  if (opts.ip_address) {
    whereClause += ` AND ip_address = $${paramIdx++}`;
    params.push(opts.ip_address);
  }
  if (opts.since) {
    whereClause += ` AND created_at >= $${paramIdx++}`;
    params.push(opts.since);
  }
  if (opts.until) {
    whereClause += ` AND created_at <= $${paramIdx++}`;
    params.push(opts.until);
  }

  const [rows] = await sql<AuditLogEntry[]>`
    SELECT * FROM auth.audit_log
    ${sql.unsafe(whereClause)}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countRow] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM auth.audit_log ${sql.unsafe(whereClause)}
  `;

  return { entries: rows, total: countRow?.count ?? 0 };
}

/**
 * Get recent failed login attempts for a user or IP.
 */
export async function getRecentFailedLogins(
  sql: Sql,
  identifier: { user_id?: string; ip_address?: string },
  sinceMinutes = 60,
): Promise<AuditLogEntry[]> {
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
  const [rows] = await sql<AuditLogEntry[]>`
    SELECT * FROM auth.audit_log
    WHERE event_type = 'login_failed'
      AND created_at >= ${since}
      AND (${identifier.user_id ? sql`user_id = ${identifier.user_id}` : sql`true`})
      AND (${identifier.ip_address ? sql`ip_address = ${identifier.ip_address}` : sql`true`})
    ORDER BY created_at DESC
  `;
  return rows;
}

/**
 * Get authentication summary for a user (login history, method breakdown).
 */
export async function getUserAuthSummary(
  sql: Sql,
  userId: string,
  days = 30,
): Promise<{
  total_events: number;
  successful_logins: number;
  failed_logins: number;
  methods: Record<string, number>;
  ips: string[];
  last_login: string | null;
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [stats] = await sql<any[]>`
    SELECT
      COUNT(*) as total_events,
      COALESCE(SUM(CASE WHEN event_type = 'login_success' THEN 1 ELSE 0 END), 0) as successful_logins,
      COALESCE(SUM(CASE WHEN event_type = 'login_failed' THEN 1 ELSE 0 END), 0) as failed_logins,
      COALESCE(SUM(CASE WHEN event_type = 'passkey_authenticated' THEN 1 ELSE 0 END), 0) as passkey_logins,
      COALESCE(SUM(CASE WHEN event_type = 'magic_link_used' THEN 1 ELSE 0 END), 0) as magic_link_logins,
      COALESCE(SUM(CASE WHEN event_type = 'oauth_connected' THEN 1 ELSE 0 END), 0) as oauth_logins
    FROM auth.audit_log
    WHERE user_id = ${userId} AND created_at >= ${since}
  `;

  const [ipsRow] = await sql<{ ips: string[] }[]>`
    SELECT COALESCE(array_agg(DISTINCT ip_address), '{}') as ips
    FROM auth.audit_log
    WHERE user_id = ${userId} AND created_at >= ${since} AND ip_address IS NOT NULL
  `;

  const [lastLogin] = await sql<{ created_at: string }[]>`
    SELECT created_at FROM auth.audit_log
    WHERE user_id = ${userId} AND event_type = 'login_success'
    ORDER BY created_at DESC LIMIT 1
  `;

  return {
    total_events: stats?.total_events ?? 0,
    successful_logins: stats?.successful_logins ?? 0,
    failed_logins: stats?.failed_logins ?? 0,
    methods: {
      password: stats?.successful_logins - (stats?.passkey_logins ?? 0) - (stats?.magic_link_logins ?? 0) - (stats?.oauth_logins ?? 0),
      passkey: stats?.passkey_logins ?? 0,
      magic_link: stats?.magic_link_logins ?? 0,
      oauth: stats?.oauth_logins ?? 0,
    },
    ips: ipsRow?.ips ?? [],
    last_login: lastLogin?.created_at ?? null,
  };
}

/**
 * Export audit log as CSV-compatible rows (for compliance exports).
 */
export async function exportAuditLog(
  sql: Sql,
  opts: AuditQueryOptions & { format?: "json" | "csv" } = {},
): Promise<string> {
  const { entries } = await queryAuditLog(sql, { ...opts, limit: 10000 });
  if (opts.format === "csv") {
    const header = "id,event_type,user_id,actor_id,ip_address,user_agent,resource_type,resource_id,metadata,created_at";
    const rows = entries.map((e) =>
      [e.id, e.event_type, e.user_id ?? "", e.actor_id ?? "", e.ip_address ?? "", e.user_agent ?? "", e.resource_type ?? "", e.resource_id ?? "", JSON.stringify(e.metadata), e.created_at].join(",")
    );
    return [header, ...rows].join("\n");
  }
  return JSON.stringify(entries, null, 2);
}