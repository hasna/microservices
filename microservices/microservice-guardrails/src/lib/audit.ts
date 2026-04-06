import type { Sql } from "postgres";

/**
 * Request audit log — full request/response logging with context.
 * Tracks IP, user agent, latency, guard results, and violation details
 * for compliance, security auditing, and forensics.
 */

export interface AuditLogEntry {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  request_id: string | null;
  direction: "input" | "output";
  ip_address: string | null;
  user_agent: string | null;
  content_hash: string | null;
  fingerprint: string | null;  // simhash fingerprint
  content_length: number;
  guard_result: "pass" | "warn" | "block";
  latency_ms: number | null;
  rules_triggered: string[];  // Array of rule names
  pii_types: string[];        // PII types detected
  injection_detected: boolean;
  toxicity_detected: boolean;
  policy_violated: boolean;
  blocked_content: string | null;  // Only stored if block action was taken (forensics)
  metadata: Record<string, any>;
  created_at: string;
}

export interface CreateAuditEntryData {
  workspaceId?: string;
  userId?: string;
  requestId?: string;
  direction: "input" | "output";
  ipAddress?: string;
  userAgent?: string;
  contentHash?: string;
  fingerprint?: string;
  contentLength: number;
  guardResult: "pass" | "warn" | "block";
  latencyMs?: number;
  rulesTriggered?: string[];
  piiTypes?: string[];
  injectionDetected?: boolean;
  toxicityDetected?: boolean;
  policyViolated?: boolean;
  blockedContent?: string;
  metadata?: Record<string, any>;
}

/**
 * Log a guardrails check to the audit log.
 */
export async function logAuditEntry(
  sql: Sql,
  data: CreateAuditEntryData,
): Promise<AuditLogEntry> {
  const [entry] = await sql<AuditLogEntry[]>`
    INSERT INTO guardrails.audit_log (
      workspace_id, user_id, request_id, direction,
      ip_address, user_agent, content_hash, fingerprint,
      content_length, guard_result, latency_ms,
      rules_triggered, pii_types, injection_detected,
      toxicity_detected, policy_violated, blocked_content, metadata
    )
    VALUES (
      ${data.workspaceId ?? null},
      ${data.userId ?? null},
      ${data.requestId ?? null},
      ${data.direction},
      ${data.ipAddress ?? null},
      ${data.userAgent ?? null},
      ${data.contentHash ?? null},
      ${data.fingerprint ?? null},
      ${data.contentLength},
      ${data.guardResult},
      ${data.latencyMs ?? null},
      ${data.rulesTriggered ?? []},
      ${data.piiTypes ?? []},
      ${data.injectionDetected ?? false},
      ${data.toxicityDetected ?? false},
      ${data.policyViolated ?? false},
      ${data.blockedContent ?? null},
      ${sql.json(data.metadata ?? {})}
    )
    RETURNING *
  `;
  return entry;
}

/**
 * Query audit log with filters.
 */
