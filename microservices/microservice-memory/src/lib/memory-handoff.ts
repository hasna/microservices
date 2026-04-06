/**
 * Memory handoff and context transfer for AI agents.
 *
 * When switching between AI agents, we need to:
 * 1. Generate a summary of relevant memories for the new agent
 * 2. Transfer memory context between different AI agent sessions
 * 3. Score how relevant memories are to a given topic
 */

import type { Sql } from "postgres";
import { searchMemories, type Memory, type SearchQuery } from "./memories.js";
import { getMemoryQualityScore, type MemoryQualityBreakdown } from "./recall.js";
import { getOutgoingLinks, getIncomingLinks } from "./memory-links.js";

export interface MemoryHandoffSummary {
  agent_id: string;
  topic: string;
  summary: string;
  relevant_memories: HandoffMemory[];
  confidence: number;
  generated_at: string;
}

export interface HandoffMemory {
  memory_id: string;
  content: string;
  memory_type: string;
  relevance_score: number;
  importance_score: number;
  last_accessed: string;
  is_pinned: boolean;
  linked_memory_ids: string[];
}

export interface CrossAgentContext {
  source_agent_id: string;
  target_agent_id: string;
  transferred_memories: string[];
  transfer_reason: string;
  transferred_at: string;
}

export interface MemoryRelevanceScore {
  memory_id: string;
  topic: string;
  relevance_score: number;
  relevance_factors: {
    semantic_similarity: number;
    temporal_relevance: number;
    access_frequency: number;
    importance_weight: number;
  };
}

/**
 * Generate a handoff summary of relevant memories for a new AI agent.
 * Used when switching agents to provide context to the new agent.
 */
export async function generateMemoryHandoffSummary(
  sql: Sql,
  agentId: string,
  topic: string,
  workspaceId: string,
  options?: {
    maxMemories?: number;
    minRelevanceScore?: number;
  },
): Promise<MemoryHandoffSummary> {
  const maxMemories = options?.maxMemories ?? 20;
  const minRelevanceScore = options?.minRelevanceScore ?? 0.3;

  // Search for relevant memories using the topic
  const searchResults = await searchMemories(sql, workspaceId, {
    query: topic,
    limit: maxMemories * 2,
    includeArchived: false,
  });

  // Score each memory for relevance to the topic and overall importance
  const scoredMemories: HandoffMemory[] = [];

  for (const result of searchResults.results) {
    const memory = result.memory;
    const quality = await getMemoryQualityScore(sql, memory.id);

    // Calculate relevance score based on search score and quality
    const relevanceScore = (result.score || 0) * 0.6 + (quality.quality_score / 100) * 0.4;

    if (relevanceScore < minRelevanceScore) continue;

    // Get linked memories
    const outgoing = await getOutgoingLinks(sql, memory.id);
    const incoming = await getIncomingLinks(sql, memory.id);
    const linkedIds = [...outgoing, ...incoming].map((l) => l.target_id || l.source_id).filter(Boolean);

    scoredMemories.push({
      memory_id: memory.id,
      content: memory.content,
      memory_type: memory.type,
      relevance_score: relevanceScore,
      importance_score: quality.quality_score,
      last_accessed: memory.updated_at || memory.created_at,
      is_pinned: memory.is_pinned || false,
      linked_memory_ids: linkedIds.slice(0, 5),
    });
  }

  // Sort by relevance score descending
  scoredMemories.sort((a, b) => b.relevance_score - a.relevance_score);
  const topMemories = scoredMemories.slice(0, maxMemories);

  // Generate a summary of the memories
  const summary = generateSummaryText(topic, topMemories);

  return {
    agent_id: agentId,
    topic,
    summary,
    relevant_memories: topMemories,
    confidence: topMemories.length > 0 ? Math.min(0.9, 0.5 + topMemories.length * 0.02) : 0,
    generated_at: new Date().toISOString(),
  };
}

