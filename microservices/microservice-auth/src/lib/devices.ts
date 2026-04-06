/**
 * Device management — track all devices per user with rich metadata.
 */

import type { Sql } from "postgres";
import { generateToken } from "./tokens.js";

export interface Device {
  device_id: string;
  user_id: string;
  name: string | null;
  type: string | null;
  last_seen_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  active: boolean;
}

/**
 * Register a new device for a user.
 */
export async function registerDevice(
  sql: Sql,
  userId: string,
  opts: {
    name?: string;
    type?: string;
    ip_address?: string;
    user_agent?: string;
  } = {},
): Promise<Device> {
  const device_id = generateToken();
  const [device] = await sql<Device[]>`
    INSERT INTO auth.devices (device_id, user_id, name, type, ip_address, user_agent, active)
    VALUES (
      ${device_id},
      ${userId},
      ${opts.name ?? null},
      ${opts.type ?? null},
      ${opts.ip_address ?? null},
      ${opts.user_agent ?? null},
      TRUE
    )
    ON CONFLICT (user_id, device_id) DO UPDATE SET
      last_seen_at = NOW(),
      active = TRUE
    RETURNING *
  `;
  return device;
}

/**
 * List all devices for a user.
 */
export async function listUserDevices(
  sql: Sql,
  userId: string,
): Promise<Device[]> {
  return sql<Device[]>`
    SELECT * FROM auth.devices
    WHERE user_id = ${userId}
    ORDER BY last_seen_at DESC NULLS LAST
  `;
}

/**
 * Revoke (deactivate) a specific device.
 */
export async function revokeUserDevice(
  sql: Sql,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE auth.devices
    SET active = FALSE
    WHERE user_id = ${userId} AND device_id = ${deviceId}
  `;
  return result.count > 0;
}

/**
 * Revoke all devices for a user (except optionally keep current).
 */
export async function revokeAllUserDevices(
  sql: Sql,
  userId: string,
  keepDeviceId?: string,
): Promise<number> {
  const result = keepDeviceId
    ? await sql`
        UPDATE auth.devices
        SET active = FALSE
        WHERE user_id = ${userId} AND device_id != ${keepDeviceId}
      `
    : await sql`
        UPDATE auth.devices
        SET active = FALSE
        WHERE user_id = ${userId}
      `;
  return result.count;
}

/**
 * Update last seen timestamp for a device.
 */
export async function touchDevice(
  sql: Sql,
  userId: string,
  deviceId: string,
  opts: { ip_address?: string; user_agent?: string } = {},
): Promise<void> {
  await sql`
    UPDATE auth.devices
    SET
      last_seen_at = NOW(),
      ip_address = COALESCE(${opts.ip_address ?? null}, ip_address),
      user_agent = COALESCE(${opts.user_agent ?? null}, user_agent)
    WHERE user_id = ${userId} AND device_id = ${deviceId}
  `;
}

/**
 * Get a device by id.
 */
export async function getDevice(
  sql: Sql,
  userId: string,
  deviceId: string,
): Promise<Device | null> {
  const [device] = await sql<Device[]>`
    SELECT * FROM auth.devices
    WHERE user_id = ${userId} AND device_id = ${deviceId} AND active = TRUE
  `;
  return device ?? null;
}
