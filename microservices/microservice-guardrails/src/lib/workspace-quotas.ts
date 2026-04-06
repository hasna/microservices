/**
 * Workspace-level quota management.
 *
 * Unlike per-client rate limits (short sliding windows), quotas track
 * aggregate usage per workspace over longer periods (daily/monthly).
 *
 * Enforces: max_requests, max_tokens, max_bytes per workspace per period.
 */

import type { Sql } from "postgres";

export interface QuotaConfig {
  workspaceId: string;
  period: "daily" | "monthly";
  maxRequests: number;
  maxTokens: number;
  maxBytes: number;
  enabled?: boolean;
}

export interface QuotaStatus {
  allowed: boolean;
  workspaceId: string;
  period: string;
  requestsUsed: number;
  requestsLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  bytesUsed: number;
  bytesLimit: number;
  resetsAt: Date;
  blockedUntil: Date | null;
}

export interface QuotaUsage {
  requests: number;
  tokens: number;
  bytes: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Set quota configuration for a workspace.
 */
export async function setWorkspaceQuota(
  sql: Sql,
  config: QuotaConfig,
): Promise<QuotaConfig> {
  const { workspaceId, period, maxRequests, maxTokens, maxBytes, enabled = true } = config;

  const [row] = await sql<[{
    workspace_id: string;
    period: string;
    max_requests: number;
    max_tokens: number;
    max_bytes: number;
    enabled: boolean;
  }]>`
    INSERT INTO guardrails.workspace_quotas
      (workspace_id, period, max_requests, max_tokens, max_bytes, enabled)
    VALUES (${workspaceId}, ${period}, ${maxRequests}, ${maxTokens}, ${maxBytes}, ${enabled})
    ON CONFLICT (workspace_id, period) DO UPDATE
      SET max_requests = EXCLUDED.max_requests,
          max_tokens = EXCLUDED.max_tokens,
          max_bytes = EXCLUDED.max_bytes,
          enabled = EXCLUDED.enabled
    RETURNING *
  `;

  return {
    workspaceId: row.workspace_id,
    period: row.period as "daily" | "monthly",
    maxRequests: row.max_requests,
    maxTokens: row.max_tokens,
    maxBytes: row.max_bytes,
    enabled: row.enabled,
  };
}

/**
 * Record usage against a workspace quota.
 */
export async function recordQuotaUsage(
  sql: Sql,
  workspaceId: string,
  requests = 0,
  tokens = 0,
  bytes = 0,
): Promise<void> {
  const now = new Date();
  const periodStart = getPeriodStart(now, "daily");
  const periodEnd = getPeriodEnd(now, "daily");

  await sql`
    INSERT INTO guardrails.workspace_quota_usage
      (workspace_id, period, period_start, period_end, requests_used, tokens_used, bytes_used)
    VALUES (
      ${workspaceId},
      'daily',
      ${periodStart},
      ${periodEnd},
      ${requests},
      ${tokens},
      ${bytes}
    )
    ON CONFLICT (workspace_id, period, period_start) DO UPDATE
      SET requests_used = guardrails.workspace_quota_usage.requests_used + EXCLUDED.requests_used,
          tokens_used = guardrails.workspace_quota_usage.tokens_used + EXCLUDED.tokens_used,
          bytes_used = guardrails.workspace_quota_usage.bytes_used + EXCLUDED.bytes_used
  `;
}

/**
 * Check if a workspace is within its quota limits.
 */
export async function checkWorkspaceQuota(
  sql: Sql,
  workspaceId: string,
  requestsToAdd = 0,
  tokensToAdd = 0,
  bytesToAdd = 0,
  period: "daily" | "monthly" = "daily",
): Promise<QuotaStatus> {
  const [quota] = await sql<[{
    workspace_id: string;
    period: string;
    max_requests: number;
    max_tokens: number;
    max_bytes: number;
    enabled: boolean;
  } | undefined]>`
    SELECT * FROM guardrails.workspace_quotas
    WHERE workspace_id = ${workspaceId} AND period = ${period} AND enabled = true
  `;

  if (!quota) {
    return {
      allowed: true,
      workspaceId,
      period,
      requestsUsed: 0,
      requestsLimit: Infinity,
      tokensUsed: 0,
      tokensLimit: Infinity,
      bytesUsed: 0,
      bytesLimit: Infinity,
      resetsAt: getPeriodEnd(new Date(), period),
      blockedUntil: null,
    };
  }

  const now = new Date();
  const periodStart = getPeriodStart(now, period);

  const [usage] = await sql<[{
    requests_used: number;
    tokens_used: number;
    bytes_used: number;
  } | undefined]>`
    SELECT requests_used, tokens_used, bytes_used
    FROM guardrails.workspace_quota_usage
    WHERE workspace_id = ${workspaceId}
      AND period = ${period}
      AND period_start = ${periodStart}
  `;

  const requestsUsed = usage?.requests_used ?? 0;
  const tokensUsed = usage?.tokens_used ?? 0;
  const bytesUsed = usage?.bytes_used ?? 0;

  const requestsOk = requestsUsed + requestsToAdd <= quota.max_requests;
  const tokensOk = tokensUsed + tokensToAdd <= quota.max_tokens;
  const bytesOk = bytesUsed + bytesToAdd <= quota.max_bytes;

  return {
    allowed: requestsOk && tokensOk && bytesOk,
    workspaceId,
    period,
    requestsUsed,
    requestsLimit: quota.max_requests,
    tokensUsed,
    tokensLimit: quota.max_tokens,
    bytesUsed,
    bytesLimit: quota.max_bytes,
    resetsAt: getPeriodEnd(now, period),
    blockedUntil: null,
  };
}

/**
 * Get current quota usage for a workspace.
 */
export async function getWorkspaceQuotaUsage(
  sql: Sql,
  workspaceId: string,
  period: "daily" | "monthly" = "daily",
): Promise<QuotaUsage | null> {
  const now = new Date();
  const periodStart = getPeriodStart(now, period);

  const [usage] = await sql<[{
    requests_used: number;
    tokens_used: number;
    bytes_used: number;
    period_start: Date;
    period_end: Date;
  } | undefined]>`
    SELECT requests_used, tokens_used, bytes_used, period_start, period_end
    FROM guardrails.workspace_quota_usage
    WHERE workspace_id = ${workspaceId}
      AND period = ${period}
      AND period_start = ${periodStart}
  `;

  if (!usage) return null;

  return {
    requests: usage.requests_used,
    tokens: usage.tokens_used,
    bytes: usage.bytes_used,
    periodStart: usage.period_start,
    periodEnd: usage.period_end,
  };
}

/**
 * List quota configurations for all workspaces.
 */
export async function listWorkspaceQuotas(
  sql: Sql,
): Promise<QuotaConfig[]> {
  const rows = await sql`
    SELECT * FROM guardrails.workspace_quotas ORDER BY workspace_id, period
  `;

  return rows.map(row => ({
    workspaceId: row.workspace_id,
    period: row.period as "daily" | "monthly",
    maxRequests: row.max_requests,
    maxTokens: row.max_tokens,
    maxBytes: row.max_bytes,
    enabled: row.enabled,
  }));
}

/**
 * Delete a workspace quota.
 */
export async function deleteWorkspaceQuota(
  sql: Sql,
  workspaceId: string,
  period: "daily" | "monthly",
): Promise<boolean> {
  const [deleted] = await sql`
    DELETE FROM guardrails.workspace_quotas
    WHERE workspace_id = ${workspaceId} AND period = ${period}
    RETURNING id
  `;
  return !!deleted;
}

function getPeriodStart(date: Date, period: "daily" | "monthly"): Date {
  if (period === "daily") {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  } else {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

function getPeriodEnd(date: Date, period: "daily" | "monthly"): Date {
  if (period === "daily") {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  } else {
    const d = new Date(date);
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
