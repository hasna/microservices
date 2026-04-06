/**
 * Session merge — 3-way merge combining changes from two sessions
 * into a new or existing target session.
 */

import type { Sql } from "postgres";
import { getConversation } from "./conversations.js";
import { getMessages } from "./messages.js";

export interface ThreeWayMergeOptions {
  sourceSessionId: string;
  targetSessionId: string;
  ancestorSessionId: string;
  newSessionTitle?: string;
  workspaceId?: string;
  userId?: string;
  conflictStrategy?: "source_wins" | "target_wins" | "keep_both" | "skip";
  archiveSource?: boolean;
  archiveTarget?: boolean;
}

export interface MergeConflict {
  position: number;
  ancestor_content: string;
  source_content: string;
  target_content: string;
  resolution: "source" | "target" | "both" | "skipped";
  resolved_content: string;
}

export interface ThreeWayMergeResult {
  new_session_id: string;
  source_session_id: string;
  target_session_id: string;
  ancestor_session_id: string;
  messages_merged: number;
  conflicts_resolved: number;
  conflicts: MergeConflict[];
  source_only_count: number;
  target_only_count: number;
  common_count: number;
}

interface MessageAtPosition {
  id: string;
  position: number;
  content: string;
  role: string;
  tokens: number;
  created_at: Date;
}

function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Perform a 3-way merge of three sessions.
 * The ancestor is used to determine which messages are unique to source/target.
 */
