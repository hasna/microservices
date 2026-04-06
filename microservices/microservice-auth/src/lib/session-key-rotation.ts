/**
 * Session encryption key rotation — rotate the keys used to encrypt
 * sensitive session data without invalidating active sessions.
 */

import type { Sql } from "postgres";
import { generateToken } from "./tokens.js";

export interface SessionKeyVersion {
  id: string;
  version: number;
  algorithm: string;
  is_active: boolean;
  is_primary: boolean;
  created_at: string;
  rotated_at: string | null;
}

export interface KeyRotationResult {
  new_version: number;
  migrated_sessions: number;
  retired_versions: number[];
}

/**
 * Create a new encryption key version for session data.
 */
export async function createSessionKeyVersion(
  sql: Sql,
  algorithm = "AES-256-GCM",
): Promise<SessionKeyVersion> {
  const [version] = await sql<SessionKeyVersion[]>`
    INSERT INTO auth.session_key_versions (version, algorithm, is_active, is_primary)
    VALUES (
      (SELECT COALESCE(MAX(version), 0) + 1 FROM auth.session_key_versions),
      ${algorithm},
      true,
      false
    )
    RETURNING *
  `;
  return version;
}

/**
 * Set a key version as primary (used for new sessions).
 */
export async function setPrimarySessionKey(
  sql: Sql,
  versionId: string,
): Promise<void> {
  await sql`
    UPDATE auth.session_key_versions
    SET is_primary = false
    WHERE is_primary = true
  `;
  await sql`
    UPDATE auth.session_key_versions
    SET is_primary = true, rotated_at = NOW()
    WHERE id = ${versionId}
  `;
}

/**
 * Get the current primary session key version.
 */
export async function getPrimarySessionKey(
  sql: Sql,
): Promise<SessionKeyVersion | null> {
  const [version] = await sql<SessionKeyVersion[]>`
    SELECT * FROM auth.session_key_versions
    WHERE is_primary = true AND is_active = true
  `;
  return version ?? null;
}

/**
 * List all session key versions.
 */
export async function listSessionKeyVersions(
  sql: Sql,
): Promise<SessionKeyVersion[]> {
  return sql<SessionKeyVersion[]>`
    SELECT * FROM auth.session_key_versions
    ORDER BY version DESC
  `;
}

/**
 * Rotate session keys — create new version and optionally retire old ones.
 * Migrates active sessions to use the new key by updating their key_version_id.
 */
export async function rotateSessionKeys(
  sql: Sql,
  opts: {
    retireAfterVersions?: number;
    migrateActiveSessions?: boolean;
  } = {},
): Promise<KeyRotationResult> {
  // Create new key version
  const newKey = await createSessionKeyVersion(sql);

  let migratedSessions = 0;

  if (opts.migrateActiveSessions) {
    // Migrate active sessions to new key
    const result = await sql`
      UPDATE auth.sessions
      SET key_version_id = ${newKey.id}
      WHERE expires_at > NOW()
        AND (key_version_id IS NULL OR key_version_id != ${newKey.id})
    `;
    migratedSessions = result.count;
  }

  // Retire old versions if requested
  const retiredVersions: number[] = [];
  if (opts.retireAfterVersions !== undefined) {
    const oldVersions = await sql<{ id: string; version: number }[]>`
      SELECT id, version FROM auth.session_key_versions
      WHERE is_primary = false
        AND is_active = true
        AND id != ${newKey.id}
      ORDER BY version ASC
      LIMIT GREATEST(0, (
        SELECT COUNT(*) - ${opts.retireAfterVersions}
        FROM auth.session_key_versions
        WHERE is_active = true
      ))
    `;

    for (const v of oldVersions) {
      await sql`
        UPDATE auth.session_key_versions
        SET is_active = false
        WHERE id = ${v.id}
      `;
      retiredVersions.push(v.version);
    }
  }

  // Set new key as primary
  await setPrimarySessionKey(sql, newKey.id);

  return {
    new_version: newKey.version,
    migrated_sessions: migratedSessions,
    retired_versions: retiredVersions,
  };
}

/**
 * Re-encrypt session data with the current primary key.
 */
export async function reEncryptSession(
  sql: Sql,
  sessionId: string,
): Promise<boolean> {
  const primaryKey = await getPrimarySessionKey(sql);
  if (!primaryKey) return false;

  const result = await sql`
    UPDATE auth.sessions
    SET key_version_id = ${primaryKey.id}
    WHERE id = ${sessionId}
  `;
  return result.count > 0;
}