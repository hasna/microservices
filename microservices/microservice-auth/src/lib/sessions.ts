/**
 * Session management — create, validate, revoke.
 */

import type { Sql } from "postgres";
import { generateToken } from "./tokens.js";

export interface Session {
  id: string;
  user_id: string;
  token: string;
  ip: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
}

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function createSession(
  sql: Sql,
  userId: string,
  opts: { ip?: string; user_agent?: string; ttlSeconds?: number } = {}
): Promise<Session> {
  const token = generateToken();
  const ttl = opts.ttlSeconds ?? SESSION_TTL_SECONDS;
  const [session] = await sql<Session[]>`
    INSERT INTO auth.sessions (user_id, token, ip, user_agent, expires_at)
    VALUES (${userId}, ${token}, ${opts.ip ?? null}, ${opts.user_agent ?? null}, NOW() + ${ttl} * INTERVAL '1 second')
    RETURNING *
  `;
  return session;
}

export async function getSessionByToken(sql: Sql, token: string): Promise<Session | null> {
  const [session] = await sql<Session[]>`
    SELECT * FROM auth.sessions
    WHERE token = ${token} AND expires_at > NOW()
  `;
  return session ?? null;
}

export async function listUserSessions(sql: Sql, userId: string): Promise<Session[]> {
  return sql<Session[]>`
    SELECT * FROM auth.sessions
    WHERE user_id = ${userId} AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
}

export async function revokeSession(sql: Sql, token: string): Promise<boolean> {
  const result = await sql`DELETE FROM auth.sessions WHERE token = ${token}`;
  return result.count > 0;
}

export async function revokeAllUserSessions(sql: Sql, userId: string): Promise<number> {
  const result = await sql`DELETE FROM auth.sessions WHERE user_id = ${userId}`;
  return result.count;
}

export async function cleanExpiredSessions(sql: Sql): Promise<number> {
  const result = await sql`DELETE FROM auth.sessions WHERE expires_at <= NOW()`;
  return result.count;
}
