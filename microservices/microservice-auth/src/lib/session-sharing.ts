/**
 * Session sharing — generate expiring links to share authenticated sessions
 * with other users or external parties for collaborative debugging.
 */

import type { Sql } from "postgres";
import { generateToken } from "./tokens.js";

export interface SessionShareLink {
  id: string;
  session_id: string;
  token: string;
  created_by: string;
  recipient_email: string | null;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  is_revoked: boolean;
  created_at: string;
}

export interface SessionViewerContext {
  session_id: string;
  user_id: string;
  ip: string | null;
  user_agent: string | null;
  is_trusted: boolean;
  expires_at: string;
  created_at: string;
  shared_by_email: string;
}

/**
 * Create a shareable link for a session with optional expiration and usage limits.
 */
export async function createSessionShareLink(
  sql: Sql,
  sessionId: string,
  createdBy: string,
  opts: {
    recipientEmail?: string;
    expiresInSeconds?: number;
    maxUses?: number;
  } = {},
): Promise<SessionShareLink> {
  const token = generateToken();
  const ttlSeconds = opts.expiresInSeconds ?? 3600; // Default 1 hour
  const [link] = await sql<SessionShareLink[]>`
    INSERT INTO auth.session_share_links (
      session_id, token, created_by, recipient_email,
      expires_at, max_uses, use_count, is_revoked
    )
    VALUES (
      ${sessionId}, ${token}, ${createdBy},
      ${opts.recipientEmail ?? null},
      NOW() + ${ttlSeconds} * INTERVAL '1 second',
      ${opts.maxUses ?? null},
      0, false
    )
    RETURNING *
  `;
  return link;
}

/**
 * Validate and consume a session share link — returns session context if valid.
 */
export async function validateSessionShareLink(
  sql: Sql,
  token: string,
): Promise<SessionViewerContext | null> {
  // Get the link
  const [link] = await sql<SessionShareLink[]>`
    SELECT sl.*, s.user_id, s.ip, s.user_agent, s.is_trusted,
           s.expires_at, s.created_at,
           u.email as shared_by_email
    FROM auth.session_share_links sl
    JOIN auth.sessions s ON sl.session_id = s.id
    JOIN auth.users u ON sl.created_by = u.id
    WHERE sl.token = ${token}
      AND sl.is_revoked = false
      AND sl.expires_at > NOW()
      AND (sl.max_uses IS NULL OR sl.use_count < sl.max_uses)
  `;

  if (!link) return null;

  // Increment use count
  await sql`
    UPDATE auth.session_share_links
    SET use_count = use_count + 1
    WHERE id = ${link.id}
  `;

  return {
    session_id: link.session_id,
    user_id: (link as any).user_id,
    ip: (link as any).ip,
    user_agent: (link as any).user_agent,
    is_trusted: (link as any).is_trusted,
    expires_at: (link as any).expires_at,
    created_at: (link as any).created_at,
    shared_by_email: (link as any).shared_by_email,
  };
}

/**
 * List all share links for a session.
 */
export async function listSessionShareLinks(
  sql: Sql,
  sessionId: string,
): Promise<SessionShareLink[]> {
  return sql<SessionShareLink[]>`
    SELECT * FROM auth.session_share_links
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC
  `;
}

/**
 * Revoke a share link.
 */
export async function revokeSessionShareLink(
  sql: Sql,
  linkId: string,
  revokedBy: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE auth.session_share_links
    SET is_revoked = true
    WHERE id = ${linkId}
      AND created_by = ${revokedBy}
  `;
  return result.count > 0;
}

/**
 * Revoke all share links for a session.
 */
export async function revokeAllSessionShareLinks(
  sql: Sql,
  sessionId: string,
  revokedBy: string,
): Promise<number> {
  const result = await sql`
    UPDATE auth.session_share_links
    SET is_revoked = true
    WHERE session_id = ${sessionId}
      AND created_by = ${revokedBy}
  `;
  return result.count;
}