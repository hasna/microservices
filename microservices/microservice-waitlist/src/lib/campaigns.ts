/**
 * Campaign CRUD operations for microservice-waitlist.
 */

import type { Sql } from "postgres";

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "closed";
  created_at: Date;
}

export interface CreateCampaignInput {
  name: string;
  description?: string;
  status?: "active" | "paused" | "closed";
}

export interface UpdateCampaignInput {
  name?: string;
  description?: string;
  status?: "active" | "paused" | "closed";
}

export async function createCampaign(
  sql: Sql,
  data: CreateCampaignInput,
): Promise<Campaign> {
  const [campaign] = await sql<Campaign[]>`
    INSERT INTO waitlist.campaigns (name, description, status)
    VALUES (
      ${data.name},
      ${data.description ?? null},
      ${data.status ?? "active"}
    )
    RETURNING *
  `;
  return campaign;
}

export async function getCampaign(
  sql: Sql,
  id: string,
): Promise<Campaign | null> {
  const [campaign] = await sql<Campaign[]>`
    SELECT * FROM waitlist.campaigns WHERE id = ${id}
  `;
  return campaign ?? null;
}

export async function listCampaigns(
  sql: Sql,
  status?: string,
): Promise<Campaign[]> {
  if (status) {
    return sql<Campaign[]>`
      SELECT * FROM waitlist.campaigns WHERE status = ${status} ORDER BY created_at DESC
    `;
  }
  return sql<Campaign[]>`
    SELECT * FROM waitlist.campaigns ORDER BY created_at DESC
  `;
}

export async function updateCampaign(
  sql: Sql,
  id: string,
  data: UpdateCampaignInput,
): Promise<Campaign | null> {
  const updates: any = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.status !== undefined) updates.status = data.status;

  if (Object.keys(updates).length === 0) {
    return getCampaign(sql, id);
  }

  const setClauses = Object.keys(updates)
    .map((k, i) => `${k} = $${i + 2}`)
    .join(", ");
  const values = [id, ...Object.values(updates)];
  const query = `UPDATE waitlist.campaigns SET ${setClauses} WHERE id = $1 RETURNING *`;

  const [campaign] = (await sql.unsafe(query, values as any[])) as Campaign[];
  return campaign ?? null;
}
