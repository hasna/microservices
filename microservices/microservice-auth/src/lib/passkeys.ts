/**
 * WebAuthn / Passkey support.
 *
 * This module handles the server-side portion of the WebAuthn registration
 * and authentication flows. The actual cryptographic signature verification
 * should be performed using a WebAuthn library (e.g. @simplewebauthn/server)
 * in your application — this module provides the data-layer helpers and
 * structured options generators.
 */

import type { Sql } from "postgres";

export interface Passkey {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  device_type: string | null;
  backed_up: boolean;
  transport: string[] | null;
  rp_id: string | null;
  authenticator_label: string | null;
  created_at: string;
  last_used_at: string | null;
  passkey_count: number | null;
}

export interface CreatePasskeyData {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter?: number;
  deviceType?: string;
  backedUp?: boolean;
  transport?: string[];
  rpId?: string;
  authenticatorLabel?: string;
}

/**
 * Store a new passkey credential after successful WebAuthn registration.
 */
export async function createPasskey(
  sql: Sql,
  data: CreatePasskeyData,
): Promise<Passkey> {
  const [pk] = await sql<Passkey[]>`
    INSERT INTO auth.passkeys (
      user_id, credential_id, public_key, counter,
      device_type, backed_up, transport, rp_id, authenticator_label
    )
    VALUES (
      ${data.userId},
      ${data.credentialId},
      ${data.publicKey},
      ${data.counter ?? 0},
      ${data.deviceType ?? null},
      ${data.backedUp ?? false},
      ${data.transport ?? null},
      ${data.rpId ?? null},
      ${data.authenticatorLabel ?? null}
    )
    RETURNING *
  `;

  // Increment user's passkey count
  await sql`
    UPDATE auth.users
    SET passkey_count = passkey_count + 1
    WHERE id = ${data.userId}
  `;

  return pk;
}

/**
 * Get a passkey by credential ID (used during authentication).
 */
export async function getPasskeyByCredentialId(
  sql: Sql,
  credentialId: string,
): Promise<Passkey | null> {
  const [pk] = await sql<Passkey[]>`
    SELECT p.*, u.passkey_count
    FROM auth.passkeys p
    INNER JOIN auth.users u ON p.user_id = u.id
    WHERE p.credential_id = ${credentialId}
  `;
  return pk ?? null;
}

/**
 * List all passkeys for a user.
 */
export async function listPasskeys(
  sql: Sql,
  userId: string,
): Promise<Passkey[]> {
  return sql<Passkey[]>`
    SELECT p.*, u.passkey_count
    FROM auth.passkeys p
    INNER JOIN auth.users u ON p.user_id = u.id
    WHERE p.user_id = ${userId}
    ORDER BY p.created_at DESC
  `;
}

/**
 * Delete a passkey by credential ID.
 */
