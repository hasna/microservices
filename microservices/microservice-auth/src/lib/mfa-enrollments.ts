/**
 * MFA Enrollment management — TOTP and passkey MFA enrollment, verification, and status.
 *
 * Provides a unified interface for managing MFA enrollment state per user,
 * supporting both TOTP (authenticator app) and passkey (WebAuthn) methods.
 */

import type { Sql } from "postgres";
import { verifyTOTP } from "./two-factor.js";
import { getPasskeyByCredentialId } from "./passkeys.js";

export type MfaMethod = "totp" | "passkey";
export type MfaEnrollmentStatus = "enrolled" | "pending" | "not_enrolled";

export interface MfaEnrollmentRecord {
  userId: string;
  method: MfaMethod;
  status: MfaEnrollmentStatus;
  verified: boolean;
  backupCodesRemaining: number;
  enrolledAt: Date | null;
  lastUsedAt: Date | null;
}

export interface MfaStatus {
  userId: string;
  totpEnrolled: boolean;
  totpVerified: boolean;
  passkeyMfaEnrolled: boolean;
  anyMfaEnabled: boolean;
  preferredMethod: MfaMethod | null;
}

/**
 * Get MFA enrollment status for a user (unified view across TOTP and passkey MFA).
 */
export async function getMfaStatus(
  sql: Sql,
  userId: string,
): Promise<MfaStatus> {
  const [totpRow] = await sql<[{ user_id: string; verified: boolean }]>`
    SELECT user_id, verified FROM auth.totp_enrollments WHERE user_id = ${userId}
  `;

  const passkeyRows = await sql<[{ count: string }]>`
    SELECT COUNT(*) as count FROM auth.passkey_mfa_challenges
    WHERE user_id = ${userId} AND completed_at IS NOT NULL
  `;
  const passkeyMfaEnrolled = parseInt(passkeyRows[0].count, 10) > 0;

  const totpEnrolled = !!totpRow;
  const anyMfaEnabled = totpEnrolled || passkeyMfaEnrolled;

  let preferredMethod: MfaMethod | null = null;
  if (totpEnrolled) preferredMethod = "totp";
  else if (passkeyMfaEnrolled) preferredMethod = "passkey";

  return {
    userId,
    totpEnrolled,
    totpVerified: totpRow?.verified ?? false,
    passkeyMfaEnrolled,
    anyMfaEnabled,
    preferredMethod,
  };
}

/**
 * Enroll a user in TOTP MFA. Stores the secret and backup codes.
 */
export async function enrollTotp(
  sql: Sql,
  userId: string,
  secret: string,
  backupCodes: string[],
  opts: {
    algorithm?: "SHA1" | "SHA256" | "SHA512";
    digits?: 6 | 8;
    period?: number;
  } = {},
): Promise<void> {
  const algorithm = opts.algorithm ?? "SHA1";
  const digits = opts.digits ?? 6;
  const period = opts.period ?? 30;

  await sql`
    INSERT INTO auth.totp_enrollments (user_id, secret, algorithm, digits, period, backup_codes, verified)
    VALUES (${userId}, ${secret}, ${algorithm}, ${digits}, ${period}, ${backupCodes}, FALSE)
    ON CONFLICT (user_id) DO UPDATE SET
      secret = EXCLUDED.secret,
      algorithm = EXCLUDED.algorithm,
      digits = EXCLUDED.digits,
      period = EXCLUDED.period,
      backup_codes = EXCLUDED.backup_codes,
      verified = FALSE
  `;
}

/**
 * Verify a TOTP code during enrollment (second step of setup).
 * Marks the enrollment as verified if the code is valid.
 */
export async function verifyTotpEnrollment(
  sql: Sql,
  userId: string,
  code: string,
): Promise<boolean> {
  const [enrollment] = await sql<{
    secret: string;
    algorithm: "SHA1" | "SHA256" | "SHA512";
    digits: 6 | 8;
    period: number;
    verified: boolean;
  }[]>`
    SELECT secret, algorithm, digits, period, verified FROM auth.totp_enrollments
    WHERE user_id = ${userId}
  `;

  if (!enrollment) return false;
  if (enrollment.verified) return true; // Already verified

  const valid = verifyTOTP(enrollment.secret, code, {
    algorithm: enrollment.algorithm,
    digits: enrollment.digits,
    period: enrollment.period,
  });

  if (valid) {
    await sql`
      UPDATE auth.totp_enrollments
      SET verified = TRUE, last_used_at = NOW()
      WHERE user_id = ${userId}
    `;
  }

  return valid;
}

