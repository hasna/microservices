/**
 * Typed memory queries by memory type (episodic/semantic/procedural/context).
 *
 * Each memory type has different retrieval characteristics:
 * - episodic: recency-weighted, timeline-ordered
 * - semantic: importance-weighted, embedding similarity
 * - procedural: step-sequence, instruction-ordered
 * - context: ephemeral, newest-first
 */

import type { Sql } from "postgres";
import type { Memory } from "./memories.js";

export type MemoryType = "episodic" | "semantic" | "procedural" | "context";

export interface TypedMemory extends Memory {
	memoryType: MemoryType;
}

/**
 * Query episodic memories — ordered by recency (newest first),
 * filtered by time window, with importance weighting.
 */
export async function queryEpisodicMemories(
	sql: Sql,
	workspaceId: string,
	opts: {
		namespace?: string;
		collectionId?: string;
		sinceHours?: number;
		maxResults?: number;
		importanceThreshold?: number;
		includePinned?: boolean;
	} = {},
): Promise<TypedMemory[]> {
	const conditions: string[] = ["m.workspace_id = $1"];
	const params: any[] = [workspaceId];
	let paramIdx = 2;

	if (opts.namespace) {
		conditions.push(`c.namespace = $${paramIdx++}`);
		params.push(opts.namespace);
	}
	if (opts.collectionId) {
		conditions.push(`m.collection_id = $${paramIdx++}`);
		params.push(opts.collectionId);
	}
	if (opts.sinceHours) {
		conditions.push(`m.created_at > NOW() - INTERVAL '1 hour' * $${paramIdx++}`);
		params.push(opts.sinceHours);
	}
	if (!opts.includePinned) {
		conditions.push(`m.is_pinned = false`);
	}
	if (opts.importanceThreshold !== undefined) {
		conditions.push(`m.importance >= $${paramIdx++}`);
		params.push(opts.importanceThreshold);
	}

	const whereClause = conditions.join(" AND ");
	const limit = opts.maxResults ?? 100;

	const rows = await sql.unsafe(`
		SELECT m.*, 'episodic' as memory_type, c.namespace
		FROM memory.memories m
		JOIN memory.collections c ON m.collection_id = c.id
		WHERE ${whereClause}
		ORDER BY m.created_at DESC
		LIMIT ${limit}
	`, params);

	return rows as unknown as TypedMemory[];
}

/**
 * Query semantic memories — ordered by importance and embedding similarity.
 */
export async function querySemanticMemories(
	sql: Sql,
	workspaceId: string,
	opts: {
		namespace?: string;
		collectionId?: string;
		importanceThreshold?: number;
		maxResults?: number;
		includePinned?: boolean;
	} = {},
): Promise<TypedMemory[]> {
	const conditions: string[] = ["m.workspace_id = $1"];
	const params: any[] = [workspaceId];
	let paramIdx = 2;

	if (opts.namespace) {
		conditions.push(`c.namespace = $${paramIdx++}`);
		params.push(opts.namespace);
	}
	if (opts.collectionId) {
		conditions.push(`m.collection_id = $${paramIdx++}`);
		params.push(opts.collectionId);
	}
	if (!opts.includePinned) {
		conditions.push(`m.is_pinned = false`);
	}
	if (opts.importanceThreshold !== undefined) {
		conditions.push(`m.importance >= $${paramIdx++}`);
		params.push(opts.importanceThreshold);
	}

	const whereClause = conditions.join(" AND ");
	const limit = opts.maxResults ?? 100;

	const rows = await sql.unsafe(`
		SELECT m.*, 'semantic' as memory_type, c.namespace
		FROM memory.memories m
		JOIN memory.collections c ON m.collection_id = c.id
		WHERE ${whereClause}
		ORDER BY m.importance DESC, m.updated_at DESC
		LIMIT ${limit}
	`, params);

	return rows as unknown as TypedMemory[];
}

/**
 * Query procedural memories — ordered by step sequence.
 * Procedures are typically stored with step metadata in content.
 */
export async function queryProceduralMemories(
	sql: Sql,
	workspaceId: string,
	opts: {
		namespace?: string;
		collectionId?: string;
		maxResults?: number;
		includePinned?: boolean;
	} = {},
): Promise<TypedMemory[]> {
	const conditions: string[] = ["m.workspace_id = $1"];
	const params: any[] = [workspaceId];
	let paramIdx = 2;

	if (opts.namespace) {
		conditions.push(`c.namespace = $${paramIdx++}`);
		params.push(opts.namespace);
	}
	if (opts.collectionId) {
		conditions.push(`m.collection_id = $${paramIdx++}`);
		params.push(opts.collectionId);
	}
	if (!opts.includePinned) {
		conditions.push(`m.is_pinned = false`);
	}

	const whereClause = conditions.join(" AND ");
	const limit = opts.maxResults ?? 100;

	const rows = await sql.unsafe(`
		SELECT m.*, 'procedural' as memory_type, c.namespace
		FROM memory.memories m
		JOIN memory.collections c ON m.collection_id = c.id
		WHERE ${whereClause}
		ORDER BY m.created_at ASC
		LIMIT ${limit}
	`, params);

	return rows as unknown as TypedMemory[];
}

