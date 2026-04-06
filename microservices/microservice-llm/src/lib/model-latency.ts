/**
 * Model latency percentile statistics and quality scoring.
 */

import type { Sql } from "postgres";

export interface ModelLatencyStats {
  workspace_id: string;
  model: string;
  period_start: Date;
  period_end: Date;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  avg_ms: number;
  sample_count: number;
}

/**
 * Compute and store latency percentiles for a model over a time period.
 * Uses percentile_cont approximation via ORDER BY.
 */
export async function computeModelLatencyStats(
  sql: Sql,
  workspaceId: string,
  model: string,
  periodHours = 24,
): Promise<ModelLatencyStats | null> {
  const since = new Date(Date.now() - periodHours * 3_600_000);
  const until = new Date();

  const [row] = await sql.unsafe(`
    SELECT
      $2::text as workspace_id,
      $3::text as model,
      $4::timestamptz as period_start,
      $5::timestamptz as period_end,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::real AS p50_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::real AS p95_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::real AS p99_ms,
      MAX(latency_ms)::real AS max_ms,
      AVG(latency_ms)::real AS avg_ms,
      COUNT(*)::int AS sample_count
    FROM llm.requests
    WHERE workspace_id = $1
      AND model = $3
      AND created_at >= $4
      AND latency_ms > 0
  `, [workspaceId, workspaceId, model, since, until]) as any[];

  if (!row || row.sample_count === 0) return null;

  const stats: ModelLatencyStats = {
    workspace_id: row.workspace_id,
    model: row.model,
    period_start: row.period_start,
    period_end: row.period_end,
    p50_ms: row.p50_ms,
    p95_ms: row.p95_ms,
    p99_ms: row.p99_ms,
    max_ms: row.max_ms,
    avg_ms: row.avg_ms,
    sample_count: row.sample_count,
  };

  // Persist
  await sql`
    INSERT INTO llm.model_latency_stats
      (workspace_id, model, period_start, period_end, p50_ms, p95_ms, p99_ms, max_ms, avg_ms, sample_count)
    VALUES
      (${stats.workspace_id}, ${stats.model}, ${stats.period_start}, ${stats.period_end},
       ${stats.p50_ms}, ${stats.p95_ms}, ${stats.p99_ms}, ${stats.max_ms}, ${stats.avg_ms}, ${stats.sample_count})
  `;

  return stats;
}

/**
 * Get the latest stored latency stats for a model from the persistence table.
 */