function generateSummaryText(topic: string, memories: HandoffMemory[]): string {
  if (memories.length === 0) {
    return `No relevant memories found for topic: ${topic}`;
  }

  const types: Record<string, number> = {};
  for (const m of memories) {
    types[m.memory_type] = (types[m.memory_type] || 0) + 1;
  }

  const topTypes = Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `${count} ${type} memory${count > 1 ? "ies" : "y"}`);

  const highRelevance = memories.filter((m) => m.relevance_score > 0.7).length;
  const pinned = memories.filter((m) => m.is_pinned).length;

  let summary = `Found ${memories.length} relevant memory${memories.length > 1 ? "ies" : "y"} for topic "${topic}"`;
  summary += `. Contains ${topTypes.join(", ")}`;
  summary += `. ${highRelevance} high-relevance, ${pinned} pinned.`;

  if (memories.length > 0) {
    const preview = memories[0].content.slice(0, 100);
    summary += ` Most relevant: "${preview}${memories[0].content.length > 100 ? "..." : ""}"`;
  }

  return summary;
}

/**
 * Transfer memory context from one agent to another.
 * This creates links between memories and records the transfer.
 */
export async function transferMemoryContext(
  sql: Sql,
  sourceAgentId: string,
  targetAgentId: string,
  memoryIds: string[],
  reason?: string,
): Promise<CrossAgentContext> {
  // In a real implementation, this would:
  // 1. Create agent session associations
  // 2. Link transferred memories to the target agent's context
  // 3. Record the transfer for audit purposes

  const transferredAt = new Date().toISOString();

  // Store the transfer record
  await sql`
    INSERT INTO memory.agent_memory_transfers (
      source_agent_id, target_agent_id, transferred_at, reason, memory_count
    ) VALUES (
      ${sourceAgentId},
      ${targetAgentId},
      ${transferredAt},
      ${reason || null},
      ${memoryIds.length}
    )
  `;

  return {
    source_agent_id: sourceAgentId,
    target_agent_id: targetAgentId,
    transferred_memories: memoryIds,
    transfer_reason: reason || "No reason provided",
    transferred_at: transferredAt,
  };
}

/**
 * Score how relevant each memory is to a given topic.
 * Returns memories sorted by relevance.
 */
export async function scoreMemoriesByTopicRelevance(
  sql: Sql,
  workspaceId: string,
  topic: string,
  options?: {
    limit?: number;
    memoryType?: string;
  },
): Promise<MemoryRelevanceScore[]> {
  const limit = options?.limit ?? 50;

  // Search memories matching the topic
  const searchResults = await searchMemories(sql, workspaceId, {
    query: topic,
    limit,
    includeArchived: false,
  });

  const scores: MemoryRelevanceScore[] = [];

  for (const result of searchResults.results) {
    const memory = result.memory;
    const quality = await getMemoryQualityScore(sql, memory.id);

    // Factor in semantic similarity from search, temporal relevance, access frequency
    const semanticSimilarity = result.score || 0;
    const temporalRelevance = quality.freshness_score;
    const accessFrequency = Math.min(quality.access_frequency / 10, 1); // Normalize
    const importanceWeight = quality.quality_score / 100;

    const relevanceScore =
      semanticSimilarity * 0.4 +
      temporalRelevance * 0.2 +
      accessFrequency * 0.2 +
      importanceWeight * 0.2;

    scores.push({
      memory_id: memory.id,
      topic,
      relevance_score: relevanceScore,
      relevance_factors: {
        semantic_similarity: semanticSimilarity,
        temporal_relevance: temporalRelevance,
        access_frequency: accessFrequency,
        importance_weight: importanceWeight,
      },
    });
  }

  // Sort by relevance score descending
  return scores.sort((a, b) => b.relevance_score - a.relevance_score);
}

/**
 * Get memories that should be prioritized for a new agent session.
 * Combines relevance to topic with recency and importance.
 */
export async function getPrioritizedMemoriesForAgent(
  sql: Sql,
  agentId: string,
  workspaceId: string,
  topic: string,
  maxMemories?: number,
): Promise<Memory[]> {
  const max = maxMemories ?? 10;

  // Get relevance scores
  const relevanceScores = await scoreMemoriesByTopicRelevance(sql, workspaceId, topic, { limit: max * 2 });

  // Get the top memories
  const memoryIds = relevanceScores.slice(0, max).map((r) => r.memory_id);

  // Fetch full memory objects
  const memories: Memory[] = [];
  for (const id of memoryIds) {
    const { getMemory } = await import("./memories.js");
    const memory = await getMemory(sql, id);
    if (memory) {
      memories.push(memory);
    }
  }

  return memories;
}
