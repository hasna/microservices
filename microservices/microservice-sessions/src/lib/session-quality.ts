/**
 * Session quality scoring — health and satisfaction signals per session.
 */

import type { Sql } from "postgres";

export interface SessionQualityScore {
  session_id: string;
  overall_score: number; // 0-100
  quality_tier: "excellent" | "good" | "fair" | "poor";
  signals: {
    completion_rate: number;        // did the session reach a natural endpoint?
    depth_score: number;           // number of turns, tokens used
    coherence_score: number;       // message length variance, response quality proxy
    engagement_score: number;       // user activity patterns
    efficiency_score: number;       // tokens per message, response time
  };
  flagged_issues: string[];
  calculated_at: string;
}

export interface SessionHealthReport {
  session_id: string;
  is_healthy: boolean;
  health_score: number; // 0-100
  issues: SessionHealthIssue[];
  recommendations: string[];
}

export interface SessionHealthIssue {
  type: "stalled" | "repetitive" | "token_bloat" | "abandoned" | "rapid_fire" | "missing_context";
  severity: "info" | "warning" | "critical";
  description: string;
  affected_message_ids: string[];
}

/**
 * Calculate overall quality score for a session.
 */
export async function calculateSessionQuality(
  sql: Sql,
  sessionId: string,
): Promise<SessionQualityScore | null> {
  // Get session messages
  const messages = await sql<{
    id: string;
    role: string;
    tokens: number | null;
    created_at: string;
    metadata: any;
  }[]>`
    SELECT id, role, tokens, created_at, metadata
    FROM sessions.messages
    WHERE conversation_id = ${sessionId}
    ORDER BY created_at ASC
  `;

  if (messages.length === 0) return null;

  const userMsgs = messages.filter(m => m.role === "user");
  const assistantMsgs = messages.filter(m => m.role === "assistant");

  // Completion rate: check if session ends with a clear signal (summary, goodbye, explicit end)
  const lastMsg = messages[messages.length - 1];
  const hasNaturalEnd = lastMsg.metadata?.intent === "close" ||
                        lastMsg.metadata?.intent === "summarize" ||
                        userMsgs.some(m => m.metadata?.intent === "close" || m.metadata?.intent === "summarize");
  const completionRate = hasNaturalEnd ? 100 : 60;

  // Depth score: turns and token usage
  const totalTokens = messages.reduce((sum, m) => sum + (m.tokens ?? 0), 0);
  const turnRatio = userMsgs.length > 0 ? assistantMsgs.length / userMsgs.length : 0;
  const depthScore = Math.min(100, (messages.length * 5) + (totalTokens / 100));

  // Coherence score: based on message length variance
  const assistantLengths = assistantMsgs.map(m => m.metadata?.content_length ?? 0);
  const avgLength = assistantLengths.length > 0
    ? assistantLengths.reduce((a, b) => a + b, 0) / assistantLengths.length
    : 0;
  const variance = assistantLengths.length > 1
    ? assistantLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / assistantLengths.length
    : 0;
  const coherenceScore = Math.max(0, 100 - Math.sqrt(variance) / 10);

  // Engagement score: user activity patterns (spacing, message length)
  const firstToLast = new Date(messages[messages.length - 1].created_at).getTime() -
                      new Date(messages[0].created_at).getTime();
  const avgSpacingMs = firstToLast / messages.length;
  const engagementScore = avgSpacingMs > 5000 && avgSpacingMs < 300000 ? 80 : avgSpacingMs >= 300000 ? 50 : 60;

  // Efficiency score: tokens per message
  const tokensPerMsg = messages.length > 0 ? totalTokens / messages.length : 0;
  const efficiencyScore = Math.min(100, tokensPerMsg / 10);

  const signals = {
    completion_rate: completionRate,
    depth_score: Math.round(depthScore),
    coherence_score: Math.round(coherenceScore),
    engagement_score: Math.round(engagementScore),
    efficiency_score: Math.round(efficiencyScore),
  };

  const overallScore = Math.round(
    signals.completion_rate * 0.2 +
    signals.depth_score * 0.25 +
    signals.coherence_score * 0.2 +
    signals.engagement_score * 0.15 +
    signals.efficiency_score * 0.2
  );

  const flaggedIssues: string[] = [];
  if (signals.coherence_score < 40) flaggedIssues.push("Low coherence - repetitive or incoherent responses");
  if (signals.efficiency_score < 30) flaggedIssues.push("Token bloat - high tokens per message");
  if (signals.engagement_score < 50) flaggedIssues.push("Abnormal engagement patterns");

  let qualityTier: SessionQualityScore["quality_tier"];
  if (overallScore >= 80) qualityTier = "excellent";
  else if (overallScore >= 60) qualityTier = "good";
  else if (overallScore >= 40) qualityTier = "fair";
  else qualityTier = "poor";

  return {
    session_id: sessionId,
    overall_score: overallScore,
    quality_tier: qualityTier,
    signals,
    flagged_issues: flaggedIssues,
    calculated_at: new Date().toISOString(),
  };
}

/**
 * Run a health check on a session, detecting issues.
 */
