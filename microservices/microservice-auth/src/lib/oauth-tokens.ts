/**
 * OAuth2 token management — access tokens, refresh tokens, scopes, and expiration.
 * Handles the full OAuth2 token lifecycle for third-party integrations.
 */

import type { Sql } from "postgres";
import { signJwt, verifyJwt } from "./jwt.js";

export interface OAuthTokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;        // seconds
  token_type: "Bearer";
  scope: string;
}

export interface StoredOAuthToken {
  id: string;
  user_id: string;
  client_id: string;
  access_token: string;
  refresh_token_hash: string;
  scopes: string[];
  expires_at: Date;
  created_at: Date;
  last_used_at: Date | null;
}

export interface OAuthClient {
  id: string;
  name: string;
  redirect_uris: string[];
  scopes: string[];        // allowed scopes
  is_active: boolean;
  created_at: Date;
}

// Token config
const ACCESS_TOKEN_TTL = 3600;      // 1 hour
const REFRESH_TOKEN_TTL = 2592000;  // 30 days

function getSigningSecret(): string {
  return process.env["JWT_SECRET"] ?? "dev-secret-change-in-production";
}

/**
 * Create a new OAuth token set for a client+user combination.
 */
export async function createOAuthTokenSet(
  sql: Sql,
  userId: string,
  clientId: string,
  scopes: string[],
  opts?: { accessTokenTtl?: number; refreshTokenTtl?: number },
): Promise<OAuthTokenSet> {
  const accessTtl = opts?.accessTokenTtl ?? ACCESS_TOKEN_TTL;
  const refreshTtl = opts?.refreshTokenTtl ?? REFRESH_TOKEN_TTL;

  const accessToken = signJwt(
    { sub: userId, client_id: clientId, type: "oauth_access", scopes },
    getSigningSecret(),
    accessTtl,
  );

  const refreshToken = signJwt(
    { sub: userId, client_id: clientId, type: "oauth_refresh", scopes },
    getSigningSecret(),
    refreshTtl,
  );

  const refreshHash = await hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + accessTtl * 1000);

  const [stored] = await sql<StoredOAuthToken[]>`
    INSERT INTO auth.oauth_tokens
      (user_id, client_id, access_token, refresh_token_hash, scopes, expires_at)
    VALUES (
      ${userId}, ${clientId}, ${accessToken}, ${refreshHash}, ${scopes}, ${expiresAt}
    )
    RETURNING *
  `;

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: accessTtl,
    token_type: "Bearer",
    scope: scopes.join(" "),
  };
}

/**
 * Validate an OAuth access token and return its claims.
 */
export async function validateOAuthToken(
  sql: Sql,
  accessToken: string,
): Promise<{ userId: string; clientId: string; scopes: string[] } | null> {
  const payload = verifyJwt(accessToken, getSigningSecret());
  if (!payload || payload.type !== "oauth_access") return null;

  // Check not expired (jwt library handles expiry, but double-check DB)
  const [stored] = await sql<StoredOAuthToken[]>`
    SELECT * FROM auth.oauth_tokens
    WHERE access_token = ${accessToken}
      AND expires_at > NOW()
  `;
  if (!stored) return null;

  // Update last_used_at
  await sql`UPDATE auth.oauth_tokens SET last_used_at = NOW() WHERE access_token = ${accessToken}`.catch(() => {});

  return {
    userId: payload.sub as string,
    clientId: payload.client_id as string,
    scopes: payload.scopes as string[],
  };
}

/**
 * Refresh an OAuth access token using a refresh token.
 */
export async function refreshOAuthToken(
  sql: Sql,
  refreshToken: string,
): Promise<OAuthTokenSet | null> {
  const payload = verifyJwt(refreshToken, getSigningSecret());
  if (!payload || payload.type !== "oauth_refresh") return null;

  const refreshHash = await hashToken(refreshToken);

  // Find the stored token with matching refresh token hash
  const [stored] = await sql<StoredOAuthToken[]>`
    SELECT * FROM auth.oauth_tokens
    WHERE refresh_token_hash = ${refreshHash}
      AND user_id = ${payload.sub}
      AND client_id = ${payload.client_id}
  `;
  if (!stored) return null;

  // Revoke old tokens
  await sql`DELETE FROM auth.oauth_tokens WHERE id = ${stored.id}`.catch(() => {});

  // Create new token set
  return createOAuthTokenSet(sql, stored.user_id, stored.client_id, stored.scopes);
}

/**
 * Revoke an OAuth token (logout from a third-party app).
 */
export async function revokeOAuthToken(
  sql: Sql,
  accessToken: string,
): Promise<boolean> {
  const result = await sql`DELETE FROM auth.oauth_tokens WHERE access_token = ${accessToken}`;
  return (result as any).count > 0;
}

/**
 * Revoke all OAuth tokens for a user+client combination.
 */
export async function revokeAllUserClientTokens(
  sql: Sql,
  userId: string,
  clientId: string,
): Promise<number> {
  const result = await sql`
    DELETE FROM auth.oauth_tokens WHERE user_id = ${userId} AND client_id = ${clientId}
  `;
  return (result as any).count ?? 0;
}

/**
 * List active OAuth tokens for a user.
 */
export async function listUserOAuthTokens(
  sql: Sql,
  userId: string,
): Promise<{ client_id: string; scopes: string[]; created_at: Date; expires_at: Date; last_used_at: Date | null }[]> {
  const [rows] = await sql<any[]>`
    SELECT client_id, scopes, created_at, expires_at, last_used_at
    FROM auth.oauth_tokens
    WHERE user_id = ${userId} AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
  return rows;
}

// Simple hash using Web Crypto API
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Register an OAuth client application.
 */
export async function registerOAuthClient(
  sql: Sql,
  name: string,
  redirectUris: string[],
  scopes: string[],
): Promise<{ client: OAuthClient; client_secret: string }> {
  const clientSecret = generateClientSecret();
  const secretHash = await hashToken(clientSecret);

  const [row] = await sql<OAuthClient[]>`
    INSERT INTO auth.oauth_clients (name, redirect_uris, scopes, client_secret_hash, is_active)
    VALUES (${name}, ${redirectUris}, ${scopes}, ${secretHash}, true)
    RETURNING *
  `;

  return { client: row, client_secret: clientSecret };
}

/**
 * Validate a client credentials (for client_credentials grant type).
 */
export async function validateClientCredentials(
  sql: Sql,
  clientId: string,
  clientSecret: string,
): Promise<boolean> {
  const secretHash = await hashToken(clientSecret);
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM auth.oauth_clients
    WHERE id = ${clientId} AND client_secret_hash = ${secretHash} AND is_active = true
  `;
  return !!row;
}

function generateClientSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}