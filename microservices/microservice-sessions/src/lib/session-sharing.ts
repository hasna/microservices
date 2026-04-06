/**
 * Session sharing — ACL-based sharing of sessions with users or teams.
 */

import type { Sql } from "postgres";

export type ShareRole = "viewer" | "commenter" | "editor" | "admin";

export interface SessionShare {
  session_id: string;
  share_type: "user" | "team";
  principal_id: string;
  role: ShareRole;
  shared_by: string;
  shared_at: string;
  expires_at: string | null;
  note: string | null;
}

export interface ShareResult {
  session_id: string;
  principal_id: string;
  share_type: "user" | "team";
  role: ShareRole;
  shared: boolean;
}

/**
 * Share a session with a user or team.
 */
export async function shareSession(
  sql: Sql,
  sessionId: string,
  shareType: "user" | "team",
  principalId: string,
  role: ShareRole,
  sharedBy: string,
  expiresAt?: string,
  note?: string,
): Promise<ShareResult> {
  if (role === "admin") {
    const [existing] = await sql<{ role: string }[]>`
      SELECT role FROM sessions.session_shares
      WHERE session_id = ${sessionId}
        AND share_type = ${shareType}
        AND principal_id = ${principalId}
    `;
    if (existing) {
      await sql`
        UPDATE sessions.session_shares
        SET role = ${role}, shared_by = ${sharedBy}, expires_at = ${expiresAt ?? null}, note = ${note ?? null}
        WHERE session_id = ${sessionId}
          AND share_type = ${shareType}
          AND principal_id = ${principalId}
      `;
    } else {
      await sql`
        INSERT INTO sessions.session_shares (session_id, share_type, principal_id, role, shared_by, expires_at, note)
        VALUES (${sessionId}, ${shareType}, ${principalId}, ${role}, ${sharedBy}, ${expiresAt ?? null}, ${note ?? null})
      `;
    }
    return { session_id: sessionId, principal_id: principalId, share_type: shareType, role, shared: true };
  }

  // Upsert for non-admin roles
  await sql`
    INSERT INTO sessions.session_shares (session_id, share_type, principal_id, role, shared_by, expires_at, note)
    VALUES (${sessionId}, ${shareType}, ${principalId}, ${role}, ${sharedBy}, ${expiresAt ?? null}, ${note ?? null})
    ON CONFLICT (session_id, share_type, principal_id)
    DO UPDATE SET role = ${role}, shared_by = ${sharedBy}, expires_at = ${expiresAt ?? null}, note = ${note ?? null}
  `;
  return { session_id: sessionId, principal_id: principalId, share_type: shareType, role, shared: true };
}

/**
 * Revoke a session share.
 */
export async function revokeSessionShare(
  sql: Sql,
  sessionId: string,
  shareType: "user" | "team",
  principalId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM sessions.session_shares
    WHERE session_id = ${sessionId}
      AND share_type = ${shareType}
      AND principal_id = ${principalId}
    RETURNING session_id
  `;
  return result.count > 0;
}

/**
 * List all shares for a session.
 */
export async function listSessionShares(
  sql: Sql,
  sessionId: string,
): Promise<SessionShare[]> {
  return sql<SessionShare>`
    SELECT session_id, share_type, principal_id, role, shared_by,
           shared_at::text, expires_at::text, note
    FROM sessions.session_shares
    WHERE session_id = ${sessionId}
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY shared_at DESC
  `;
}

/**
 * List all sessions shared with a user (directly or via team).
 */
export async function listSharedWithMe(
  sql: Sql,
  userId: string,
  limit = 50,
  offset = 0,
): Promise<SessionShare[]> {
  return sql<SessionShare>`
    SELECT sh.session_id, sh.share_type, sh.principal_id, sh.role,
           sh.shared_by, sh.shared_at::text, sh.expires_at::text, sh.note
    FROM sessions.session_shares sh
    WHERE sh.share_type = 'user'
      AND sh.principal_id = ${userId}
      AND (sh.expires_at IS NULL OR sh.expires_at > NOW())
    UNION
    SELECT sh.session_id, sh.share_type, sh.principal_id, sh.role,
           sh.shared_by, sh.shared_at::text, sh.expires_at::text, sh.note
    FROM sessions.session_shares sh
    JOIN sessions.team_memberships tm ON tm.team_id = sh.principal_id
    WHERE sh.share_type = 'team'
      AND tm.user_id = ${userId}
      AND (sh.expires_at IS NULL OR sh.expires_at > NOW())
    ORDER BY shared_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Check if a principal has a given minimum role on a session.
 */
export async function checkSessionAccess(
  sql: Sql,
  sessionId: string,
  principalId: string,
  principalType: "user" | "team",
  minRole: ShareRole,
): Promise<boolean> {
  const roleOrder: Record<ShareRole, number> = { viewer: 1, commenter: 2, editor: 3, admin: 4 };

  // Check direct user share
  const directRows = await sql<{ role: ShareRole }[]>`
    SELECT role FROM sessions.session_shares
    WHERE session_id = ${sessionId}
      AND share_type = 'user'
      AND principal_id = ${principalId}
      AND (expires_at IS NULL OR expires_at > NOW())
  `;

  if (directRows.length > 0) {
    return roleOrder[directRows[0].role] >= roleOrder[minRole];
  }

  // Check team membership
  if (principalType === "team") {
    const teamRows = await sql<{ role: ShareRole }[]>`
      SELECT sh.role FROM sessions.session_shares sh
      JOIN sessions.team_memberships tm ON tm.team_id = sh.principal_id
      WHERE sh.session_id = ${sessionId}
        AND sh.share_type = 'team'
        AND tm.user_id = ${principalId}
        AND (sh.expires_at IS NULL OR sh.expires_at > NOW())
    `;
    if (teamRows.length > 0) {
      return roleOrder[teamRows[0].role] >= roleOrder[minRole];
    }
  }

  return false;
}

/**
 * Bulk share a session with multiple principals.
 */
export async function bulkShareSession(
  sql: Sql,
  sessionId: string,
  shares: Array<{ share_type: "user" | "team"; principal_id: string; role: ShareRole }>,
  sharedBy: string,
): Promise<number> {
  let count = 0;
  for (const s of shares) {
    await shareSession(sql, sessionId, s.share_type, s.principal_id, s.role, sharedBy);
    count++;
  }
  return count;
}

/**
 * List all sessions I have shared with others.
 */
export async function listSessionsSharedByMe(
  sql: Sql,
  userId: string,
  limit = 50,
  offset = 0,
): Promise<SessionShare[]> {
  return sql<SessionShare>`
    SELECT session_id, share_type, principal_id, role, shared_by,
           shared_at::text, expires_at::text, note
    FROM sessions.session_shares
    WHERE shared_by = ${userId}
    ORDER BY shared_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}