export async function queryAuditLog(
  sql: Sql,
  opts: {
    workspaceId?: string;
    userId?: string;
    direction?: "input" | "output";
    guardResult?: "pass" | "warn" | "block";
    since?: Date;
    until?: Date;
    fingerprint?: string;
    ipAddress?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<AuditLogEntry[]> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  const conditions: any[] = [];
  if (opts.workspaceId) conditions.push(sql`workspace_id = ${opts.workspaceId}`);
  if (opts.userId) conditions.push(sql`user_id = ${opts.userId}`);
  if (opts.direction) conditions.push(sql`direction = ${opts.direction}`);
  if (opts.guardResult) conditions.push(sql`guard_result = ${opts.guardResult}`);
  if (opts.since) conditions.push(sql`created_at >= ${opts.since}`);
  if (opts.until) conditions.push(sql`created_at <= ${opts.until}`);
  if (opts.fingerprint) conditions.push(sql`fingerprint = ${opts.fingerprint}`);
  if (opts.ipAddress) conditions.push(sql`ip_address = ${opts.ipAddress}`);

  let where = "";
  if (conditions.length > 0) {
    where = "WHERE " + conditions.map(() => "").join(" AND ");
  }

  const rows = await sql.unsafe<AuditLogEntry[]>`
    SELECT * FROM guardrails.audit_log
    ${sql.unsafe(where)}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return rows;
}

/**
 * Get audit statistics for a workspace/time range.
 */
export async function getAuditStats(
  sql: Sql,
  opts: { workspaceId?: string; since?: Date; until?: Date } = {},
): Promise<{
  total_checks: number;
  pass_count: number;
  warn_count: number;
  block_count: number;
  pass_rate: string;
  block_rate: string;
  avg_latency_ms: number;
  top_pii_types: Array<{ type: string; count: number }>;
  top_rules_triggered: Array<{ rule: string; count: number }>;
  unique_ips: number;
  unique_fingerprints: number;
}> {
  const workspaceFilter = opts.workspaceId
    ? sql`AND workspace_id = ${opts.workspaceId}`
    : sql``;
  const sinceFilter = opts.since
    ? sql`AND created_at >= ${opts.since}`
    : sql``;
  const untilFilter = opts.until
    ? sql`AND created_at <= ${opts.until}`
    : sql``;

  const [stats] = await sql<[{
    total_checks: number;
    pass_count: number;
    warn_count: number;
    block_count: number;
    avg_latency_ms: number;
    unique_ips: number;
    unique_fingerprints: number;
  }]>`
    SELECT
      COUNT(*)::int AS total_checks,
      COUNT(*) FILTER (WHERE guard_result = 'pass') AS pass_count,
      COUNT(*) FILTER (WHERE guard_result = 'warn') AS warn_count,
      COUNT(*) FILTER (WHERE guard_result = 'block') AS block_count,
      COALESCE(AVG(latency_ms)::int, 0) AS avg_latency_ms,
      COUNT(DISTINCT ip_address) FILTER (WHERE ip_address IS NOT NULL) AS unique_ips,
      COUNT(DISTINCT fingerprint) FILTER (WHERE fingerprint IS NOT NULL) AS unique_fingerprints
    FROM guardrails.audit_log
    WHERE true ${workspaceFilter} ${sinceFilter} ${untilFilter}
  `;

  const [topPii] = await sql<Array<{ type: string; count: number }>>`
    SELECT type, COUNT(*)::int AS count
    FROM guardrails.audit_log, UNNEST(pii_types) AS type
    WHERE true ${workspaceFilter} ${sinceFilter} ${untilFilter}
    GROUP BY type
    ORDER BY count DESC
    LIMIT 5
  `;

  const [topRules] = await sql<Array<{ rule: string; count: number }>>`
    SELECT rule, COUNT(*)::int AS count
    FROM guardrails.audit_log, UNNEST(rules_triggered) AS rule
    WHERE true ${workspaceFilter} ${sinceFilter} ${untilFilter}
    GROUP BY rule
    ORDER BY count DESC
    LIMIT 5
  `;

  return {
    ...stats,
    top_pii_types: topPii,
    top_rules_triggered: topRules,
    pass_rate: stats.total_checks > 0
      ? (100 * stats.pass_count / stats.total_checks).toFixed(2) + "%"
      : "0%",
    block_rate: stats.total_checks > 0
      ? (100 * stats.block_count / stats.total_checks).toFixed(2) + "%"
      : "0%",
  };
}

/**
 * Delete old audit entries (GDPR cleanup, storage management).
 */
export async function pruneAuditLog(
  sql: Sql,
  before: Date,
  workspaceId?: string,
): Promise<number> {
  const r = await sql`
    DELETE FROM guardrails.audit_log
    WHERE created_at < ${before}
      ${workspaceId ? sql`AND workspace_id = ${workspaceId}` : sql``}
    RETURNING id
  `;
  return r.count;
}
