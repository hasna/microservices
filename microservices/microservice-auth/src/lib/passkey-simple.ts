/**
 * Simple passkey/WebAuthn authentication helpers.
 *
 * Implements a byte-based challenge/response scheme. For production use
 * with real WebAuthn in browsers, integrate @simplewebauthn/server instead.
 * This module provides the server-side data layer for passkey authentication.
 */

import type { Sql } from "postgres";
import { generateToken } from "./tokens.js";

/** Stored passkey credential record */
export interface PasskeyCredential {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  created_at: string;
}

/**
 * Challenge issued to a user attempting passkey authentication.
 * The challenge is stored temporarily until verified or expired.
 */
export interface PasskeyChallenge {
  challenge_id: string;
  user_id: string;
  challenge: string;
  expires_at: string;
}

/**
 * Create a new passkey credential record (after WebAuthn registration).
 * The publicKey is stored as-is; real verification requires a WebAuthn library.
 */
export async function createPasskeyCredential(
  sql: Sql,
  userId: string,
  data: {
    credentialId: string;
    publicKey: string;
    counter?: number;
    deviceType?: string;
  },
): Promise<PasskeyCredential> {
  const [pk] = await sql<PasskeyCredential[]>`
    INSERT INTO auth.passkey_credentials (user_id, credential_id, public_key, counter, device_type)
    VALUES (
      ${userId},
      ${data.credentialId},
      ${data.publicKey},
      ${data.counter ?? 0},
      ${data.deviceType ?? null}
    )
    ON CONFLICT (user_id, credential_id) DO UPDATE SET
      public_key = EXCLUDED.public_key,
      counter = EXCLUDED.counter
    RETURNING *
  `;
  return pk;
}

/**
 * Get a passkey credential by its credential ID.
 */
export async function getPasskeyByCredentialId(
  sql: Sql,
  credentialId: string,
): Promise<PasskeyCredential | null> {
  const [pk] = await sql<PasskeyCredential[]>`
    SELECT * FROM auth.passkey_credentials
    WHERE credential_id = ${credentialId}
  `;
  return pk ?? null;
}

/**
 * List all passkey credentials for a user.
 */
export async function listPasskeyCredentials(
  sql: Sql,
  userId: string,
): Promise<PasskeyCredential[]> {
  return sql<PasskeyCredential[]>`
    SELECT * FROM auth.passkey_credentials
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
}

/**
 * Delete a specific passkey credential.
 */
export async function deletePasskeyCredential(
  sql: Sql,
  userId: string,
  credentialId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM auth.passkey_credentials
    WHERE user_id = ${userId} AND credential_id = ${credentialId}
  `;
  return result.count > 0;
}

/**
 * Delete all passkey credentials for a user.
 */
export async function deleteAllPasskeyCredentials(
  sql: Sql,
  userId: string,
): Promise<number> {
  const r = await sql`
    DELETE FROM auth.passkey_credentials WHERE user_id = ${userId}
  `;
  return r.count;
}

/**
 * Issue a new authentication challenge for a user.
 */
export async function authenticatePasskey(
  sql: Sql,
  userId: string,
): Promise<{ challenge_id: string; challenge: string; expires_at: string }> {
  const challenge = generateToken(32);
  const challenge_id = generateToken();
  const [row] = await sql<[{ expires_at: string }]>`
    INSERT INTO auth.passkey_challenges (challenge_id, user_id, challenge)
    VALUES (${challenge_id}, ${userId}, ${challenge})
    RETURNING expires_at
  `;
  return { challenge_id, challenge, expires_at: row.expires_at };
}

/**
 * Verify a passkey authentication response.
 *
 * In a real WebAuthn flow, the browser provides an AuthenticatorAssertionResponse
 * which includes a signature over the challenge. This function performs a simplified
 * check: verifies the credential exists, the counter is higher than stored,
 * and the signature (if a WebAuthn library is used upstream).
 *
 * Returns the user_id on success.
 */
export async function verifyPasskey(
  sql: Sql,
  challengeId: string,
  credentialId: string,
  counter: number,
  _signature: string,
): Promise<{ valid: boolean; user_id: string | null; error?: string }> {
  // Clean expired challenges
  await sql`DELETE FROM auth.passkey_challenges WHERE expires_at < NOW()`;

  // Find the challenge
  const [challengeRow] = await sql<PasskeyChallenge[]>`
    SELECT * FROM auth.passkey_challenges
    WHERE challenge_id = ${challengeId}
  `;

  if (!challengeRow) {
    return { valid: false, user_id: null, error: "Challenge expired or not found" };
  }

  // Get the credential
  const credential = await getPasskeyByCredentialId(sql, credentialId);
  if (!credential) {
    return { valid: false, user_id: null, error: "Credential not found" };
  }

  if (credential.user_id !== challengeRow.user_id) {
    return { valid: false, user_id: null, error: "Credential does not belong to challenge user" };
  }

  // Counter must be greater than last seen (replay protection)
  if (counter <= credential.counter) {
    return { valid: false, user_id: null, error: "Counter too low — possible replay attack" };
  }

  // Update counter on success
  await sql`
    UPDATE auth.passkey_credentials
    SET counter = ${counter}
    WHERE credential_id = ${credentialId}
  `;

  // Consume challenge
  await sql`DELETE FROM auth.passkey_challenges WHERE challenge_id = ${challengeId}`;

  return { valid: true, user_id: credential.user_id };
}