/**
 * Query context memories — newest first, ephemeral, short TTL.
 * Returns only recent context with no importance weighting.
 */
export async function queryContextMemories(
	sql: Sql,
	workspaceId: string,
	opts: {
		namespace?: string;
		collectionId?: string;
		maxResults?: number;
		maxAgeSeconds?: number;
	} = {},
): Promise<TypedMemory[]> {
	const conditions: string[] = ["m.workspace_id = $1"];
	const params: any[] = [workspaceId];
	let paramIdx = 2;

	if (opts.namespace) {
		conditions.push(`c.namespace = $${paramIdx++}`);
		params.push(opts.namespace);
	}
	if (opts.collectionId) {
		conditions.push(`m.collection_id = $${paramIdx++}`);
		params.push(opts.collectionId);
	}
	if (opts.maxAgeSeconds) {
		conditions.push(`m.created_at > NOW() - INTERVAL '1 second' * $${paramIdx++}`);
		params.push(opts.maxAgeSeconds);
	}

	const whereClause = conditions.join(" AND ");
	const limit = opts.maxResults ?? 50;

	const rows = await sql.unsafe(`
		SELECT m.*, 'context' as memory_type, c.namespace
		FROM memory.memories m
		JOIN memory.collections c ON m.collection_id = c.id
		WHERE ${whereClause}
		ORDER BY m.created_at DESC
		LIMIT ${limit}
	`, params);

	return rows as unknown as TypedMemory[];
}

/**
 * Query all memory types with a single function, returning typed memories.
 */
export async function queryTypedMemories(
	sql: Sql,
	workspaceId: string,
	type: MemoryType,
	opts: Parameters<typeof queryEpisodicMemories>[3] = {},
): Promise<TypedMemory[]> {
	switch (type) {
		case "episodic":
			return queryEpisodicMemories(sql, workspaceId, opts);
		case "semantic":
			return querySemanticMemories(sql, workspaceId, opts);
		case "procedural":
			return queryProceduralMemories(sql, workspaceId, opts);
		case "context":
			return queryContextMemories(sql, workspaceId, opts);
	}
}

/**
 * Get memory type distribution for a workspace.
 */
export async function getMemoryTypeDistribution(
	sql: Sql,
	workspaceId: string,
): Promise<Record<MemoryType, number>> {
	const rows = await sql.unsafe(`
		SELECT m.memory_type, COUNT(*) as count
		FROM memory.memories m
		JOIN memory.collections c ON m.collection_id = c.id
		WHERE m.workspace_id = $1
		GROUP BY m.memory_type
	`, [workspaceId]) as any[];

	const distribution: Record<MemoryType, number> = {
		episodic: 0,
		semantic: 0,
		procedural: 0,
		context: 0,
	};

	for (const row of rows) {
		if (row.memory_type in distribution) {
			distribution[row.memory_type as MemoryType] = Number(row.count);
		}
	}

	return distribution;
}

/**
 * Count memories by type in a namespace.
 */
export async function countMemoriesByType(
	sql: Sql,
	namespaceId: string,
): Promise<Record<MemoryType, number>> {
	const rows = await sql.unsafe(`
		SELECT m.memory_type, COUNT(*) as count
		FROM memory.memories m
		JOIN memory.collections c ON m.collection_id = c.id
		WHERE c.namespace = $1
		GROUP BY m.memory_type
	`, [namespaceId]) as any[];

	const counts: Record<MemoryType, number> = {
		episodic: 0,
		semantic: 0,
		procedural: 0,
		context: 0,
	};

	for (const row of rows) {
		if (row.memory_type in counts) {
			counts[row.memory_type as MemoryType] = Number(row.count);
		}
	}

	return counts;
}

/**
 * Archive memories of a specific type older than threshold.
 */
export async function archiveMemoriesByType(
	sql: Sql,
	workspaceId: string,
	memoryType: MemoryType,
	olderThanSeconds: number,
): Promise<number> {
	const result = await sql.unsafe(`
		UPDATE memory.memories
		SET metadata = jsonb_set(metadata, '{archived}', 'true'),
		    updated_at = NOW()
		WHERE workspace_id = $1
		  AND memory_type = $2
		  AND is_pinned = false
		  AND created_at < NOW() - INTERVAL '1 second' * $3
		RETURNING id
	`, [workspaceId, memoryType, olderThanSeconds]);

	return result.count ?? 0;
}