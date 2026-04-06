/**
 * Branch comparison — compare two branches of a fork tree.
 *
 * When a session has multiple forks (branches), this lets you compare
 * any two branches: which messages diverge, how much token/semantic
 * drift has occurred, and which branch is "larger" by various metrics.
 *
 * Usage:
 *   const cmp = await compareBranches(sql, branchAId, branchBId)
 */

import type { Sql } from "postgres";
import { getConversation } from "./conversations.js";
import { getMessages } from "./messages.js";
import { getSessionImportance } from "./session-importance.js";
import { diffSessions } from "./session-diff.js";

export interface BranchMetrics {
  sessionId: string;
  messageCount: number;
  tokenCount: number;
  importanceScore: number | null;
  lastActivityAt: string | null;
}

export interface BranchDivergence {
  commonAncestorSessionId: string | null;
  commonMessages: number;
  divergentMessages: number;
  tokenDrift: number;
  semanticDrift: number;   // estimated from token count ratio difference
  largerBranch: string;    // session ID of the larger branch
  sizeRatio: number;       // tokens_b / tokens_a
}

export interface BranchComparison {
  branchA: BranchMetrics;
  branchB: BranchMetrics;
  divergence: BranchDivergence;
  divergentMessages: {
    sessionId: string;
    messageId: string;
    role: string;
    contentPreview: string;
    tokens: number;
    createdAt: string;
  }[];
}

/**
 * Compare two branches and return structured comparison.
 */
export async function compareBranches(
  sql: Sql,
  sessionA: string,
  sessionB: string,
): Promise<BranchComparison> {
  const [convA, convB] = await Promise.all([
    getConversation(sql, sessionA),
    getConversation(sql, sessionB),
  ]);

  const [msgsA, msgsB] = await Promise.all([
    getMessages(sql, sessionA, { limit: 10000 }),
    getMessages(sql, sessionB, { limit: 10000 }),
  ]);

  const [importanceA, importanceB] = await Promise.all([
    getSessionImportance(sql, sessionA).catch(() => null),
    getSessionImportance(sql, sessionB).catch(() => null),
  ]);

  const tokensA = msgsA.reduce((sum: number, m: any) => sum + (m.token_count ?? 0), 0);
  const tokensB = msgsB.reduce((sum: number, m: any) => sum + (m.token_count ?? 0), 0);

  const branchA: BranchMetrics = {
    sessionId: sessionA,
    messageCount: msgsA.length,
    tokenCount: tokensA,
    importanceScore: importanceA?.importance_score ?? null,
    lastActivityAt: msgsA.length > 0 ? (msgsA[msgsA.length - 1] as any).created_at?.toString() ?? null : null,
  };

  const branchB: BranchMetrics = {
    sessionId: sessionB,
    messageCount: msgsB.length,
    tokenCount: tokensB,
    importanceScore: importanceB?.importance_score ?? null,
    lastActivityAt: msgsB.length > 0 ? (msgsB[msgsB.length - 1] as any).created_at?.toString() ?? null : null,
  };

  // Find common messages by matching content+role roughly
  // (True semantic dedup would need embedding lookups, here we use content hash)
  const msgsByContentA = new Map(msgsA.map((m: any) => [m.content_hash ?? m.content?.slice(0, 50), m]));
  const msgsByContentB = new Map(msgsB.map((m: any) => [m.content_hash ?? m.content?.slice(0, 50), m]));

  let commonCount = 0;
  const divergent: BranchComparison["divergentMessages"] = [];

  for (const mA of msgsA) {
    const key = (mA as any).content_hash ?? (mA as any).content?.slice(0, 50);
    if (msgsByContentB.has(key)) {
      commonCount++;
    } else {
      divergent.push({
        sessionId: sessionA,
        messageId: (mA as any).id,
        role: (mA as any).role,
        contentPreview: String((mA as any).content ?? "").slice(0, 100),
        tokens: (mA as any).token_count ?? 0,
        createdAt: (mA as any).created_at?.toString() ?? "",
      });
    }
  }

  for (const mB of msgsB) {
    const key = (mB as any).content_hash ?? (mB as any).content?.slice(0, 50);
    if (!msgsByContentA.has(key)) {
      divergent.push({
        sessionId: sessionB,
        messageId: (mB as any).id,
        role: (mB as any).role,
        contentPreview: String((mB as any).content ?? "").slice(0, 100),
        tokens: (mB as any).token_count ?? 0,
        createdAt: (mB as any).created_at?.toString() ?? "",
      });
    }
  }

  const largerBranch = tokensB >= tokensA ? sessionB : sessionA;
  const sizeRatio = tokensA > 0 ? tokensB / tokensA : 0;
  const tokenDrift = Math.abs(tokensA - tokensB);
  const semanticDrift = Math.abs(tokensA - tokensB) / Math.max(tokensA, tokensB);

  const divergence: BranchDivergence = {
    commonAncestorSessionId: convA?.parent_id ?? convB?.parent_id ?? null,
    commonMessages: commonCount,
    divergentMessages: divergent.length,
    tokenDrift,
    semanticDrift: Math.round(semanticDrift * 100) / 100,
    largerBranch,
    sizeRatio: Math.round(sizeRatio * 100) / 100,
  };

  return { branchA, branchB, divergence, divergentMessages: divergent.slice(0, 50) };
}

/**
 * Find all branch pairs in a fork tree for a given root.
 */
export async function listAllBranchPairs(
  sql: Sql,
  rootSessionId: string,
): Promise<{ sessionA: string; sessionB: string; relationship: string }[]> {
  const [children] = await sql<{ id: string; parent_id: string | null }[]>`
    SELECT id, parent_id FROM sessions.conversations
    WHERE parent_id = ${rootSessionId} OR id = ${rootSessionId}
  `;

  const allIds: string[] = [rootSessionId];
  const descendants = await sql<{ id: string }[]>`
    WITH RECURSIVE descendants AS (
      SELECT id, parent_id FROM sessions.conversations WHERE parent_id = ${rootSessionId}
      UNION ALL
      SELECT c.id, c.parent_id FROM sessions.conversations c
      JOIN descendants d ON d.id = c.parent_id
    )
    SELECT id FROM descendants
  `;
  allIds.push(...descendants.map((d) => d.id));

  const pairs: { sessionA: string; sessionB: string; relationship: string }[] = [];
  for (let i = 0; i < allIds.length; i++) {
    for (let j = i + 1; j < allIds.length; j++) {
      pairs.push({ sessionA: allIds[i], sessionB: allIds[j], relationship: "fork" });
    }
  }
  return pairs;
}