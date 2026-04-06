/**
 * Session management — create, validate, revoke.
 */

import type { Sql } from "postgres";
import { generateToken } from "./tokens.js";

export interface Session {
  id: string;
  user_id: string;
  token: string;
  ip: string | null;
  user_agent: string | null;
  device_id: string | null;
  device_name: string | null;
  is_trusted: boolean;
  last_seen_at: string | null;
  expires_at: string;
  created_at: string;
}

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function createSession(
  sql: Sql,
  userId: string,
  opts: { ip?: string; user_agent?: string; ttlSeconds?: number; deviceId?: string; deviceName?: string; isTrusted?: boolean } = {},
): Promise<Session> {
  const token = generateToken();
  const ttl = opts.ttlSeconds ?? SESSION_TTL_SECONDS;
  const [session] = await sql<Session[]>`
    INSERT INTO auth.sessions (user_id, token, ip, user_agent, device_id, device_name, is_trusted, expires_at)
    VALUES (${userId}, ${token}, ${opts.ip ?? null}, ${opts.user_agent ?? null},
            ${opts.deviceId ?? null}, ${opts.deviceName ?? null},
            ${opts.isTrusted ?? false}, NOW() + ${ttl} * INTERVAL '1 second')
    RETURNING *
  `;

  // Update last_seen_at if device is already trusted
  if (opts.deviceId) {
    await sql`
      UPDATE auth.trusted_devices
      SET last_seen_at = NOW()
      WHERE device_id = ${opts.deviceId} AND user_id = ${userId}
    `;
  }

  return session;
}

export async function getSessionByToken(
  sql: Sql,
  token: string,
): Promise<Session | null> {
  const [session] = await sql<Session[]>`
    SELECT * FROM auth.sessions
    WHERE token = ${token} AND expires_at > NOW()
  `;
  return session ?? null;
}

export async function listUserSessions(
  sql: Sql,
  userId: string,
): Promise<Session[]> {
  return sql<Session[]>`
    SELECT * FROM auth.sessions
    WHERE user_id = ${userId} AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
}

export async function revokeSession(sql: Sql, token: string): Promise<boolean> {
  const result = await sql`DELETE FROM auth.sessions WHERE token = ${token}`;
  return result.count > 0;
}

export async function revokeAllUserSessions(
  sql: Sql,
  userId: string,
): Promise<number> {
  const result = await sql`DELETE FROM auth.sessions WHERE user_id = ${userId}`;
  return result.count;
}

export async function cleanExpiredSessions(sql: Sql): Promise<number> {
  const result = await sql`DELETE FROM auth.sessions WHERE expires_at <= NOW()`;
  return result.count;
}

// --- Device management ---

export interface TrustedDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string | null;
  fingerprint: string | null;
  trusted_at: string;
  last_seen_at: string;
  user_agent: string | null;
  ip_address: string | null;
}

export async function trustDevice(
  sql: Sql,
  userId: string,
  deviceId: string,
  opts: { deviceName?: string; fingerprint?: string; userAgent?: string; ipAddress?: string } = {},
): Promise<TrustedDevice> {
  const [device] = await sql<TrustedDevice[]>`
    INSERT INTO auth.trusted_devices (user_id, device_id, device_name, fingerprint, user_agent, ip_address)
    VALUES (${userId}, ${deviceId}, ${opts.deviceName ?? null}, ${opts.fingerprint ?? null},
            ${opts.userAgent ?? null}, ${opts.ipAddress ?? null})
    ON CONFLICT (user_id, device_id) DO UPDATE
      SET trusted_at = NOW(), device_name = COALESCE(EXCLUDED.device_name, trusted_devices.device_name)
    RETURNING *
  `;
  // Mark all sessions for this device as trusted
  await sql`
    UPDATE auth.sessions
    SET is_trusted = TRUE, device_name = COALESCE(EXCLUDED.device_name, auth.sessions.device_name)
    WHERE user_id = ${userId} AND device_id = ${deviceId}
  `;
  return device;
}

export async function revokeDevice(
  sql: Sql,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const result = await sql`DELETE FROM auth.trusted_devices WHERE user_id = ${userId} AND device_id = ${deviceId}`;
  // Untrust all sessions for this device
  await sql`UPDATE auth.sessions SET is_trusted = FALSE WHERE user_id = ${userId} AND device_id = ${deviceId}`;
  return result.count > 0;
}

export async function listTrustedDevices(
  sql: Sql,
  userId: string,
): Promise<TrustedDevice[]> {
  return sql<TrustedDevice[]>`
    SELECT * FROM auth.trusted_devices
    WHERE user_id = ${userId}
    ORDER BY last_seen_at DESC
  `;
}

export async function revokeAllDevices(
  sql: Sql,
  userId: string,
): Promise<number> {
  const result = await sql`DELETE FROM auth.trusted_devices WHERE user_id = ${userId}`;
  await sql`UPDATE auth.sessions SET is_trusted = FALSE WHERE user_id = ${userId}`;
  return result.count;
}

export async function isDeviceTrusted(
  sql: Sql,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const [row] = await sql`
    SELECT id FROM auth.trusted_devices
    WHERE user_id = ${userId} AND device_id = ${deviceId}
  `;
  return !!row;
}

export async function updateSessionLastSeen(
  sql: Sql,
  token: string,
): Promise<void> {
  await sql`UPDATE auth.sessions SET last_seen_at = NOW() WHERE token = ${token}`;
}
