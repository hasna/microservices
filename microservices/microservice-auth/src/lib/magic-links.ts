/**
 * Magic link authentication — generate and verify single-use tokens.
 */

import type { Sql } from "postgres";
import { generateToken } from "./tokens.js";

const MAGIC_LINK_TTL_SECONDS = 15 * 60; // 15 minutes

export async function createMagicLinkToken(sql: Sql, userId: string): Promise<string> {
  const token = generateToken();
  await sql`
    INSERT INTO auth.tokens (user_id, type, token, expires_at)
    VALUES (${userId}, 'magic_link', ${token}, NOW() + ${MAGIC_LINK_TTL_SECONDS} * INTERVAL '1 second')
  `;
  return token;
}

export async function verifyMagicLinkToken(
  sql: Sql,
  token: string
): Promise<{ userId: string } | null> {
  const [row] = await sql<[{ id: string; user_id: string }]>`
    SELECT id, user_id FROM auth.tokens
    WHERE token = ${token}
      AND type = 'magic_link'
      AND expires_at > NOW()
      AND used_at IS NULL
  `;
  if (!row) return null;

  // Mark as used
  await sql`UPDATE auth.tokens SET used_at = NOW() WHERE id = ${row.id}`;
  // Mark user email as verified
  await sql`UPDATE auth.users SET email_verified = TRUE, updated_at = NOW() WHERE id = ${row.user_id}`;

  return { userId: row.user_id };
}

export async function createEmailVerifyToken(sql: Sql, userId: string): Promise<string> {
  const token = generateToken();
  await sql`
    INSERT INTO auth.tokens (user_id, type, token, expires_at)
    VALUES (${userId}, 'email_verify', ${token}, NOW() + INTERVAL '24 hours')
  `;
  return token;
}

export async function verifyEmailToken(sql: Sql, token: string): Promise<boolean> {
  const [row] = await sql<[{ id: string; user_id: string }]>`
    SELECT id, user_id FROM auth.tokens
    WHERE token = ${token} AND type = 'email_verify' AND expires_at > NOW() AND used_at IS NULL
  `;
  if (!row) return false;
  await sql`UPDATE auth.tokens SET used_at = NOW() WHERE id = ${row.id}`;
  await sql`UPDATE auth.users SET email_verified = TRUE, updated_at = NOW() WHERE id = ${row.user_id}`;
  return true;
}

export async function createPasswordResetToken(sql: Sql, userId: string): Promise<string> {
  const token = generateToken();
  await sql`
    INSERT INTO auth.tokens (user_id, type, token, expires_at)
    VALUES (${userId}, 'password_reset', ${token}, NOW() + INTERVAL '1 hour')
  `;
  return token;
}

export async function verifyPasswordResetToken(sql: Sql, token: string): Promise<string | null> {
  const [row] = await sql<[{ id: string; user_id: string }]>`
    SELECT id, user_id FROM auth.tokens
    WHERE token = ${token} AND type = 'password_reset' AND expires_at > NOW() AND used_at IS NULL
  `;
  if (!row) return null;
  await sql`UPDATE auth.tokens SET used_at = NOW() WHERE id = ${row.id}`;
  return row.user_id;
}
