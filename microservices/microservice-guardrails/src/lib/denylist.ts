/**
 * IP/network denylist — blocks IPs or CIDR ranges from making requests.
 * Complements the allowlist (which allows specific values) with hard blocks.
 */

import type { Sql } from "postgres";

export interface DenylistEntry {
  id: string;
  workspaceId: string | null; // null = global
  ipPattern: string; // exact IP or CIDR notation
  reason: string;
  blockedBy: string;
  expiresAt: Date | null;
  createdAt: Date;
}

export async function addDenylistEntry(
  sql: Sql,
  opts: {
    workspaceId?: string | null;
    ipPattern: string;
    reason: string;
    blockedBy: string;
    expiresAt?: Date | null;
  },
): Promise<DenylistEntry> {
  const [row] = await sql`
    INSERT INTO guardrails.denylist (workspace_id, ip_pattern, reason, blocked_by, expires_at)
    VALUES (
      ${opts.workspaceId ?? null},
      ${opts.ipPattern},
      ${opts.reason},
      ${opts.blockedBy},
      ${opts.expiresAt ?? null}
    )
    RETURNING id, workspace_id, ip_pattern, reason, blocked_by, expires_at, created_at
  `;

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ipPattern: row.ip_pattern,
    reason: row.reason,
    blockedBy: row.blocked_by,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export async function deleteDenylistEntry(
  sql: Sql,
  id: string,
  workspaceId?: string,
): Promise<void> {
  if (workspaceId) {
    await sql`
      DELETE FROM guardrails.denylist
      WHERE id = ${id} AND workspace_id = ${workspaceId}
    `;
  } else {
    await sql`DELETE FROM guardrails.denylist WHERE id = ${id}`;
  }
}

export async function listDenylistEntries(
  sql: Sql,
  workspaceId?: string,
): Promise<DenylistEntry[]> {
  let rows;
  if (workspaceId) {
    rows = await sql`
      SELECT id, workspace_id, ip_pattern, reason, blocked_by, expires_at, created_at
      FROM guardrails.denylist
      WHERE workspace_id = ${workspaceId}
         OR workspace_id IS NULL
      ORDER BY created_at DESC
    `;
  } else {
    rows = await sql`
      SELECT id, workspace_id, ip_pattern, reason, blocked_by, expires_at, created_at
      FROM guardrails.denylist
      ORDER BY created_at DESC
    `;
  }

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    ipPattern: r.ip_pattern,
    reason: r.reason,
    blockedBy: r.blocked_by,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

export async function isIPBlocked(
  sql: Sql,
  ip: string,
  workspaceId?: string,
): Promise<{ blocked: boolean; reason?: string; entryId?: string }> {
  // Clean up expired entries lazily
  await sql`
    DELETE FROM guardrails.denylist
    WHERE expires_at IS NOT NULL AND expires_at < NOW()
  `;

  const rows = await sql`
    SELECT id, ip_pattern, reason
    FROM guardrails.denylist
    WHERE (workspace_id = ${workspaceId ?? null} OR workspace_id IS NULL)
      AND expires_at IS NULL OR expires_at > NOW()
  `;

  for (const row of rows) {
    if (matchesPattern(ip, row.ip_pattern)) {
      return { blocked: true, reason: row.reason, entryId: row.id };
    }
  }

  return { blocked: false };
}

function matchesPattern(ip: string, pattern: string): boolean {
  // Exact match
  if (!pattern.includes("/")) {
    return ip === pattern;
  }

  // CIDR notation: "192.168.1.0/24"
  const [subnet, bitsStr] = pattern.split("/");
  const bits = parseInt(bitsStr, 10);

  const ipParts = ip.split(".").map(Number);
  const subnetParts = subnet.split(".").map(Number);

  if (ipParts.length !== 4 || subnetParts.length !== 4) return false;

  const ipNum =
    (ipParts[0] << 24) |
    (ipParts[1] << 16) |
    (ipParts[2] << 8) |
    ipParts[3];
  const subnetNum =
    (subnetParts[0] << 24) |
    (subnetParts[1] << 16) |
    (subnetParts[2] << 8) |
    subnetParts[3];

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;

  return (ipNum & mask) === (subnetNum & mask);
}
