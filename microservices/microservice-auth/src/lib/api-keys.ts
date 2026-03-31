/**
 * API key management — create, validate, revoke.
 */

import type { Sql } from "postgres";
import { generateApiKey, hashToken } from "./tokens.js";

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyWithSecret extends ApiKey {
  key: string; // Only returned on creation, never stored
}

export async function createApiKey(
  sql: Sql,
  userId: string,
  opts: { name: string; scopes?: string[]; expiresAt?: Date }
): Promise<ApiKeyWithSecret> {
  const { key, prefix, hash } = generateApiKey();
  const keyHash = await hash;

  const [row] = await sql<ApiKey[]>`
    INSERT INTO auth.api_keys (user_id, name, key_hash, key_prefix, scopes, expires_at)
    VALUES (
      ${userId}, ${opts.name}, ${keyHash}, ${prefix},
      ${opts.scopes ?? []}, ${opts.expiresAt?.toISOString() ?? null}
    )
    RETURNING id, user_id, name, key_prefix, scopes, expires_at, last_used_at, created_at
  `;

  return { ...row, key };
}

export async function validateApiKey(
  sql: Sql,
  key: string
): Promise<{ userId: string; scopes: string[] } | null> {
  const keyHash = await hashToken(key);
  const [row] = await sql<[{ user_id: string; scopes: string[]; expires_at: string | null }]>`
    SELECT user_id, scopes, expires_at FROM auth.api_keys
    WHERE key_hash = ${keyHash}
  `;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // Update last_used_at asynchronously
  sql`UPDATE auth.api_keys SET last_used_at = NOW() WHERE key_hash = ${keyHash}`.catch(() => {});

  return { userId: row.user_id, scopes: row.scopes };
}

export async function listApiKeys(sql: Sql, userId: string): Promise<ApiKey[]> {
  return sql<ApiKey[]>`
    SELECT id, user_id, name, key_prefix, scopes, expires_at, last_used_at, created_at
    FROM auth.api_keys WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
}

export async function revokeApiKey(sql: Sql, id: string, userId: string): Promise<boolean> {
  const result = await sql`DELETE FROM auth.api_keys WHERE id = ${id} AND user_id = ${userId}`;
  return result.count > 0;
}
