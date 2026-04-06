/**
 * Query intent classification — microservice-knowledge.
 *
 * Classifies user search/retrieval queries by intent to improve
 * retrieval strategy and result ranking.
 *
 * Intents:
 * - factual: "what is X", "who is Y" — look for exact matches
 * - conversational: follow-ups, dialogue — maintain context
 * - analytical: "why", "how does X compare to Y" — synthesize from multiple sources
 * - navigational: "find the policy on X" — locate specific documents
 */

import type { Sql } from "postgres";

export type QueryIntent =
  | "factual"
  | "conversational"
  | "analytical"
  | "navigational"
  | "unknown";

export interface IntentCandidate {
  intent: QueryIntent;
  confidence: number;
  signals: string[];
}

export interface IntentClassification {
  query: string;
  primary_intent: QueryIntent;
  confidence: number;
  candidates: IntentCandidate[];
  suggested_strategy: "exact_match" | "semantic" | "hybrid" | "graph_walk";
  created_at: string;
}

/**
 * Classify a query's intent using keyword and pattern analysis.
 *
 * Uses rules-based classification with confidence scoring based on:
 * - Question words (who, what, when, where, why, how)
 * - Comparison patterns ("compare", "vs", "difference")
 * - Navigational patterns ("find", " locate", "show me")
 * - Conversational patterns ("actually", "but", "follow-up")
 */
export async function classifyQueryIntent(
  query: string,
): Promise<IntentClassification> {
  const lowerQuery = query.toLowerCase().trim();
  const words = lowerQuery.split(/\s+/);
  const signals: string[] = [];
  const intentScores: Record<QueryIntent, number> = {
    factual: 0,
    conversational: 0,
    analytical: 0,
    navigational: 0,
    unknown: 0,
  };

  // Factual indicators
  const factualPatterns = [
    /^what is/i, /^who is/i, /^who was/i, /^what was/i,
    /^when did/i, /^when was/i, /^where is/i, /^where did/i,
    /^how many/i, /^how much/i, /^what year/i, /^what date/i,
    /^(?:the |a |an )?\w+ is (?:a |an )?\w+/i,
  ];
  for (const pattern of factualPatterns) {
    if (pattern.test(lowerQuery)) {
      intentScores.factual += 0.4;
      signals.push("factual_pattern");
    }
  }

  // Question word detection
  if (/^(?:what|who|when|where|how|which)/i.test(lowerQuery)) {
    intentScores.factual += 0.2;
    signals.push("question_word");
  }

  // Comparison/analytical indicators
  const analyticalPatterns = [
    /compare/i, /versus/i, /vs\.?/i, /difference between/i,
    /how does .+ (?:compare|relate) to/i, /why is .+ better/i,
    /advantages? .+ over/i, /pros and cons/i, /benefit/i,
    /analyze/i, /analysis/i, /explain/i, /elaborate/i,
  ];
  for (const pattern of analyticalPatterns) {
    if (pattern.test(lowerQuery)) {
      intentScores.analytical += 0.5;
      signals.push("analytical_pattern");
    }
  }

  // Navigational indicators
  const navigationalPatterns = [
    /^find/i, /^locate/i, /^show me (?:the | )?(?:doc|policy|page)/i,
    /^where (?:can |do I )?find/i, /^get me (?:the | )?(?:doc|policy)/i,
    /^look up/i, /^search for (?:the | )?(?:doc|policy|info)/i,
    /^open/i, /^navigate to/i,
  ];
  for (const pattern of navigationalPatterns) {
    if (pattern.test(lowerQuery)) {
      intentScores.navigational += 0.5;
      signals.push("navigational_pattern");
    }
  }

  // Direct document reference suggests navigational
  if (/the (?:doc|document|policy|page|article|report)/i.test(lowerQuery)) {
    intentScores.navigational += 0.3;
    signals.push("document_reference");
  }

  // Conversational indicators
  const conversationalPatterns = [
    /^actually,/i, /^but /i, /^however,/i, /^so /i,
    /^follow[_-]?up/i, /^meaning/i, /^clarify/i,
    /what (?:do you mean|does that mean)/i,
    /can you (?:explain|clarify|elaborate)/i,
  ];
  for (const pattern of conversationalPatterns) {
    if (pattern.test(lowerQuery)) {
      intentScores.conversational += 0.5;
      signals.push("conversational_pattern");
    }
  }

  // Short queries tend to be navigational or factual
  if (words.length <= 3) {
    intentScores.navigational += 0.1;
    intentScores.factual += 0.1;
  }

  // Long queries suggest analytical
  if (words.length >= 10) {
    intentScores.analytical += 0.15;
    signals.push("long_query_analytical");
  }

  // Build candidates sorted by confidence
  const candidates: IntentCandidate[] = (
    Object.entries(intentScores) as [QueryIntent, number][]
  )
    .filter(([intent]) => intent !== "unknown")
    .map(([intent, score]) => ({ intent, confidence: Math.min(score, 1) }))
    .filter((c) => c.confidence > 0.05)
    .sort((a, b) => b.confidence - a.confidence);

  const primaryIntent = candidates[0]?.intent ?? "unknown";
  const confidence = candidates[0]?.confidence ?? 0;

  // Suggest retrieval strategy
  let suggestedStrategy: IntentClassification["suggested_strategy"];
  switch (primaryIntent) {
    case "factual":
      suggestedStrategy = "exact_match";
      break;
    case "analytical":
      suggestedStrategy = "hybrid";
      break;
    case "navigational":
      suggestedStrategy = "semantic";
      break;
    case "conversational":
      suggestedStrategy = "semantic";
      break;
    default:
      suggestedStrategy = "hybrid";
  }

  return {
    query,
    primary_intent: primaryIntent,
    confidence,
    candidates,
    suggested_strategy: suggestedStrategy,
    created_at: new Date().toISOString(),
  };
}

