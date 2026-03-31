import type { Sql } from "postgres";

export interface Workspace {
  id: string; name: string; slug: string; owner_id: string;
  metadata: Record<string, unknown>; created_at: string; updated_at: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function createWorkspace(sql: Sql, data: { name: string; ownerId: string; slug?: string }): Promise<Workspace> {
  const slug = data.slug ?? `${slugify(data.name)}-${crypto.randomUUID().slice(0, 8)}`;
  const [ws] = await sql<Workspace[]>`
    INSERT INTO teams.workspaces (name, slug, owner_id) VALUES (${data.name}, ${slug}, ${data.ownerId})
    RETURNING *`;
  // Auto-add owner as member
  await sql`INSERT INTO teams.members (workspace_id, user_id, role) VALUES (${ws.id}, ${data.ownerId}, 'owner') ON CONFLICT DO NOTHING`;
  return ws;
}

export async function getWorkspace(sql: Sql, id: string): Promise<Workspace | null> {
  const [ws] = await sql<Workspace[]>`SELECT * FROM teams.workspaces WHERE id = ${id}`;
  return ws ?? null;
}

export async function getWorkspaceBySlug(sql: Sql, slug: string): Promise<Workspace | null> {
  const [ws] = await sql<Workspace[]>`SELECT * FROM teams.workspaces WHERE slug = ${slug}`;
  return ws ?? null;
}

export async function listUserWorkspaces(sql: Sql, userId: string): Promise<Workspace[]> {
  return sql<Workspace[]>`
    SELECT w.* FROM teams.workspaces w
    JOIN teams.members m ON m.workspace_id = w.id
    WHERE m.user_id = ${userId} ORDER BY w.created_at DESC`;
}

export async function updateWorkspace(sql: Sql, id: string, data: { name?: string }): Promise<Workspace | null> {
  const [ws] = await sql<Workspace[]>`
    UPDATE teams.workspaces SET name = COALESCE(${data.name ?? null}, name), updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return ws ?? null;
}

export async function deleteWorkspace(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`DELETE FROM teams.workspaces WHERE id = ${id}`;
  return r.count > 0;
}