/**
 * Disable TOTP MFA for a user.
 */
export async function disableTotpEnrollment(
  sql: Sql,
  userId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM auth.totp_enrollments WHERE user_id = ${userId}
  `;
  return (result.count ?? 0) > 0;
}

/**
 * Verify a TOTP code during an MFA challenge (login step-up).
 * Returns true if the code is valid and updates last_used_at.
 */
export async function verifyTotpCode(
  sql: Sql,
  userId: string,
  code: string,
): Promise<boolean> {
  const [enrollment] = await sql<{
    secret: string;
    algorithm: "SHA1" | "SHA256" | "SHA512";
    digits: 6 | 8;
    period: number;
    verified: boolean;
  }[]>`
    SELECT secret, algorithm, digits, period, verified FROM auth.totp_enrollments
    WHERE user_id = ${userId}
  `;

  if (!enrollment || !enrollment.verified) return false;

  const valid = verifyTOTP(enrollment.secret, code, {
    algorithm: enrollment.algorithm,
    digits: enrollment.digits,
    period: enrollment.period,
  });

  if (valid) {
    await sql`
      UPDATE auth.totp_enrollments SET last_used_at = NOW() WHERE user_id = ${userId}
    `;
  }

  return valid;
}

/**
 * Consume a backup code. The code is removed from the list after use.
 * Returns the number of remaining backup codes.
 */
export async function consumeTotpBackupCode(
  sql: Sql,
  userId: string,
  code: string,
): Promise<{ valid: boolean; remaining: number }> {
  const [enrollment] = await sql<{ backup_codes: string[] }[]>`
    SELECT backup_codes FROM auth.totp_enrollments WHERE user_id = ${userId}
  `;

  if (!enrollment) return { valid: false, remaining: 0 };

  const normalizedCode = code.toUpperCase().trim();
  const idx = enrollment.backup_codes.indexOf(normalizedCode);

  if (idx === -1) return { valid: false, remaining: enrollment.backup_codes.length };

  // Remove the used code
  const newCodes = [...enrollment.backup_codes];
  newCodes.splice(idx, 1);

  await sql`
    UPDATE auth.totp_enrollments SET backup_codes = ${newCodes} WHERE user_id = ${userId}
  `;

  return { valid: true, remaining: newCodes.length };
}

/**
 * Get the number of remaining backup codes for a user.
 */
export async function getBackupCodeCount(
  sql: Sql,
  userId: string,
): Promise<number> {
  const [row] = await sql<[{ count: string }]>`
    SELECT COUNT(*) as count FROM auth.totp_enrollments WHERE user_id = ${userId}
  `;
  return parseInt(row.count, 10);
}

/**
 * Check if a user is enrolled in any MFA method.
 */
export async function isMfaEnabledForUser(
  sql: Sql,
  userId: string,
): Promise<boolean> {
  const status = await getMfaStatus(sql, userId);
  return status.anyMfaEnabled;
}

/**
 * List all users with MFA enabled (for admin dashboards).
 */
export async function listMfaEnabledUsers(
  sql: Sql,
  opts: {
    method?: MfaMethod;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ userId: string; method: MfaMethod; verified: boolean; enrolledAt: Date }[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const rows = await sql.unsafe(`
    SELECT DISTINCT ON (te.user_id)
      te.user_id,
      'totp' as method,
      te.verified,
      te.created_at as enrolled_at
    FROM auth.totp_enrollments te
    UNION ALL
    SELECT DISTINCT ON (pmc.user_id)
      pmc.user_id,
      'passkey' as method,
      TRUE as verified,
      MIN(pmc.completed_at) as enrolled_at
    FROM auth.passkey_mfa_challenges pmc
    WHERE pmc.completed_at IS NOT NULL
    GROUP BY pmc.user_id
    ORDER BY user_id, enrolled_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]) as { user_id: string; method: string; verified: boolean; enrolled_at: Date }[];

  return rows.map(r => ({
    userId: r.user_id,
    method: r.method as MfaMethod,
    verified: r.verified,
    enrolledAt: r.enrolled_at,
  }));
}
