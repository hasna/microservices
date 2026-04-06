/**
 * OAuth2 authorization code exchange — implements the authorization_code grant flow.
 * Handles: code generation, code exchange, PKCE verification, and nonce validation.
 */

import type { Sql } from "postgres";
import { signJwt, verifyJwt } from "./jwt.js";
import { createOAuthTokenSet } from "./oauth-tokens.js";
import type { OAuthTokenSet } from "./oauth-tokens.js";

export interface AuthorizationCode {
  code: string;
  user_id: string;
  client_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge?: string;
  code_challenge_method?: "S256" | "plain";
  nonce?: string;
  state?: string;
  expires_at: Date;
  used: boolean;
  used_at: Date | null;
}

function generateCode(): string {
  // 128-bit cryptographically random code, base64url encoded
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function getSigningSecret(): string {
  return process.env["JWT_SECRET"] ?? "dev-secret-change-in-production";
}

/**
 * Create a new authorization code for the OAuth flow.
 * The code is returned to the client via the redirect_uri.
 */
export async function createAuthorizationCode(
  sql: Sql,
  opts: {
    userId: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
    codeChallengeMethod?: "S256" | "plain";
    nonce?: string;
    state?: string;
    ttlSeconds?: number;
  },
): Promise<{ code: string; expires_at: Date; state?: string }> {
  const code = generateCode();
  const ttl = opts.ttlSeconds ?? 600; // 10 minutes default
  const expires_at = new Date(Date.now() + ttl * 1000);

  await sql`
    INSERT INTO auth.oauth_authorization_codes (
      code, user_id, client_id, redirect_uri, scopes,
      code_challenge, code_challenge_method, nonce, state,
      expires_at, used
    )
    VALUES (
      ${code}, ${opts.userId}, ${opts.clientId}, ${opts.redirectUri}, ${opts.scopes},
      ${opts.codeChallenge ?? null}, ${opts.codeChallengeMethod ?? null},
      ${opts.nonce ?? null}, ${opts.state ?? null},
      ${expires_at}, FALSE
    )
  `;

  return { code, expires_at, state: opts.state };
}

/**
 * Exchange an authorization code for an access/refresh token pair.
 * Validates code hasn't expired, hasn't been used, and matches client_id + redirect_uri.
 * If PKCE was used, verifies the code_verifier.
 */
export async function exchangeAuthorizationCode(
  sql: Sql,
  opts: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier?: string;
  },
): Promise<OAuthTokenSet> {
  // Fetch the code
  const [authCode] = await sql<any[]>`
    SELECT * FROM auth.oauth_authorization_codes
    WHERE code = ${opts.code}
  `;

  if (!authCode) throw new Error("Authorization code not found");
  if (authCode.used) throw new Error("Authorization code has already been used");
  if (new Date(authCode.expires_at) < new Date()) throw new Error("Authorization code has expired");
  if (authCode.client_id !== opts.clientId) throw new Error("Client ID mismatch");
  if (authCode.redirect_uri !== opts.redirectUri) throw new Error("Redirect URI mismatch");

  // PKCE verification
  if (authCode.code_challenge) {
    const verifier = opts.codeVerifier;
    if (!verifier) throw new Error("Code verifier required (PKCE)");
    if (authCode.code_challenge_method === "S256") {
      // SHA-256 hash of verifier, base64url encoded
      const hash = Buffer.from(
        Buffer.from(verifier).toString("binary")
          .split("")
          .map(c => c.charCodeAt(0))
          .reduce((a, b) => { const prev = a; a = (prev << 8) | b; return a; }, 0 as any)
          .toString("hex")
      ).toString("base64url");
      // Use Web Crypto for proper SHA-256
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashBase64 = Buffer.from(hashBuffer).toString("base64url");
      if (hashBase64 !== authCode.code_challenge) {
        throw new Error("Code verifier does not match code challenge");
      }
    } else {
      if (verifier !== authCode.code_challenge) {
        throw new Error("Code verifier does not match code challenge");
      }
    }
  }

  // Mark code as used
  await sql`
    UPDATE auth.oauth_authorization_codes
    SET used = TRUE, used_at = NOW()
    WHERE code = ${opts.code}
  `;

  // Issue tokens
  const tokenSet = await createOAuthTokenSet(sql, authCode.user_id, authCode.client_id, authCode.scopes);

  // Record the exchange in audit log
  await sql`
    INSERT INTO auth.audit_log (workspace_id, user_id, event_type, metadata)
    VALUES (
      null,
      ${authCode.user_id},
      'oauth_code_exchange',
      ${JSON.stringify({ client_id: opts.clientId, scopes: authCode.scopes })}
    )
  `;

  return tokenSet;
}

/**
 * Validate that an authorization code exists and is valid (not used, not expired).
 */
export async function validateAuthorizationCode(
  sql: Sql,
  opts: { code: string; clientId: string },
): Promise<{ valid: boolean; reason?: string; scopes?: string[]; nonce?: string }> {
  const [authCode] = await sql<any[]>`
    SELECT * FROM auth.oauth_authorization_codes
    WHERE code = ${opts.code}
  `;

  if (!authCode) return { valid: false, reason: "not_found" };
  if (authCode.used) return { valid: false, reason: "already_used" };
  if (new Date(authCode.expires_at) < new Date()) return { valid: false, reason: "expired" };
  if (authCode.client_id !== opts.clientId) return { valid: false, reason: "client_id_mismatch" };

  return {
    valid: true,
    scopes: authCode.scopes,
    nonce: authCode.nonce,
  };
}

/**
 * Revoke all authorization codes for a user+client pair.
 */
export async function revokeAuthorizationCodes(
  sql: Sql,
  opts: { userId: string; clientId: string },
): Promise<number> {
  const result = await sql`
    DELETE FROM auth.oauth_authorization_codes
    WHERE user_id = ${opts.userId} AND client_id = ${opts.clientId}
  `;
  return result.count;
}
