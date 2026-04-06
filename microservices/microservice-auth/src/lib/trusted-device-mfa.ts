/**
 * Trusted Device MFA Bypass — allows users with trusted devices
 * to skip MFA challenges for a configurable time window.
 *
 * When a device is marked as "MFA-trusted", the user can bypass
 * TOTP/passkey challenges for a window (e.g., 30 days) without
 * needing a second factor on that device.
 */

import type { Sql } from "postgres";

export type MfaBypassStatus = "active" | "expired" | "revoked";

export interface TrustedDeviceMfa {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string | null;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  last_bypassed_at: string | null;
}

/**
 * Grant MFA bypass to a trusted device.
 * If already exists, extends the expiry window.
 */
export async function grantDeviceMfaBypass(
  sql: Sql,
  userId: string,
  deviceId: string,
  deviceName: string | null,
  windowDays = 30,
): Promise<TrustedDeviceMfa> {
  const expiresAt = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000);

  const [existing] = await sql<[{ id: string }]>`SELECT id FROM auth.trusted_device_mfa WHERE user_id = ${userId} AND device_id = ${deviceId}`;

  if (existing) {
    await sql`
      UPDATE auth.trusted_device_mfa
      SET expires_at = ${expiresAt}, revoked_at = NULL
      WHERE user_id = ${userId} AND device_id = ${deviceId}
    `;
  } else {
    await sql`
      INSERT INTO auth.trusted_device_mfa (user_id, device_id, device_name, expires_at)
      VALUES (${userId}, ${deviceId}, ${deviceName}, ${expiresAt})
    `;
  }

  const [entry] = await sql<TrustedDeviceMfa[]>`
    SELECT * FROM auth.trusted_device_mfa
    WHERE user_id = ${userId} AND device_id = ${deviceId}
  `;
  return entry;
}

/**
 * Check if a device currently has an active MFA bypass.
 */
export async function getDeviceMfaBypassStatus(
  sql: Sql,
  userId: string,
  deviceId: string,
): Promise<MfaBypassStatus> {
  const [entry] = await sql<TrustedDeviceMfa[]>`
    SELECT * FROM auth.trusted_device_mfa
    WHERE user_id = ${userId} AND device_id = ${deviceId}
  `;

  if (!entry) return "revoked";
  if (entry.revoked_at) return "revoked";
  if (new Date(entry.expires_at) < new Date()) return "expired";
  return "active";
}

/**
 * Record that a device was used to bypass MFA.
 */
export async function recordMfaBypassUse(
  sql: Sql,
  userId: string,
  deviceId: string,
): Promise<void> {
  await sql`
    UPDATE auth.trusted_device_mfa
    SET last_bypassed_at = NOW()
    WHERE user_id = ${userId} AND device_id = ${deviceId}
    AND (revoked_at IS NULL) AND (expires_at > NOW())
  `;
}

/**
 * Revoke MFA bypass for a specific device.
 */
export async function revokeDeviceMfaBypass(
  sql: Sql,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE auth.trusted_device_mfa
    SET revoked_at = NOW()
    WHERE user_id = ${userId} AND device_id = ${deviceId} AND revoked_at IS NULL
  `;
  return Number(result.count ?? 0) > 0;
}

/**
 * Revoke all MFA bypasses for a user.
 */
export async function revokeAllMfaBypasses(
  sql: Sql,
  userId: string,
): Promise<number> {
  const result = await sql`
    UPDATE auth.trusted_device_mfa
    SET revoked_at = NOW()
    WHERE user_id = ${userId} AND revoked_at IS NULL
  `;
  return Number(result.count ?? 0);
}

/**
 * List all trusted MFA bypass devices for a user.
 */
export async function listTrustedMfaDevices(
  sql: Sql,
  userId: string,
): Promise<TrustedDeviceMfa[]> {
  return sql<TrustedDeviceMfa[]>`
    SELECT * FROM auth.trusted_device_mfa
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
}