export async function getModelLatencyStats(
  sql: Sql,
  workspaceId: string,
  model: string,
): Promise<ModelLatencyStats | null> {
  const [row] = await sql<any[]>`
    SELECT * FROM llm.model_latency_stats
    WHERE workspace_id = ${workspaceId} AND model = ${model}
    ORDER BY period_end DESC
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Get latency stats for all models in a workspace (freshly computed, not from table).
 */
export async function getAllModelLatencyStats(
  sql: Sql,
  workspaceId: string,
  periodHours = 24,
): Promise<ModelLatencyStats[]> {
  const since = new Date(Date.now() - periodHours * 3_600_000);

  const rows = await sql.unsafe(`
    SELECT
      workspace_id,
      model,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::real AS p50_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::real AS p95_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::real AS p99_ms,
      MAX(latency_ms)::real AS max_ms,
      AVG(latency_ms)::real AS avg_ms,
      COUNT(*)::int AS sample_count,
      MIN(created_at) AS period_start,
      MAX(created_at) AS period_end
    FROM llm.requests
    WHERE workspace_id = $1
      AND created_at >= $2
      AND latency_ms > 0
    GROUP BY workspace_id, model
    ORDER BY avg_ms DESC
  `, [workspaceId, since]) as any[];

  return rows.map((r) => ({
    workspace_id: r.workspace_id,
    model: r.model,
    period_start: r.period_start,
    period_end: r.period_end,
    p50_ms: r.p50_ms,
    p95_ms: r.p95_ms,
    p99_ms: r.p99_ms,
    max_ms: r.max_ms,
    avg_ms: r.avg_ms,
    sample_count: r.sample_count,
  }));
}

// --- Quality scoring ---

export interface QualityScore {
  id: string;
  request_id: string;
  workspace_id: string;
  model: string;
  score: number;
  feedback: string | null;
  scoring_type: "user" | "automated" | "task_completion";
  metadata: Record<string, unknown>;
  created_at: Date;
}

/**
 * Record a quality score for an LLM response.
 */
export async function recordQualityScore(
  sql: Sql,
  opts: {
    requestId: string;
    workspaceId: string;
    model: string;
    score: number;
    feedback?: string;
    scoringType?: "user" | "automated" | "task_completion";
    metadata?: Record<string, unknown>;
  },
): Promise<QualityScore> {
  const [row] = await sql<any[]>`
    INSERT INTO llm.model_quality_scores
      (request_id, workspace_id, model, score, feedback, scoring_type, metadata)
    VALUES
      (${opts.requestId}, ${opts.workspaceId}, ${opts.model},
       ${opts.score}, ${opts.feedback ?? null},
       ${opts.scoringType ?? "user"},
       ${sql.json(opts.metadata ?? {})})
    RETURNING *
  `;
  return {
    id: row.id,
    request_id: row.request_id,
    workspace_id: row.workspace_id,
    model: row.model,
    score: row.score,
    feedback: row.feedback,
    scoring_type: row.scoring_type,
    metadata: row.metadata,
    created_at: row.created_at,
  };
}

/**
 * Get average quality score per model for a workspace.
 */
export async function getModelQualityStats(
  sql: Sql,
  workspaceId: string,
  periodDays = 30,
): Promise<{ model: string; avg_score: number; count: number; last_score: Date }[]> {
  const since = new Date(Date.now() - periodDays * 86_400_000);
  const rows = await sql.unsafe(`
    SELECT
      model,
      AVG(score)::real AS avg_score,
      COUNT(*)::int AS count,
      MAX(created_at) AS last_score
    FROM llm.model_quality_scores
    WHERE workspace_id = $1 AND created_at >= $2
    GROUP BY model
    ORDER BY avg_score DESC
  `, [workspaceId, since]) as any[];
  return rows.map((r) => ({
    model: r.model,
    avg_score: r.avg_score,
    count: r.count,
    last_score: r.last_score,
  }));
}

// --- Conversation tracking ---

export interface Conversation {
  id: string;
  workspace_id: string;
  user_id: string | null;
  title: string | null;
  message_count: number;
  total_tokens: number;
  total_cost_usd: number;
  model: string | null;
  status: "active" | "archived";
  created_at: Date;
  updated_at: Date;
}

/**
 * Start a new conversation (tracked multi-turn session).
 */
export async function startConversation(
  sql: Sql,
  opts: {
    workspaceId: string;
    userId?: string;
    title?: string;
    model?: string;
  },
): Promise<Conversation> {
  const [row] = await sql<any[]>`
    INSERT INTO llm.conversations (workspace_id, user_id, title, model)
    VALUES (${opts.workspaceId}, ${opts.userId ?? null}, ${opts.title ?? null}, ${opts.model ?? null})
    RETURNING *
  `;
  return row;
}

/**
 * Add a message to a conversation and optionally attribute a request cost.
 */
export async function addConversationMessage(
  sql: Sql,
  opts: {
    conversationId: string;
    requestId?: string;
    role: "system" | "user" | "assistant";
    content: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  },
): Promise<void> {
  await sql`
    INSERT INTO llm.conversation_messages
      (conversation_id, request_id, role, content, tokens_in, tokens_out, cost_usd, model)
    VALUES
      (${opts.conversationId}, ${opts.requestId ?? null},
       ${opts.role}, ${opts.content},
       ${opts.tokensIn ?? 0}, ${opts.tokensOut ?? 0}, ${opts.costUsd ?? 0}, ${opts.model ?? null})
  `;

  // Update conversation aggregate
  await sql.unsafe(`
    UPDATE llm.conversations
    SET message_count = message_count + 1,
        total_tokens = total_tokens + $2,
        total_cost_usd = total_cost_usd + $3,
        updated_at = NOW()
    WHERE id = $1
  `, [opts.conversationId, opts.tokensIn ?? 0, opts.costUsd ?? 0]);
}

/**
 * Get cost breakdown for a conversation.
 */
export async function getConversationCost(
  sql: Sql,
  conversationId: string,
): Promise<{ conversation: Conversation; by_model: { model: string; messages: number; tokens: number; cost_usd: number }[] } | null> {
  const [conv] = await sql<any[]>`SELECT * FROM llm.conversations WHERE id = ${conversationId}`;
  if (!conv) return null;

  const byModel = await sql.unsafe(`
    SELECT
      COALESCE(model, 'unknown') AS model,
      COUNT(*)::int AS messages,
      SUM(tokens_in + tokens_out)::int AS tokens,
      ROUND(SUM(cost_usd)::numeric, 6)::numeric AS cost_usd
    FROM llm.conversation_messages
    WHERE conversation_id = $1
    GROUP BY model
    ORDER BY cost_usd DESC
  `, [conversationId]) as any[];

  return {
    conversation: conv,
    by_model: byModel.map((r) => ({
      model: r.model,
      messages: r.messages,
      tokens: r.tokens,
      cost_usd: Number(r.cost_usd),
    })),
  };
}
