/**
 * Context summary settings — per-workspace configuration for how
 * summarization should behave: thresholds, default options, and model selection.
 */

import type { Sql } from "postgres";

export interface SummarySettings {
  workspace_id: string;
  default_keep_recent: number;
  default_target_tokens: number;
  auto_summarize_threshold: number;
  summarize_model: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateSummarySettingsOpts {
  default_keep_recent?: number;
  default_target_tokens?: number;
  auto_summarize_threshold?: number;
  summarize_model?: string | null;
  enabled?: boolean;
}

/**
 * Get the summary settings for a workspace.
 * Creates default settings if none exist.
 */
export async function getSummarySettings(
  sql: Sql,
  workspaceId: string,
): Promise<SummarySettings> {
  const [row] = await sql<SummarySettings[]>`
    SELECT * FROM sessions.summary_settings WHERE workspace_id = ${workspaceId}
  `;

  if (row) return row;

  // Create default settings
  const [created] = await sql<SummarySettings[]>`
    INSERT INTO sessions.summary_settings (workspace_id)
    VALUES (${workspaceId})
    RETURNING *
  `;
  return created;
}

/**
 * Update summary settings for a workspace.
 */
export async function updateSummarySettings(
  sql: Sql,
  workspaceId: string,
  opts: UpdateSummarySettingsOpts,
): Promise<SummarySettings> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (opts.default_keep_recent !== undefined) {
    fields.push(`default_keep_recent = $${idx++}`);
    values.push(opts.default_keep_recent);
  }
  if (opts.default_target_tokens !== undefined) {
    fields.push(`default_target_tokens = $${idx++}`);
    values.push(opts.default_target_tokens);
  }
  if (opts.auto_summarize_threshold !== undefined) {
    fields.push(`auto_summarize_threshold = $${idx++}`);
    values.push(opts.auto_summarize_threshold);
  }
  if (opts.summarize_model !== undefined) {
    fields.push(`summarize_model = $${idx++}`);
    values.push(opts.summarize_model);
  }
  if (opts.enabled !== undefined) {
    fields.push(`enabled = $${idx++}`);
    values.push(opts.enabled);
  }

  if (fields.length === 0) {
    return getSummarySettings(sql, workspaceId);
  }

  fields.push(`updated_at = NOW()`);
  values.push(workspaceId);

  const [row] = await sql<SummarySettings[]>`
    UPDATE sessions.summary_settings
    SET ${sql.unsafe(fields.join(", "))}
    WHERE workspace_id = $${idx}
    RETURNING *
  `;

  if (!row) {
    // Create if doesn't exist
    const [created] = await sql<SummarySettings[]>`
      INSERT INTO sessions.summary_settings (workspace_id)
      VALUES (${workspaceId})
      RETURNING *
    `;
    return created;
  }

  return row;
}

/**
 * Check whether auto-summarization is enabled for a workspace
 * and what the threshold is.
 */
export async function shouldAutoSummarize(
  sql: Sql,
  workspaceId: string,
  currentTokenCount: number,
): Promise<{ should: boolean; threshold: number; enabled: boolean }> {
  const settings = await getSummarySettings(sql, workspaceId);
  return {
    should: settings.enabled && currentTokenCount >= settings.auto_summarize_threshold,
    threshold: settings.auto_summarize_threshold,
    enabled: settings.enabled,
  };
}

/**
 * Delete summary settings for a workspace (reset to defaults).
 */
export async function deleteSummarySettings(
  sql: Sql,
  workspaceId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM sessions.summary_settings WHERE workspace_id = ${workspaceId}
  `;
  return (result.count ?? 0) > 0;
}
