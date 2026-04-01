/**
 * OAuth account linking — connect external providers to users.
 */

import type { Sql } from "postgres";

export interface OAuthAccount {
  id: string;
  user_id: string;
  provider: string;
  provider_id: string;
  created_at: string;
}

export async function upsertOAuthAccount(
  sql: Sql,
  data: {
    userId: string;
    provider: string;
    providerId: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
  },
): Promise<OAuthAccount> {
  const [row] = await sql<OAuthAccount[]>`
    INSERT INTO auth.oauth_accounts (user_id, provider, provider_id, access_token, refresh_token, expires_at)
    VALUES (${data.userId}, ${data.provider}, ${data.providerId},
            ${data.accessToken ?? null}, ${data.refreshToken ?? null}, ${data.expiresAt?.toISOString() ?? null})
    ON CONFLICT (provider, provider_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at
    RETURNING id, user_id, provider, provider_id, created_at
  `;
  return row;
}

export async function getOAuthAccount(
  sql: Sql,
  provider: string,
  providerId: string,
): Promise<OAuthAccount | null> {
  const [row] = await sql<OAuthAccount[]>`
    SELECT id, user_id, provider, provider_id, created_at
    FROM auth.oauth_accounts WHERE provider = ${provider} AND provider_id = ${providerId}
  `;
  return row ?? null;
}

export async function listUserOAuthAccounts(
  sql: Sql,
  userId: string,
): Promise<OAuthAccount[]> {
  return sql<OAuthAccount[]>`
    SELECT id, user_id, provider, provider_id, created_at
    FROM auth.oauth_accounts WHERE user_id = ${userId}
    ORDER BY created_at
  `;
}

export async function unlinkOAuthAccount(
  sql: Sql,
  userId: string,
  provider: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM auth.oauth_accounts WHERE user_id = ${userId} AND provider = ${provider}
  `;
  return result.count > 0;
}