export async function threeWayMerge(
  sql: Sql,
  options: ThreeWayMergeOptions,
): Promise<ThreeWayMergeResult> {
  const {
    sourceSessionId,
    targetSessionId,
    ancestorSessionId,
    newSessionTitle,
    workspaceId,
    userId,
    conflictStrategy = "source_wins",
    archiveSource = false,
    archiveTarget = false,
  } = options;

  // Fetch all messages from the three sessions
  const [ancestorMsgs, sourceMsgs, targetMsgs] = await Promise.all([
    getMessages(sql, ancestorSessionId, { limit: 10000 }),
    getMessages(sql, sourceSessionId, { limit: 10000 }),
    getMessages(sql, targetSessionId, { limit: 10000 }),
  ]);

  // Build position-keyed maps for ancestor and source
  const ancestorByPos = new Map<number, (typeof ancestorMsgs)[0]>();
  const sourceByPos = new Map<number, (typeof sourceMsgs)[0]>();
  const targetByPos = new Map<number, (typeof targetMsgs)[0]>();

  for (const m of ancestorMsgs) {
    ancestorByPos.set(m.position ?? 0, m);
  }
  for (const m of sourceMsgs) {
    sourceByPos.set(m.position ?? 0, m);
  }
  for (const m of targetMsgs) {
    targetByPos.set(m.position ?? 0, m);
  }

  // Classify messages: common (unchanged in both), source-only, target-only, conflict
  const allPositions = new Set([
    ...ancestorByPos.keys(),
    ...sourceByPos.keys(),
    ...targetByPos.keys(),
  ]);

  const sourceOnly: MessageAtPosition[] = [];
  const targetOnly: MessageAtPosition[] = [];
  const conflicts: MergeConflict[] = [];
  let commonCount = 0;

  for (const pos of [...allPositions].sort((a, b) => a - b)) {
    const ancestor = ancestorByPos.get(pos);
    const source = sourceByPos.get(pos);
    const target = targetByPos.get(pos);

    const sourceChanged = source && (!ancestor || hashContent(source.content) !== hashContent(ancestor.content));
    const targetChanged = target && (!ancestor || hashContent(target.content) !== hashContent(ancestor.content));

    if (sourceChanged && targetChanged && source && target) {
      // Conflict
      let resolution: MergeConflict["resolution"] = conflictStrategy === "skip" ? "skipped" : conflictStrategy === "keep_both" ? "both" : conflictStrategy === "target_wins" ? "target" : "source";
      let resolvedContent = resolution === "target" ? target.content : resolution === "source" ? source.content : source.content + "\n\n[CONFLICT MERGED]\n" + target.content;
      if (resolution === "skipped") resolvedContent = "[CONFLICT SKIPPED]";

      conflicts.push({
        position: pos,
        ancestor_content: ancestor?.content ?? "",
        source_content: source.content,
        target_content: target.content,
        resolution,
        resolved_content: resolvedContent,
      });
    } else if (sourceChanged && !targetChanged && source) {
      sourceOnly.push({ id: source.id, position: pos, content: source.content, role: source.role, tokens: source.tokens ?? 0, created_at: source.created_at });
    } else if (!sourceChanged && targetChanged && target) {
      targetOnly.push({ id: target.id, position: pos, content: target.content, role: target.role, tokens: target.tokens ?? 0, created_at: target.created_at });
    } else if (source && target && hashContent(source.content) === hashContent(target.content)) {
      commonCount++;
    }
  }

  // Create the merged session
  const ancestor = await getConversation(sql, ancestorSessionId);
  const newSession = await sql.begin(async (tx: any) => {
    const [created] = await tx`
      INSERT INTO sessions.conversations (workspace_id, user_id, title, model, system_prompt, metadata)
      VALUES (
        ${workspaceId ?? ancestor.workspace_id},
        ${userId ?? ancestor.user_id},
        ${newSessionTitle ?? `${ancestor.title ?? "Merged"} (merged)`},
        ${ancestor.model},
        ${ancestor.system_prompt ?? ""},
        ${JSON.stringify({ merged_from: [sourceSessionId, targetSessionId], ancestor: ancestorSessionId })}
      )
      RETURNING id
    `;
    return created;
  });

  const newSessionId = newSession.id;

  // Insert common messages (from target as base)
  for (const pos of [...allPositions].sort((a, b) => a - b)) {
    const source = sourceByPos.get(pos);
    const target = targetByPos.get(pos);
    const ancestor2 = ancestorByPos.get(pos);

    if (!source && !target) continue;

    const sourceChanged = source && (!ancestor2 || hashContent(source.content) !== hashContent(ancestor2.content));
    const targetChanged = target && (!ancestor2 || hashContent(target.content) !== hashContent(ancestor2.content));

    if (!sourceChanged && target) {
      // Unchanged in source, use target
      await sql`
        INSERT INTO sessions.messages (conversation_id, role, content, name, tool_calls, tokens, latency_ms, model, metadata, fork_point)
        VALUES (
          ${newSessionId}, ${target.role}, ${target.content},
          ${target.name ?? null}, ${target.tool_calls ? JSON.stringify(target.tool_calls) : null},
          ${target.tokens ?? 0}, ${target.latency_ms ?? null}, ${target.model ?? null},
          ${target.metadata ? JSON.stringify(target.metadata) : "{}"}, false
        )
      `;
    } else if (sourceChanged && !targetChanged && source) {
      // Unchanged in target, use source
      await sql`
        INSERT INTO sessions.messages (conversation_id, role, content, name, tool_calls, tokens, latency_ms, model, metadata, fork_point)
        VALUES (
          ${newSessionId}, ${source.role}, ${source.content},
          ${source.name ?? null}, ${source.tool_calls ? JSON.stringify(source.tool_calls) : null},
          ${source.tokens ?? 0}, ${source.latency_ms ?? null}, ${source.model ?? null},
          ${source.metadata ? JSON.stringify(source.metadata) : "{}"}, false
        )
      `;
    } else if (sourceChanged && targetChanged) {
      // Conflict resolved
      const conflict = conflicts.find((c) => c.position === pos);
      if (conflict && conflict.resolution !== "skipped") {
        await sql`
          INSERT INTO sessions.messages (conversation_id, role, content, name, tool_calls, tokens, latency_ms, model, metadata, fork_point)
          VALUES (
            ${newSessionId}, ${target?.role ?? source?.role ?? "user"},
            ${conflict.resolved_content},
            ${null}, ${null},
            ${source?.tokens ?? 0}, ${null}, ${null},
            ${JSON.stringify({ conflict_from: [sourceSessionId, targetSessionId] })}, false
          )
        `;
      }
    }
  }

  // Optionally archive source and target
  if (archiveSource) {
    await sql`UPDATE sessions.conversations SET is_archived = true WHERE id = ${sourceSessionId}`;
  }
  if (archiveTarget) {
    await sql`UPDATE sessions.conversations SET is_archived = true WHERE id = ${targetSessionId}`;
  }

  return {
    new_session_id: newSessionId,
    source_session_id: sourceSessionId,
    target_session_id: targetSessionId,
    ancestor_session_id: ancestorSessionId,
    messages_merged: sourceOnly.length + targetOnly.length + conflicts.filter((c) => c.resolution !== "skipped").length,
    conflicts_resolved: conflicts.filter((c) => c.resolution !== "skipped").length,
    conflicts,
    source_only_count: sourceOnly.length,
    target_only_count: targetOnly.length,
    common_count: commonCount,
  };
}
