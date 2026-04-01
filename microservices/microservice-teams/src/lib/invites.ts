import type { Sql } from "postgres";
import type { Role } from "./members.js";
import { addMember } from "./members.js";

export interface Invite {
  id: string;
  workspace_id: string;
  email: string;
  role: Role;
  token: string;
  invited_by: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export async function createInvite(
  sql: Sql,
  data: { workspaceId: string; email: string; role?: Role; invitedBy: string },
): Promise<Invite> {
  const [inv] = await sql<Invite[]>`
    INSERT INTO teams.invites (workspace_id, email, role, invited_by)
    VALUES (${data.workspaceId}, ${data.email.toLowerCase()}, ${data.role ?? "member"}, ${data.invitedBy})
    ON CONFLICT (workspace_id, email) DO UPDATE SET role = EXCLUDED.role, expires_at = NOW() + INTERVAL '7 days', accepted_at = NULL
    RETURNING *`;
  return inv;
}

export async function getInviteByToken(
  sql: Sql,
  token: string,
): Promise<Invite | null> {
  const [inv] = await sql<
    Invite[]
  >`SELECT * FROM teams.invites WHERE token = ${token} AND expires_at > NOW() AND accepted_at IS NULL`;
  return inv ?? null;
}

export async function acceptInvite(
  sql: Sql,
  token: string,
  userId: string,
): Promise<{ workspaceId: string; role: Role } | null> {
  const invite = await getInviteByToken(sql, token);
  if (!invite) return null;
  await sql.begin(async (tx: any) => {
    await addMember(tx as any, invite.workspace_id, userId, invite.role);
    await (tx as any)`UPDATE teams.invites SET accepted_at = NOW() WHERE id = ${invite.id}`;
  });
  return { workspaceId: invite.workspace_id, role: invite.role };
}

export async function listWorkspaceInvites(
  sql: Sql,
  workspaceId: string,
): Promise<Invite[]> {
  return sql<
    Invite[]
  >`SELECT * FROM teams.invites WHERE workspace_id = ${workspaceId} AND accepted_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`;
}

export async function revokeInvite(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`DELETE FROM teams.invites WHERE id = ${id}`;
  return r.count > 0;
}
