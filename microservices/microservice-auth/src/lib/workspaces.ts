/**
 * Workspace-scoped auth — manage members and roles within workspaces.
 */

import type { Sql } from "postgres";
import { generateToken } from "./tokens.js";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  invited_by: string | null;
  joined_at: string;
}

export interface InviteToken {
  token: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  expires_at: string;
  invited_by: string;
}

/**
 * Create a workspace membership.
 */
export async function addWorkspaceMember(
  sql: Sql,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  invitedBy: string,
): Promise<WorkspaceMember> {
  const [member] = await sql<WorkspaceMember[]>`
    INSERT INTO auth.workspace_members (workspace_id, user_id, role, invited_by)
    VALUES (${workspaceId}, ${userId}, ${role}, ${invitedBy})
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING *
  `;
  return member;
}

/**
 * Remove a user from a workspace.
 */
export async function removeWorkspaceMember(
  sql: Sql,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM auth.workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
  `;
  return result.count > 0;
}

/**
 * List all members of a workspace.
 */
export async function listWorkspaceMembers(
  sql: Sql,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  return sql<WorkspaceMember[]>`
    SELECT * FROM auth.workspace_members
    WHERE workspace_id = ${workspaceId}
    ORDER BY
      CASE role
        WHEN 'owner'   THEN 1
        WHEN 'admin'   THEN 2
        WHEN 'member'  THEN 3
        WHEN 'viewer'  THEN 4
      END,
      joined_at ASC
  `;
}

/**
 * Update a member's role in a workspace.
 */
export async function updateMemberRole(
  sql: Sql,
  workspaceId: string,
  userId: string,
  newRole: WorkspaceRole,
): Promise<boolean> {
  const result = await sql`
    UPDATE auth.workspace_members
    SET role = ${newRole}
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
  `;
  return result.count > 0;
}

/**
 * Get a user's role in a workspace.
 */
export async function getMemberRole(
  sql: Sql,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await sql<[{ role: WorkspaceRole }]>`
    SELECT role FROM auth.workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
  `;
  return row?.role ?? null;
}

/**
 * Create a workspace invite token (sent via email magic link or similar).
 */
export async function inviteToWorkspace(
  sql: Sql,
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
  invitedBy: string,
  ttlHours: number = 72,
): Promise<InviteToken> {
  const token = generateToken();
  const [invite] = await sql<InviteToken[]>`
    INSERT INTO auth.workspace_invites (token, workspace_id, email, role, invited_by, expires_at)
    VALUES (
      ${token},
      ${workspaceId},
      ${email.toLowerCase()},
      ${role},
      ${invitedBy},
      NOW() + ${ttlHours} * INTERVAL '1 hour'
    )
    RETURNING *
  `;
  return invite;
}

/**
 * Accept a workspace invite token and add the user as a member.
 * Returns null if the token is invalid or expired.
 */
export async function acceptWorkspaceInvite(
  sql: Sql,
  token: string,
  userId: string,
  userEmail: string,
): Promise<WorkspaceMember | null> {
  const [invite] = await sql<InviteToken[]>`
    SELECT * FROM auth.workspace_invites
    WHERE token = ${token} AND expires_at > NOW() AND email = ${userEmail.toLowerCase()}
  `;

  if (!invite) return null;

  const member = await addWorkspaceMember(
    sql,
    invite.workspace_id,
    userId,
    invite.role,
    invite.invited_by,
  );

  // Consume the token
  await sql`DELETE FROM auth.workspace_invites WHERE token = ${token}`;

  return member;
}

/**
 * List pending invites for a workspace.
 */
export async function listWorkspaceInvites(
  sql: Sql,
  workspaceId: string,
): Promise<InviteToken[]> {
  return sql<InviteToken[]>`
    SELECT * FROM auth.workspace_invites
    WHERE workspace_id = ${workspaceId} AND expires_at > NOW()
    ORDER BY expires_at ASC
  `;
}

/**
 * Revoke a pending workspace invite.
 */
export async function revokeWorkspaceInvite(
  sql: Sql,
  workspaceId: string,
  email: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM auth.workspace_invites
    WHERE workspace_id = ${workspaceId} AND email = ${email.toLowerCase()}
  `;
  return result.count > 0;
}
