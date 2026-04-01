/**
 * Waitlist entry operations: join, position, invite, referrals.
 */

import type { Sql } from "postgres";

export interface Entry {
  id: string;
  campaign_id: string;
  email: string;
  name: string | null;
  referral_code: string;
  referred_by: string | null;
  referral_count: number;
  priority_score: number;
  status: "waiting" | "invited" | "joined" | "removed";
  position: number | null;
  metadata: any;
  invited_at: Date | null;
  created_at: Date;
}

export interface JoinWaitlistInput {
  campaignId: string;
  email: string;
  name?: string;
  referralCode?: string;
  metadata?: any;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Calculate priority score: base=1 + (referral_count*10) + (days_since_epoch * 0.001)
 * Higher score = higher priority. Earlier signup + more referrals = higher score.
 */
export function calculatePriorityScore(
  referralCount: number,
  createdAt: Date,
): number {
  const daysSinceEpoch = createdAt.getTime() / (1000 * 60 * 60 * 24);
  return 1 + referralCount * 10 + daysSinceEpoch * 0.001;
}

export async function joinWaitlist(
  sql: Sql,
  data: JoinWaitlistInput,
): Promise<Entry> {
  if (!isValidEmail(data.email)) {
    throw new Error(`Invalid email address: ${data.email}`);
  }

  let referrerId: string | null = null;

  // Resolve referrer if referral_code provided
  if (data.referralCode) {
    const [referrer] = await sql<Entry[]>`
      SELECT * FROM waitlist.entries
      WHERE referral_code = ${data.referralCode}
        AND campaign_id = ${data.campaignId}
    `;
    if (referrer) {
      referrerId = referrer.id;
    }
  }

  const now = new Date();
  const score = calculatePriorityScore(0, now);

  const [entry] = await sql<Entry[]>`
    INSERT INTO waitlist.entries (campaign_id, email, name, referred_by, priority_score, metadata)
    VALUES (
      ${data.campaignId},
      ${data.email},
      ${data.name ?? null},
      ${referrerId},
      ${score},
      ${sql.json(data.metadata ?? {})}
    )
    RETURNING *
  `;

  // Increment referrer's referral_count and recalculate their score
  if (referrerId) {
    const [referrer] = await sql<Entry[]>`
      UPDATE waitlist.entries
      SET referral_count = referral_count + 1
      WHERE id = ${referrerId}
      RETURNING *
    `;
    if (referrer) {
      const newScore = calculatePriorityScore(
        referrer.referral_count,
        referrer.created_at,
      );
      await sql`
        UPDATE waitlist.entries
        SET priority_score = ${newScore}
        WHERE id = ${referrerId}
      `;
    }
  }

  return entry;
}

export async function getEntry(sql: Sql, id: string): Promise<Entry | null> {
  const [entry] = await sql<Entry[]>`
    SELECT * FROM waitlist.entries WHERE id = ${id}
  `;
  return entry ?? null;
}

export async function getEntryByEmail(
  sql: Sql,
  campaignId: string,
  email: string,
): Promise<Entry | null> {
  const [entry] = await sql<Entry[]>`
    SELECT * FROM waitlist.entries
    WHERE campaign_id = ${campaignId} AND email = ${email}
  `;
  return entry ?? null;
}

export async function getPosition(
  sql: Sql,
  entryId: string,
): Promise<{ position: number; total: number; ahead: number }> {
  const [entry] = await sql<Entry[]>`
    SELECT * FROM waitlist.entries WHERE id = ${entryId}
  `;
  if (!entry) throw new Error(`Entry not found: ${entryId}`);

  const [{ count: total }] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int as count FROM waitlist.entries
    WHERE campaign_id = ${entry.campaign_id} AND status = 'waiting'
  `;

  const [{ count: ahead }] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int as count FROM waitlist.entries
    WHERE campaign_id = ${entry.campaign_id}
      AND status = 'waiting'
      AND priority_score > ${entry.priority_score}
  `;

  const position = ahead + 1;
  return { position, total, ahead };
}

export async function updateScore(
  sql: Sql,
  entryId: string,
  score: number,
): Promise<void> {
  await sql`
    UPDATE waitlist.entries SET priority_score = ${score} WHERE id = ${entryId}
  `;
}

export async function inviteBatch(
  sql: Sql,
  campaignId: string,
  count: number,
): Promise<Entry[]> {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("count must be a positive integer");
  }

  const invited = await sql<Entry[]>`
    UPDATE waitlist.entries
    SET status = 'invited', invited_at = NOW()
    WHERE id IN (
      SELECT id FROM waitlist.entries
      WHERE campaign_id = ${campaignId} AND status = 'waiting'
      ORDER BY priority_score DESC
      LIMIT ${count}
    )
    RETURNING *
  `;

  return invited;
}

export async function markJoined(sql: Sql, entryId: string): Promise<void> {
  await sql`
    UPDATE waitlist.entries SET status = 'joined' WHERE id = ${entryId}
  `;
}

export async function removeEntry(sql: Sql, entryId: string): Promise<void> {
  await sql`
    UPDATE waitlist.entries SET status = 'removed' WHERE id = ${entryId}
  `;
}

export async function listEntries(
  sql: Sql,
  campaignId: string,
  status?: string,
  limit?: number,
): Promise<Entry[]> {
  const maxLimit = limit ?? 50;

  if (status) {
    return sql<Entry[]>`
      SELECT * FROM waitlist.entries
      WHERE campaign_id = ${campaignId} AND status = ${status}
      ORDER BY priority_score DESC
      LIMIT ${maxLimit}
    `;
  }

  return sql<Entry[]>`
    SELECT * FROM waitlist.entries
    WHERE campaign_id = ${campaignId}
    ORDER BY priority_score DESC
    LIMIT ${maxLimit}
  `;
}
