/**
 * TOTP-based two-factor authentication (2FA).
 * Uses the standard HMAC-based One-Time Password algorithm (RFC 6238).
 */

import { createHmac, randomBytes } from "node:crypto";

export interface TOTPSecret {
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 8;
  period: number;
  issuer: string;
}

export interface TOTPEnrollment {
  user_id: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 8;
  period: number;
  backup_codes: string[];
  enrolled_at: Date;
}

/**
 * Generate a random TOTP secret (base32 encoded).
 */
export function generateTOTPSecret(length = 20): string {
  const buf = randomBytes(length);
  return buf.toString("base64").replace(/=+$/, "");
}

/**
 * Generate backup codes (one-time recovery codes).
 */
export function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(4).toString("hex").toUpperCase().match(/.{4}/g)!.join("-"),
  );
}

/**
 * Time step: 30 seconds (standard TOTP).
 */
const TOTP_PERIOD = 30;

/**
 * HOTP counter derived from timestamp.
 */
function getCounter(timestamp: number, period = TOTP_PERIOD): bigint {
  return BigInt(Math.floor(timestamp / 1000 / period));
}

/**
 * Dynamic truncation (RFC 4226).
 */
function dynamicTruncate(h: Buffer, digits: number): number {
  const offset = h[h.length - 1] & 0x0f;
  const bin =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff);
  return bin % Math.pow(10, digits);
}

/**
 * Compute the current TOTP code for a given secret.
 */
export function computeTOTP(
  secret: string,
  opts: {
    algorithm?: "SHA1" | "SHA256" | "SHA512";
    digits?: 6 | 8;
    period?: number;
    timestamp?: number;
  } = {},
): string {
  const { algorithm = "SHA1", digits = 6, period = TOTP_PERIOD, timestamp = Date.now() } = opts;

  const counter = getCounter(timestamp, period);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(counter);

  const key = Buffer.from(secret, "base64");
  const hmac = createHmac(algorithm.toLowerCase(), key);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  const code = dynamicTruncate(hash, digits);
  return code.toString().padStart(digits, "0");
}

/**
 * Verify a TOTP code with a window of ±1 period (60 seconds total).
 */
export function verifyTOTP(
  secret: string,
  code: string,
  opts: {
    algorithm?: "SHA1" | "SHA256" | "SHA512";
    digits?: 6 | 8;
    period?: number;
    window?: number;
    timestamp?: number;
  } = {},
): boolean {
  const { window = 1, timestamp = Date.now() } = opts;
  const period = opts.period ?? TOTP_PERIOD;

  for (let i = -window; i <= window; i++) {
    const t = timestamp + i * period * 1000;
    if (computeTOTP(secret, opts)(t) === code) {
      return true;
    }
  }
  return false;
}

/**
 * Generate a TOTP URI for QR code generation (Google Authenticator compatible).
 */
export function generateTOTPURI(
  secret: string,
  accountName: string,
  opts: {
    issuer?: string;
    algorithm?: "SHA1" | "SHA256" | "SHA512";
    digits?: 6 | 8;
    period?: number;
  } = {},
): string {
  const { issuer = " microservice-auth", algorithm = "SHA1", digits = 6, period = TOTP_PERIOD } = opts;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?${params}`;
}

/**
 * Consume and verify a backup code. Returns true if valid and the code was consumed.
 * Backup codes are single-use.
 */
export async function consumeBackupCode(
  enrollment: TOTPEnrollment,
  code: string,
): Promise<{ valid: boolean; remaining: number }> {
  const idx = enrollment.backup_codes.indexOf(code.toUpperCase().trim());
  if (idx === -1) {
    return { valid: false, remaining: enrollment.backup_codes.length };
  }
  // Code is consumed (this is a marker; actual DB update happens in store)
  return { valid: true, remaining: enrollment.backup_codes.length - 1 };
}
