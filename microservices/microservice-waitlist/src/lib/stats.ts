/**
 * Waitlist statistics for a campaign.
 */

import type { Sql } from "postgres";

export interface WaitlistStats {
  total: number;
  waiting: number;
  invited: number;
  joined: number;
  top_referrers: { email: string; referral_count: number }[];
}

export async function getWaitlistStats(sql: Sql, campaignId: string): Promise<WaitlistStats> {
  const [{ total, waiting, invited, joined }] = await sql<[{
    total: number;
    waiting: number;
    invited: number;
    joined: number;
  }]>`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE status = 'waiting')::int as waiting,
      COUNT(*) FILTER (WHERE status = 'invited')::int as invited,
      COUNT(*) FILTER (WHERE status = 'joined')::int as joined
    FROM waitlist.entries
    WHERE campaign_id = ${campaignId}
  `;

  const top_referrers = await sql<{ email: string; referral_count: number }[]>`
    SELECT email, referral_count
    FROM waitlist.entries
    WHERE campaign_id = ${campaignId} AND referral_count > 0
    ORDER BY referral_count DESC
    LIMIT 10
  `;

  return { total, waiting, invited, joined, top_referrers };
}
