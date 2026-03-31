/**
 * User management — create, get, update, delete.
 */

import type { Sql } from "postgres";
import { hashPassword } from "./passwords.js";

export interface User {
  id: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  avatar_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function createUser(
  sql: Sql,
  data: { email: string; password?: string; name?: string }
): Promise<User> {
  const password_hash = data.password ? await hashPassword(data.password) : null;
  const [user] = await sql<User[]>`
    INSERT INTO auth.users (email, password_hash, name)
    VALUES (${data.email.toLowerCase()}, ${password_hash}, ${data.name ?? null})
    RETURNING id, email, email_verified, name, avatar_url, metadata, created_at, updated_at
  `;
  return user;
}

export async function getUserById(sql: Sql, id: string): Promise<User | null> {
  const [user] = await sql<User[]>`
    SELECT id, email, email_verified, name, avatar_url, metadata, created_at, updated_at
    FROM auth.users WHERE id = ${id}
  `;
  return user ?? null;
}

export async function getUserByEmail(sql: Sql, email: string): Promise<(User & { password_hash: string | null }) | null> {
  const [user] = await sql<(User & { password_hash: string | null })[]>`
    SELECT id, email, email_verified, name, avatar_url, metadata, password_hash, created_at, updated_at
    FROM auth.users WHERE email = ${email.toLowerCase()}
  `;
  return user ?? null;
}

export async function listUsers(sql: Sql, opts: { limit?: number; offset?: number } = {}): Promise<User[]> {
  return sql<User[]>`
    SELECT id, email, email_verified, name, avatar_url, metadata, created_at, updated_at
    FROM auth.users
    ORDER BY created_at DESC
    LIMIT ${opts.limit ?? 50} OFFSET ${opts.offset ?? 0}
  `;
}

export async function updateUser(
  sql: Sql,
  id: string,
  data: { name?: string; avatar_url?: string; email_verified?: boolean; metadata?: Record<string, unknown> }
): Promise<User | null> {
  const [user] = await sql<User[]>`
    UPDATE auth.users SET
      name = COALESCE(${data.name ?? null}, name),
      avatar_url = COALESCE(${data.avatar_url ?? null}, avatar_url),
      email_verified = COALESCE(${data.email_verified ?? null}, email_verified),
      metadata = CASE WHEN ${data.metadata ?? null}::jsonb IS NOT NULL THEN ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb ELSE metadata END,
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, email, email_verified, name, avatar_url, metadata, created_at, updated_at
  `;
  return user ?? null;
}

export async function deleteUser(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM auth.users WHERE id = ${id}`;
  return result.count > 0;
}

export async function countUsers(sql: Sql): Promise<number> {
  const [{ count }] = await sql<[{ count: string }]>`SELECT COUNT(*) as count FROM auth.users`;
  return parseInt(count, 10);
}