/**
 * Record a query intent classification for analytics.
 */
export async function recordQueryIntent(
  sql: Sql,
  workspaceId: string,
  query: string,
  intent: QueryIntent,
  confidence: number,
  strategyUsed?: string,
): Promise<void> {
  await sql`
    INSERT INTO knowledge.query_intents (
      workspace_id, query, intent, confidence, strategy_used
    )
    VALUES (
      ${workspaceId}, ${query}, ${intent}, ${confidence},
      ${strategyUsed ?? null}
    )
  `;
}

/**
 * Get intent distribution analytics for a workspace.
 */
export async function getIntentDistribution(
  sql: Sql,
  workspaceId: string,
  since?: string,
): Promise<{
  total_queries: number;
  by_intent: { intent: string; count: number; avg_confidence: number }[];
  suggested_strategies: { strategy: string; count: number }[];
}> {
  const sinceDate = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [totals] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int as total
    FROM knowledge.query_intents
    WHERE workspace_id = ${workspaceId} AND created_at >= ${sinceDate}
  `;

  const byIntent = await sql<{ intent: string; count: number; avg_confidence: number }[]>`
    SELECT
      intent,
      COUNT(*)::int as count,
      AVG(confidence)::float as avg_confidence
    FROM knowledge.query_intents
    WHERE workspace_id = ${workspaceId} AND created_at >= ${sinceDate}
    GROUP BY intent
    ORDER BY count DESC
  `;

  const strategies = await sql<{ strategy: string; count: number }[]>`
    SELECT strategy_used as strategy, COUNT(*)::int as count
    FROM knowledge.query_intents
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${sinceDate}
      AND strategy_used IS NOT NULL
    GROUP BY strategy_used
    ORDER BY count DESC
  `;

  return {
    total_queries: totals?.total ?? 0,
    by_intent: byIntent,
    suggested_strategies: strategies,
  };
}

/**
 * Get queries with low confidence classifications
 * (potential edge cases to improve intent detection).
 */
export async function getLowConfidenceQueries(
  sql: Sql,
  workspaceId: string,
  threshold = 0.3,
  limit = 50,
): Promise<{ query: string; intent: string; confidence: number; count: number }[]> {
  const rows = await sql<{ query: string; intent: string; confidence: number; count: number }[]>`
    SELECT
      query,
      intent,
      AVG(confidence)::float as confidence,
      COUNT(*)::int as count
    FROM knowledge.query_intents
    WHERE workspace_id = ${workspaceId}
      AND confidence < ${threshold}
    GROUP BY query, intent
    ORDER BY count DESC, confidence ASC
    LIMIT ${limit}
  `;
  return rows;
}
