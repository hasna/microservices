/**
 * Permission delegation — allow a user to temporarily grant their permissions to another user.
 */

import type { Sql } from "postgres";

export interface PermissionDelegation {
  id: string;
  grantor_id: string;
  grantee_id: string;
  scopes: string[];
  reason: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface DelegationSummary {
  grants_given: number;
  grants_received: number;
  active_delegations: PermissionDelegation[];
}

/**
 * Grant another user permission to act on your behalf for a limited time.
 * The grantee can use these delegated scopes when their own scopes are insufficient.
 */
export async function createDelegation(
  sql: Sql,
  grantorId: string,
  granteeId: string,
  scopes: string[],
  opts: { reason?: string; ttlHours?: number } = {},
): Promise<PermissionDelegation> {
  if (grantorId === granteeId) throw new Error("Cannot delegate permissions to yourself");
  const ttlHours = opts.ttlHours ?? 24;
  const [row] = await sql<PermissionDelegation[]>`
    INSERT INTO auth.permission_delegations
      (grantor_id, grantee_id, scopes, reason, expires_at)
    VALUES (
      ${grantorId},
      ${granteeId},
      ${scopes},
      ${opts.reason ?? null},
      NOW() + INTERVAL '${String(ttlHours)} hours'
    )
    RETURNING *
  `;
  return row;
}

/**
 * Revoke a delegation early (before it expires).
 */
export async function revokeDelegation(
  sql: Sql,
  delegationId: string,
  grantorId: string,
): Promise<boolean> {
  const [row] = await sql<PermissionDelegation[]>`
    UPDATE auth.permission_delegations
    SET revoked_at = NOW()
    WHERE id = ${delegationId}
      AND grantor_id = ${grantorId}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    RETURNING id
  `;
  return !!row;
}

/**
 * Get all active delegations where the given user is the grantee.
 * These represent permissions the user can currently exercise on behalf of others.
 */
export async function getActiveDelegationsForGrantee(
  sql: Sql,
  granteeId: string,
): Promise<PermissionDelegation[]> {
  const [rows] = await sql<PermissionDelegation[]>`
    SELECT * FROM auth.permission_delegations
    WHERE grantee_id = ${granteeId}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
  return rows;
}

/**
 * Get all active delegations where the given user is the grantor.
 */
export async function getActiveDelegationsForGrantor(
  sql: Sql,
  grantorId: string,
): Promise<PermissionDelegation[]> {
  const [rows] = await sql<PermissionDelegation[]>`
    SELECT * FROM auth.permission_delegations
    WHERE grantor_id = ${grantorId}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
  return rows;
}

/**
 * Check if a user has a specific delegated scope from any active delegation.
 * Returns the effective scopes if valid, otherwise null.
 */
export async function checkDelegatedScope(
  sql: Sql,
  granteeId: string,
  requiredScope: string,
): Promise<string[] | null> {
  const delegations = await getActiveDelegationsForGrantee(sql, granteeId);
  const now = new Date().toISOString();
  for (const d of delegations) {
    if (d.expires_at > now && d.scopes.includes(requiredScope)) {
      return d.scopes;
    }
  }
  return null;
}

/**
 * Get a summary of all delegations (active and historical) for a user.
 */
export async function getDelegationSummary(
  sql: Sql,
  userId: string,
): Promise<DelegationSummary> {
  const [given] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM auth.permission_delegations
    WHERE grantor_id = ${userId}
  `;
  const [received] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM auth.permission_delegations
    WHERE grantee_id = ${userId}
  `;
  const active = await getActiveDelegationsForGrantee(sql, userId);
  return {
    grants_given: Number(given?.count ?? 0),
    grants_received: Number(received?.count ?? 0),
    active_delegations: active,
  };
}