export async function checkSessionHealth(
  sql: Sql,
  sessionId: string,
): Promise<SessionHealthReport> {
  const messages = await sql<{
    id: string;
    role: string;
    tokens: number | null;
    created_at: string;
    metadata: any;
  }[]>`
    SELECT id, role, tokens, created_at, metadata
    FROM sessions.messages
    WHERE conversation_id = ${sessionId}
    ORDER BY created_at ASC
  `;

  const issues: SessionHealthIssue[] = [];

  if (messages.length < 2) {
    return {
      session_id: sessionId,
      is_healthy: true,
      health_score: 100,
      issues: [],
      recommendations: ["Session is just starting"],
    };
  }

  // Check for stalled session (no messages in last hour)
  const lastMsg = messages[messages.length - 1];
  const stalledMinutes = (Date.now() - new Date(lastMsg.created_at).getTime()) / 60000;
  if (stalledMinutes > 60 && !lastMsg.metadata?.ended) {
    issues.push({
      type: "stalled",
      severity: "warning",
      description: `Session stalled - no activity for ${Math.round(stalledMinutes)} minutes`,
      affected_message_ids: [lastMsg.id],
    });
  }

  // Check for repetitive content
  const recentContent = messages.slice(-5).map(m => m.metadata?.content_hash ?? "");
  const uniqueContent = new Set(recentContent);
  if (uniqueContent.size === 1 && recentContent.length >= 3) {
    issues.push({
      type: "repetitive",
      severity: "warning",
      description: "Last 5 messages have identical content hash - possible repetition",
      affected_message_ids: messages.slice(-5).map(m => m.id),
    });
  }

  // Check for token bloat (avg > 2000 tokens per assistant message)
  const assistantMsgs = messages.filter(m => m.role === "assistant");
  const avgTokens = assistantMsgs.reduce((sum, m) => sum + (m.tokens ?? 0), 0) / assistantMsgs.length;
  if (avgTokens > 2000) {
    issues.push({
      type: "token_bloat",
      severity: "info",
      description: `High average token count (${Math.round(avgTokens)}) - consider summarizing`,
      affected_message_ids: assistantMsgs.map(m => m.id),
    });
  }

  // Check for rapid fire messages (user sending multiple within seconds)
  const userMsgs = messages.filter(m => m.role === "user");
  for (let i = 1; i < userMsgs.length; i++) {
    const gap = new Date(userMsgs[i].created_at).getTime() - new Date(userMsgs[i-1].created_at).getTime();
    if (gap < 2000 && userMsgs[i].metadata?.content_length === userMsgs[i-1].metadata?.content_length) {
      issues.push({
        type: "rapid_fire",
        severity: "info",
        description: "Rapid consecutive messages with same length - possible bot/auto-send",
        affected_message_ids: [userMsgs[i].id],
      });
    }
  }

  // Check for abandoned session (< 2 minutes with < 3 messages)
  const firstMsg = messages[0];
  const sessionLength = new Date(lastMsg.created_at).getTime() - new Date(firstMsg.created_at).getTime();
  if (sessionLength < 120000 && messages.length < 3) {
    issues.push({
      type: "abandoned",
      severity: "warning",
      description: "Session appears abandoned - very short with few messages",
      affected_message_ids: messages.map(m => m.id),
    });
  }

  const healthScore = Math.max(0, 100 - (issues.length * 15) - (issues.filter(i => i.severity === "critical").length * 25));

  const recommendations: string[] = [];
  if (issues.some(i => i.type === "stalled")) recommendations.push("Consider ending or summarizing this session");
  if (issues.some(i => i.type === "token_bloat")) recommendations.push("Use context summarization to reduce token usage");
  if (issues.some(i => i.type === "abandoned")) recommendations.push("Review if session was accidentally started");
  if (issues.length === 0) recommendations.push("Session health is normal");

  return {
    session_id: sessionId,
    is_healthy: issues.filter(i => i.severity !== "info").length === 0,
    health_score: healthScore,
    issues,
    recommendations,
  };
}

/**
 * Store quality score for a session.
 */
export async function storeSessionQualityScore(
  sql: Sql,
  sessionId: string,
  score: SessionQualityScore,
): Promise<void> {
  await sql`
    INSERT INTO sessions.session_quality_scores (
      session_id, overall_score, quality_tier, signals, flagged_issues, calculated_at
    )
    VALUES (
      ${sessionId},
      ${score.overall_score},
      ${score.quality_tier},
      ${JSON.stringify(score.signals)}::jsonb,
      ${score.flagged_issues},
      ${score.calculated_at}
    )
    ON CONFLICT (session_id) DO UPDATE SET
      overall_score = EXCLUDED.overall_score,
      quality_tier = EXCLUDED.quality_tier,
      signals = EXCLUDED.signals,
      flagged_issues = EXCLUDED.flagged_issues,
      calculated_at = EXCLUDED.calculated_at
  `;
}

/**
 * List sessions by quality tier for a workspace.
 */
export async function listSessionsByQuality(
  sql: Sql,
  workspaceId: string,
  tier?: SessionQualityScore["quality_tier"],
  limit = 50,
): Promise<Array<{ session_id: string; overall_score: number; quality_tier: string; calculated_at: string }>> {
  if (tier) {
    return sql<Array<{ session_id: string; overall_score: number; quality_tier: string; calculated_at: string }>>`
      SELECT sqs.session_id, sqs.overall_score, sqs.quality_tier, sqs.calculated_at
      FROM sessions.session_quality_scores sqs
      JOIN sessions.conversations c ON c.id = sqs.session_id
      WHERE c.workspace_id = ${workspaceId} AND sqs.quality_tier = ${tier}
      ORDER BY sqs.overall_score DESC
      LIMIT ${limit}
    `;
  }

  return sql<Array<{ session_id: string; overall_score: number; quality_tier: string; calculated_at: string }>>`
    SELECT sqs.session_id, sqs.overall_score, sqs.quality_tier, sqs.calculated_at
    FROM sessions.session_quality_scores sqs
    JOIN sessions.conversations c ON c.id = sqs.session_id
    WHERE c.workspace_id = ${workspaceId}
    ORDER BY sqs.overall_score DESC
    LIMIT ${limit}
  `;
}