export async function deletePasskey(
  sql: Sql,
  userId: string,
  credentialId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM auth.passkeys
    WHERE user_id = ${userId} AND credential_id = ${credentialId}
  `;
  if (result.count > 0) {
    await sql`
      UPDATE auth.users
      SET passkey_count = GREATEST(0, passkey_count - 1)
      WHERE id = ${userId}
    `;
    return true;
  }
  return false;
}

/**
 * Delete all passkeys for a user.
 */
export async function deleteAllPasskeys(
  sql: Sql,
  userId: string,
): Promise<number> {
  const r = await sql`
    DELETE FROM auth.passkeys WHERE user_id = ${userId}
  `;
  await sql`
    UPDATE auth.users SET passkey_count = 0 WHERE id = ${userId}
  `;
  return r.count;
}

/**
 * Update the sign counter after a successful authentication.
 */
export async function updatePasskeyCounter(
  sql: Sql,
  credentialId: string,
  newCounter: number,
): Promise<void> {
  await sql`
    UPDATE auth.passkeys
    SET counter = ${newCounter}, last_used_at = NOW()
    WHERE credential_id = ${credentialId}
  `;
}

/**
 * Check if a user has any passkeys registered.
 */
export async function userHasPasskeys(
  sql: Sql,
  userId: string,
): Promise<boolean> {
  const [pk] = await sql<[{ count: string }]>`
    SELECT COUNT(*) as count FROM auth.passkeys WHERE user_id = ${userId}
  `;
  return parseInt(pk.count, 10) > 0;
}

// ---------------------------------------------------------------------------
// Registration / authentication option helpers (not cryptographic helpers)
// ---------------------------------------------------------------------------

export interface PasskeyRegistrationOptions {
  rp: {
    name: string;
    id: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  challenge: string;
  pubKeyCredParams: { alg: number; type: "public-key" }[];
  timeout: number;
  excludeCredentials: { id: string; type: "public-key"; transports: string[] }[];
  authenticatorSelection: {
    authenticatorAttachment: "platform" | "cross-platform";
    requireResidentKey: boolean;
    residentKey: "preferred" | "required" | "discouraged";
    userVerification: "preferred" | "required" | "discouraged";
  };
  attestation: "none" | "indirect" | "direct";
  extensions: { credProps: boolean };
}

/**
 * Build passkey registration options for a user.
 * Use this to generate the options passed to navigator.credentials.create().
 */
export async function buildRegistrationOptions(
  sql: Sql,
  userId: string,
  rpName: string,
  rpId: string,
  challenge: string,
): Promise<PasskeyRegistrationOptions | null> {
  const user = await sql<[{ id: string; email: string; name: string | null }]>`
    SELECT id, email, name FROM auth.users WHERE id = ${userId}
  `;
  if (!user[0]) return null;

  const existingCreds = await listPasskeys(sql, userId);

  return {
    rp: { name: rpName, id: rpId },
    user: {
      id: userId,
      name: user[0].email,
      displayName: user[0].name ?? user[0].email,
    },
    challenge,
    pubKeyCredParams: [
      { alg: -7, type: "public-key" },   // ES256
      { alg: -257, type: "public-key" }, // RS256
    ],
    timeout: 60000,
    excludeCredentials: existingCreds.map((c) => ({
      id: c.credential_id,
      type: "public-key" as const,
      transports: (c.transport ?? []) as string[],
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      requireResidentKey: true,
      residentKey: "preferred",
      userVerification: "preferred",
    },
    attestation: "none",
    extensions: { credProps: true },
  };
}

export interface PasskeyAuthenticationOptions {
  rpId: string;
  challenge: string;
  timeout: number;
  allowCredentials: { id: string; type: "public-key"; transports: string[] }[];
  userVerification: "preferred" | "required" | "discouraged";
  extensions: { appid?: string };
}

/**
 * Build passkey authentication options for a user.
 * Use this to generate the options passed to navigator.credentials.get().
 */
export async function buildAuthenticationOptions(
  sql: Sql,
  userId: string,
  rpId: string,
  challenge: string,
): Promise<PasskeyAuthenticationOptions | null> {
  const passkeys = await listPasskeys(sql, userId);
  if (passkeys.length === 0) return null;

  return {
    rpId,
    challenge,
    timeout: 60000,
    allowCredentials: passkeys.map((c) => ({
      id: c.credential_id,
      type: "public-key" as const,
      transports: (c.transport ?? []) as string[],
    })),
    userVerification: "preferred",
    extensions: {},
  };
}

// ---------------------------------------------------------------------------
// Passkey statistics
// ---------------------------------------------------------------------------

export interface PasskeyStats {
  user_id: string;
  total_passkeys: number;
  by_device_type: Record<string, number>;
  backed_up_count: number;
  not_backed_up_count: number;
  platform_authenticators: number;
  cross_platform_authenticators: number;
  avg_age_days: number | null;
  most_used_credential_id: string | null;
  most_used_credential_uses: number | null;
  last_used_within_days: number | null;
}

/**
 * Get comprehensive statistics about a user's passkeys.
 */
export async function getPasskeyStats(
  sql: Sql,
  userId: string,
): Promise<PasskeyStats | null> {
  const passkeys = await listPasskeys(sql, userId);
  if (passkeys.length === 0) {
    return {
      user_id: userId,
      total_passkeys: 0,
      by_device_type: {},
      backed_up_count: 0,
      not_backed_up_count: 0,
      platform_authenticators: 0,
      cross_platform_authenticators: 0,
      avg_age_days: null,
      most_used_credential_id: null,
      most_used_credential_uses: null,
      last_used_within_days: null,
    };
  }

  const backedUpCount = passkeys.filter((p) => p.backed_up).length;
  const notBackedUpCount = passkeys.filter((p) => !p.backed_up).length;

  // Platform (platform authenticator) vs cross-platform
  const platformAuths = passkeys.filter((p) => p.device_type === "platform").length;
  const crossPlatformAuths = passkeys.filter((p) => p.device_type !== "platform").length;

  // By device type
  const byDeviceType: Record<string, number> = {};
  for (const p of passkeys) {
    const dt = p.device_type ?? "unknown";
    byDeviceType[dt] = (byDeviceType[dt] ?? 0) + 1;
  }

  // Average age
  const now = new Date();
  const ages = passkeys.map((p) => (now.getTime() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24));
  const avgAgeDays = ages.reduce((a, b) => a + b, 0) / ages.length;

  // Most used credential
  let mostUsedCredId: string | null = null;
  let mostUsedCount = 0;
  for (const p of passkeys) {
    if (p.last_used_at) {
      const uses = passkeys.filter((c) => c.credential_id === p.credential_id && c.last_used_at).length;
      if (uses > mostUsedCount) {
        mostUsedCount = uses;
        mostUsedCredId = p.credential_id;
      }
    }
  }

  // Last used within days
  const lastUsedCred = passkeys.find((p) => p.last_used_at);
  const lastUsedWithinDays = lastUsedCred?.last_used_at
    ? (now.getTime() - new Date(lastUsedCred.last_used_at).getTime()) / (1000 * 60 * 60 * 24)
    : null;

  return {
    user_id: userId,
    total_passkeys: passkeys.length,
    by_device_type: byDeviceType,
    backed_up_count: backedUpCount,
    not_backed_up_count: notBackedUpCount,
    platform_authenticators: platformAuths,
    cross_platform_authenticators: crossPlatformAuths,
    avg_age_days: Math.round(avgAgeDays * 10) / 10,
    most_used_credential_id: mostUsedCredId,
    most_used_credential_uses: mostUsedCount > 0 ? mostUsedCount : null,
    last_used_within_days: lastUsedWithinDays !== null ? Math.round(lastUsedWithinDays * 10) / 10 : null,
  };
}
