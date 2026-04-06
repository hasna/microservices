/**
 * Memory importance boost — temporarily elevate a memory's importance
 * so it resists decay and appears more prominently in recall.
 */

import type { Sql } from "postgres";

export interface MemoryBoost {
  memory_id: string;
  boost_amount: number;
  boosted_at: Date;
  expires_at: Date | null;
  reason: string | null;
}

/**
 * Apply a temporary importance boost to a memory.
 * Boosts stack additively. Boosts expire after boost_ttl_seconds
 * (default: 7 days), at which point the boosted importance decays naturally.
 *
 * @param sql             - database handle
 * @param memoryId        - memory to boost
 * @param boostAmount     - how much to increase importance (0-1 range, default 0.3)
 * @param boostTtlSeconds - how long the boost lasts (default: 7 days)
 * @param reason          - optional reason for the boost
 */
export async function boostMemory(
  sql: Sql,
  memoryId: string,
  boostAmount = 0.3,
  boostTtlSeconds = 7 * 24 * 60 * 60,
  reason?: string,
): Promise<MemoryBoost> {
  const [existing] = await sql<any[]>`
    SELECT boost_count, current_boost FROM memory.memory_boosts WHERE memory_id = ${memoryId}
  `;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + boostTtlSeconds * 1000);

  if (existing) {
    // Stack boosts
    const newBoost = Math.min(existing.current_boost + boostAmount, 1);
    await sql`
      UPDATE memory.memory_boosts
      SET
        boost_count = boost_count + 1,
        current_boost = ${newBoost},
        boosted_at = ${now},
        expires_at = ${expiresAt},
        reason = ${reason ?? null}
      WHERE memory_id = ${memoryId}
    `;

    // Update memory importance immediately
    const [mem] = await sql<any[]>`SELECT importance FROM memory.memories WHERE id = ${memoryId}`;
    if (mem) {
      const newImportance = Math.min(mem.importance + boostAmount, 1);
      await sql`UPDATE memory.memories SET importance = ${newImportance} WHERE id = ${memoryId}`;
    }

    return {
      memory_id: memoryId,
      boost_amount: newBoost,
      boosted_at: now,
      expires_at: expiresAt,
      reason: reason ?? null,
    };
  } else {
    await sql`
      INSERT INTO memory.memory_boosts (memory_id, boost_count, current_boost, boosted_at, expires_at, reason)
      VALUES (${memoryId}, 1, ${boostAmount}, ${now}, ${expiresAt}, ${reason ?? null})
    `;

    const [mem] = await sql<any[]>`SELECT importance FROM memory.memories WHERE id = ${memoryId}`;
    if (mem) {
      const newImportance = Math.min(mem.importance + boostAmount, 1);
      await sql`UPDATE memory.memories SET importance = ${newImportance} WHERE id = ${memoryId}`;
    }

    return {
      memory_id: memoryId,
      boost_amount: boostAmount,
      boosted_at: now,
      expires_at: expiresAt,
      reason: reason ?? null,
    };
  }
}

/**
 * Decay all active boosts that have expired.
 * Called periodically (e.g., by a cron job or on each memory access).
 * Returns count of decays applied.
 */
export async function decayExpiredBoosts(sql: Sql): Promise<number> {
  const [rows] = await sql<any[]>`
    SELECT memory_id, current_boost
    FROM memory.memory_boosts
    WHERE expires_at IS NOT NULL AND expires_at < NOW()
  `;

  let count = 0;
  for (const row of rows ?? []) {
    // Decay the importance back by the boost amount
    const [mem] = await sql<any[]>`SELECT importance FROM memory.memories WHERE id = ${row.memory_id}`;
    if (mem) {
      const newImportance = Math.max(mem.importance - row.current_boost, 0);
      await sql`UPDATE memory.memories SET importance = ${newImportance} WHERE id = ${row.memory_id}`;
    }
    await sql`DELETE FROM memory.memory_boosts WHERE memory_id = ${row.memory_id}`;
    count++;
  }

  return count;
}

/**
 * Get the current boost status for a memory.
 */
export async function getMemoryBoost(
  sql: Sql,
  memoryId: string,
): Promise<MemoryBoost | null> {
  const [row] = await sql<any[]>`
    SELECT memory_id, current_boost AS boost_amount, boosted_at, expires_at, reason
    FROM memory.memory_boosts
    WHERE memory_id = ${memoryId}
  `;
  if (!row) return null;
  return {
    ...row,
    boosted_at: new Date(row.boosted_at),
    expires_at: row.expires_at ? new Date(row.expires_at) : null,
  };
}

/**
 * Decay an active boost for a memory by a given factor (0-1).
 * Removes the boost entirely when decay_by = 1 (default).
 */
export async function decayMemoryBoost(
  sql: Sql,
  memoryId: string,
  decayBy = 1,
): Promise<{ decayed: boolean; remaining_boost: number }> {
  const [row] = await sql<any[]>`
    SELECT current_boost FROM memory.memory_boosts WHERE memory_id = ${memoryId}
  `;
  if (!row) return { decayed: false, remaining_boost: 0 };

  const remainingBoost = row.current_boost * (1 - decayBy);

  if (decayBy >= 1 || remainingBoost <= 0) {
    // Remove the boost entirely
    await sql`DELETE FROM memory.memory_boosts WHERE memory_id = ${memoryId}`;
    const [mem] = await sql<any[]>`SELECT importance FROM memory.memories WHERE id = ${memoryId}`;
    if (mem) {
      const newImportance = Math.max(mem.importance - row.current_boost, 0);
      await sql`UPDATE memory.memories SET importance = ${newImportance} WHERE id = ${memoryId}`;
    }
    return { decayed: true, remaining_boost: 0 };
  }

  // Reduce boost
  await sql`UPDATE memory.memory_boosts SET current_boost = ${remainingBoost} WHERE memory_id = ${memoryId}`;
  return { decayed: true, remaining_boost: remainingBoost };
}
