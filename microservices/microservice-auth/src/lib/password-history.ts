/**
 * Password history — prevents password reuse attacks.
 *
 * When a user changes their password, the old hash is stored.
 * During password validation, we check against the last N stored hashes.
 */

import type { Sql } from "postgres";

export interface PasswordHistoryEntry {
  id: string;
  user_id: string;
  password_hash: string;
  created_at: string;
}

/**
 * Add a password to the user's password history.
 * Called automatically when a user changes/updates their password.
 */
export async function addPasswordToHistory(
  sql: Sql,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await sql`
    INSERT INTO auth.password_history (user_id, password_hash)
    VALUES (${userId}, ${passwordHash})
  `;
}

/**
 * Check if a proposed password matches any of the user's last N passwords.
 * Returns true if the password was previously used.
 */
export async function isPasswordInHistory(
  sql: Sql,
  userId: string,
  proposedPasswordHash: string,
  historyLimit = 10,
): Promise<boolean> {
  const [found] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count
    FROM auth.password_history
    WHERE user_id = ${userId}
    AND password_hash = ${proposedPasswordHash}
    LIMIT 1
  `;
  return Number(found.count) > 0;
}

/**
 * Verify a password against a user's history (checks bcrypt hashes).
 * Returns the number of matched historical passwords (0 = safe to use).
 */
export async function checkPasswordAgainstHistory(
  sql: Sql,
  userId: string,
  proposedPasswordHash: string,
  historyLimit = 10,
): Promise<{ reused: boolean; match_count: number }> {
  const matches = await sql<PasswordHistoryEntry[]>`
    SELECT id, password_hash
    FROM auth.password_history
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${historyLimit}
  `;

  let matchCount = 0;
  for (const entry of matches) {
    if (entry.password_hash === proposedPasswordHash) {
      matchCount++;
    }
  }

  return { reused: matchCount > 0, match_count: matchCount };
}

/**
 * Prune old password history entries beyond the retention limit.
 */
export async function prunePasswordHistory(
  sql: Sql,
  userId: string,
  retainCount = 10,
): Promise<number> {
  // Get the ID threshold - keep the most recent N entries
  const cutoffEntries = await sql<[{ id: string }]>`
    SELECT id FROM auth.password_history
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    OFFSET ${retainCount}
    LIMIT 1
  `;

  if (cutoffEntries.length === 0) return 0;

  const [{ id: cutoffId }] = cutoffEntries;
  const result = await sql`DELETE FROM auth.password_history WHERE user_id = ${userId} AND id < ${cutoffId}`;
  return Number(result.count ?? 0);
}

/**
 * Get the number of passwords stored for a user.
 */
export async function getPasswordHistoryCount(
  sql: Sql,
  userId: string,
): Promise<number> {
  const [row] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM auth.password_history WHERE user_id = ${userId}
  `;
  return Number(row.count);
}
