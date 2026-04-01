import type { Sql } from "postgres";

export interface Preference {
  user_id: string;
  channel: string;
  type: string;
  enabled: boolean;
}

export async function getPreference(
  sql: Sql,
  userId: string,
  channel: string,
  type: string,
): Promise<Preference | null> {
  const [p] = await sql<
    Preference[]
  >`SELECT * FROM notify.preferences WHERE user_id = ${userId} AND channel = ${channel} AND type = ${type}`;
  return p ?? null;
}

export async function setPreference(
  sql: Sql,
  userId: string,
  channel: string,
  type: string,
  enabled: boolean,
): Promise<Preference> {
  const [p] = await sql<Preference[]>`
    INSERT INTO notify.preferences (user_id, channel, type, enabled)
    VALUES (${userId}, ${channel}, ${type}, ${enabled})
    ON CONFLICT (user_id, channel, type) DO UPDATE SET enabled = EXCLUDED.enabled
    RETURNING *`;
  return p;
}

export async function getUserPreferences(
  sql: Sql,
  userId: string,
): Promise<Preference[]> {
  return sql<
    Preference[]
  >`SELECT * FROM notify.preferences WHERE user_id = ${userId} ORDER BY channel, type`;
}

/**
 * Returns true if the user has not explicitly disabled the channel+type.
 * Default is enabled when no preference record exists.
 */
export async function isChannelEnabled(
  sql: Sql,
  userId: string,
  channel: string,
  type: string,
): Promise<boolean> {
  const pref = await getPreference(sql, userId, channel, type);
  if (!pref) return true; // default enabled
  return pref.enabled;
}
