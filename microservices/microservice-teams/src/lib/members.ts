import type { Sql } from "postgres";

export type Role = "owner" | "admin" | "member" | "viewer";

export interface Member {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  created_at: string;
  updated_at: string;
}

const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export async function getMember(
  sql: Sql,
  workspaceId: string,
  userId: string,
): Promise<Member | null> {
  const [m] = await sql<
    Member[]
  >`SELECT * FROM teams.members WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`;
  return m ?? null;
}

export async function listMembers(
  sql: Sql,
  workspaceId: string,
): Promise<Member[]> {
  return sql<
    Member[]
  >`SELECT * FROM teams.members WHERE workspace_id = ${workspaceId} ORDER BY created_at`;
}

export async function addMember(
  sql: Sql,
  workspaceId: string,
  userId: string,
  role: Role = "member",
): Promise<Member> {
  const [m] = await sql<Member[]>`
    INSERT INTO teams.members (workspace_id, user_id, role) VALUES (${workspaceId}, ${userId}, ${role})
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
    RETURNING *`;
  return m;
}

export async function updateMemberRole(
  sql: Sql,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<Member | null> {
  const [m] = await sql<Member[]>`
    UPDATE teams.members SET role = ${role}, updated_at = NOW()
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId} RETURNING *`;
  return m ?? null;
}

export async function removeMember(
  sql: Sql,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const r =
    await sql`DELETE FROM teams.members WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND role != 'owner'`;
  return r.count > 0;
}

export async function checkPermission(
  sql: Sql,
  workspaceId: string,
  userId: string,
  minRole: Role,
): Promise<boolean> {
  const member = await getMember(sql, workspaceId, userId);
  if (!member) return false;
  return ROLE_RANK[member.role] >= ROLE_RANK[minRole];
}

export async function transferOwnership(
  sql: Sql,
  workspaceId: string,
  currentOwnerId: string,
  newOwnerId: string,
): Promise<void> {
  await sql.begin(async (tx: any) => {
    await (tx as any)`UPDATE teams.members SET role = 'admin', updated_at = NOW() WHERE workspace_id = ${workspaceId} AND user_id = ${currentOwnerId}`;
    await (tx as any)`UPDATE teams.members SET role = 'owner', updated_at = NOW() WHERE workspace_id = ${workspaceId} AND user_id = ${newOwnerId}`;
    await (tx as any)`UPDATE teams.workspaces SET owner_id = ${newOwnerId}, updated_at = NOW() WHERE id = ${workspaceId}`;
  });
}
