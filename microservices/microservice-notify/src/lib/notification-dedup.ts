/**
 * Notification deduplication — prevent duplicate notifications from being
 * sent when the same event triggers multiple delivery attempts.
 */

import type { Sql } from "postgres";

export interface DedupEntry {
  fingerprint: string;
  notification_id: string | null;
  user_id: string;
  workspace_id: string;
  channel: string;
  created_at: string;
  expires_at: string;
  dedup_result: "new" | "duplicate" | "coalesced";
}

export interface DedupCheckResult {
  is_duplicate: boolean;
  original_notification_id: string | null;
  fingerprint: string;
  should_send: boolean;
}

/**
 * Generate a fingerprint for a notification based on its content and context.
 */
export function generateNotificationFingerprint(
  userId: string,
  workspaceId: string,
  channel: string,
  content: string,
  idempotencyKey?: string,
): string {
  const data = {
    user_id: userId,
    workspace_id: workspaceId,
    channel,
    content_hash: hashString(content),
    idempotency_key: idempotencyKey,
  };
  return hashString(JSON.stringify(data));
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Check if a notification is a duplicate and record it.
 */
export async function checkAndRecordDedup(
  sql: Sql,
  userId: string,
  workspaceId: string,
  channel: string,
  content: string,
  idempotencyKey?: string,
  ttlSeconds = 300,
): Promise<DedupCheckResult> {
  const fingerprint = generateNotificationFingerprint(userId, workspaceId, channel, content, idempotencyKey);

  // Check for existing entry
  const [existing] = await sql<{ notification_id: string | null }[]>`
    SELECT notification_id FROM notify.dedup_entries
    WHERE fingerprint = ${fingerprint}
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (existing) {
    return {
      is_duplicate: true,
      original_notification_id: existing.notification_id,
      fingerprint,
      should_send: false,
    };
  }

  // Record new entry
  await sql`
    INSERT INTO notify.dedup_entries (fingerprint, user_id, workspace_id, channel, expires_at)
    VALUES (
      ${fingerprint},
      ${userId},
      ${workspaceId},
      ${channel},
      NOW() + ${ttlSeconds} * INTERVAL '1 second'
    )
  `;

  return {
    is_duplicate: false,
    original_notification_id: null,
    fingerprint,
    should_send: true,
  };
}

/**
 * Coalesce similar notifications into a single aggregated notification.
 */
export async function coalesceNotifications(
  sql: Sql,
  userId: string,
  workspaceId: string,
  channel: string,
  templateId: string,
  coalesceKey: string,
  ttlSeconds = 3600,
): Promise<{ coalesced_count: number; notification_id: string }> {
  // Find existing pending notification with same coalesce key
  const [existing] = await sql<{ id: string; coalesced_count: number }[]>`
    SELECT id, COALESCE((metadata->>'coalesced_count')::int, 1)::int as coalesced_count
    FROM notify.notifications
    WHERE user_id = ${userId}
      AND workspace_id = ${workspaceId}
      AND channel = ${channel}
      AND template_id = ${templateId}
      AND status = 'pending'
      AND (metadata->>'coalesce_key') = ${coalesceKey}
      AND created_at >= NOW() - ${ttlSeconds} * INTERVAL '1 second'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (existing) {
    // Update existing notification
    await sql`
      UPDATE notify.notifications
      SET metadata = jsonb_set(
        jsonb_set(metadata, '{coalesced_count}', (COALESCE((metadata->>'coalesced_count')::int, 1) + 1)::text::jsonb),
        '{last_coalesced_at}', now()::text::jsonb
      )
      WHERE id = ${existing.id}
    `;
    return { coalesced_count: existing.coalesced_count + 1, notification_id: existing.id };
  }

  // Create new coalescing notification
  const [notification] = await sql<[{ id: string }]>`
    INSERT INTO notify.notifications (user_id, workspace_id, channel, template_id, status, metadata)
    VALUES (
      ${userId},
      ${workspaceId},
      ${channel},
      ${templateId},
      'pending',
      ${JSON.stringify({ coalesce_key: coalesceKey, coalesced_count: 1, last_coalesced_at: new Date().toISOString() })}
    )
    RETURNING id
  `;

  return { coalesced_count: 1, notification_id: notification.id };
}

/**
 * Get deduplication statistics for a workspace.
 */
export async function getDedupStats(
  sql: Sql,
  workspaceId: string,
  days = 7,
): Promise<{ total_checked: number; duplicates_found: number; dedup_rate_pct: number }> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [stats] = await sql<[{ total: string; duplicates: string }]>`
    SELECT
      COUNT(*)::text as total,
      COUNT(*) FILTER (WHERE dedup_result = 'duplicate')::text as duplicates
    FROM notify.dedup_entries
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${cutoff.toISOString()}
  `;

  const total = Number(stats.total);
  const duplicates = Number(stats.duplicates);

  return {
    total_checked: total,
    duplicates_found: duplicates,
    dedup_rate_pct: total > 0 ? Math.round((duplicates / total) * 10000) / 100 : 0,
  };
}