/**
 * TTL sweeper coordinator — background process for aggressive TTL enforcement.
 * Runs periodic sweeps to delete expired memories and enforce tier-based TTL policies.
 */

import type { Sql } from "postgres";

export interface TtlSweeperStats {
	runs: number;
	deleted: number;
	errors: number;
	lastRunAt: Date | null;
}

export interface TtlTierPolicy {
	memoryType: string;
	maxAgeSeconds: number | null;
	enforceHardExpiry: boolean;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000; // 1 minute

let sweeperInterval: ReturnType<typeof setInterval> | null = null;
let sweeperStats: TtlSweeperStats = {
	runs: 0,
	deleted: 0,
	errors: 0,
	lastRunAt: null,
};

/**
 * Start the background TTL sweeper.
 * Runs every `intervalMs` milliseconds and deletes expired memories.
 */
export function startTtlSweeper(
	sqlGetter: () => Sql,
	intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS,
): void {
	if (sweeperInterval) return;

	sweeperInterval = setInterval(async () => {
		const sql = sqlGetter();
		try {
			const count = await runSweep(sql);
			sweeperStats.runs++;
			sweeperStats.deleted += count;
			sweeperStats.lastRunAt = new Date();
		} catch {
			sweeperStats.errors++;
		}
	}, intervalMs);
}

/**
 * Stop the background TTL sweeper.
 */
export function stopTtlSweeper(): void {
	if (sweeperInterval) {
		clearInterval(sweeperInterval);
		sweeperInterval = null;
	}
}

/**
 * Get current sweeper statistics.
 */
export function getTtlSweeperStats(): TtlSweeperStats {
	return { ...sweeperStats };
}

/**
 * Run a single TTL sweep — deletes all expired memories across all workspaces.
 * Pinned memories are excluded from TTL enforcement.
 */
export async function runSweep(sql: Sql): Promise<number> {
	const result = await sql.unsafe(`
		DELETE FROM memory.memories
		WHERE is_pinned = false
		  AND expires_at IS NOT NULL
		  AND expires_at < NOW()
		RETURNING id
	`);
	return result.count ?? 0;
}

/**
 * Run a targeted sweep for a specific workspace.
 */
export async function runWorkspaceSweep(sql: Sql, workspaceId: string): Promise<number> {
	const result = await sql.unsafe(
		`DELETE FROM memory.memories
		 WHERE workspace_id = $1 AND is_pinned = false AND expires_at IS NOT NULL AND expires_at < NOW()
		 RETURNING id`,
		[workspaceId],
	);
	return result.count ?? 0;
}

/**
 * Enforce TTL tier for a specific memory type in a workspace.
 * Deletes memories older than maxAgeSeconds for that type.
 */
export async function enforceTtlTier(
	sql: Sql,
	workspaceId: string,
	memoryType: string,
	maxAgeSeconds: number | null,
): Promise<number> {
	if (maxAgeSeconds === null) return 0;

	const result = await sql.unsafe(
		`DELETE FROM memory.memories
		 WHERE workspace_id = $1
		   AND memory_type = $2
		   AND is_pinned = false
		   AND created_at < NOW() - INTERVAL '1 second' * $3
		 RETURNING id`,
		[workspaceId, memoryType, maxAgeSeconds],
	);
	return result.count ?? 0;
}

/**
 * Get TTL enforcement statistics for a workspace.
 */
export async function getTtlStats(
	sql: Sql,
	workspaceId?: string,
): Promise<{
	expiredCount: number;
	expiringSoonCount: number;
	byType: Record<string, number>;
	pinnedCount: number;
}> {
	const baseQuery = workspaceId
		? `WHERE workspace_id = '${workspaceId}'`
		: "";

	const [expiredResult] = await sql.unsafe(
		`SELECT COUNT(*) as count FROM memory.memories ${baseQuery} AND is_pinned = false AND expires_at IS NOT NULL AND expires_at < NOW()`,
	) as any[];

	const [expiringSoonResult] = await sql.unsafe(
		`SELECT COUNT(*) as count FROM memory.memories ${baseQuery} AND is_pinned = false AND expires_at IS NOT NULL AND expires_at > NOW() AND expires_at < NOW() + INTERVAL '1 hour'`,
	) as any[];

	const [pinnedResult] = await sql.unsafe(
		`SELECT COUNT(*) as count FROM memory.memories ${baseQuery} AND is_pinned = true`,
	) as any[];

	const byType: Record<string, number> = {};
	try {
		const typeRows = await sql.unsafe(
			`SELECT memory_type, COUNT(*) as count FROM memory.memories ${baseQuery} AND is_pinned = false AND expires_at IS NOT NULL AND expires_at < NOW() GROUP BY memory_type`,
		) as any[];
		for (const row of typeRows) {
			byType[row.memory_type] = Number(row.count);
		}
	} catch {}

	return {
		expiredCount: Number(expiredResult?.count ?? 0),
		expiringSoonCount: Number(expiringSoonResult?.count ?? 0),
		byType,
		pinnedCount: Number(pinnedResult?.count ?? 0),
	};
}

/**
 * Schedule TTL enforcement for a workspace based on memory type configs.
 * Runs tier-based enforcement for each configured memory type.
 */
export async function enforceAllTtlTiers(
	sql: Sql,
	workspaceId: string,
	policies: TtlTierPolicy[],
): Promise<Record<string, number>> {
	const results: Record<string, number> = {};

	for (const policy of policies) {
		const deleted = await enforceTtlTier(
			sql,
			workspaceId,
			policy.memoryType,
			policy.maxAgeSeconds,
		);
		results[policy.memoryType] = deleted;
	}

	return results;
}

/**
 * Evict oldest memories to make room for new ones (LRU-style).
 * Useful when namespace quotas are exceeded.
 */
export async function evictByAge(
	sql: Sql,
	workspaceId: string,
	maxMemories: number,
	namespace?: string,
): Promise<number> {
	const namespaceClause = namespace
		? `AND c.namespace = '${namespace}'`
		: "";

	const result = await sql.unsafe(
		`DELETE FROM memory.memories m
		 USING memory.collections c
		 WHERE m.collection_id = c.id
		   AND m.workspace_id = $1
		   ${namespaceClause}
		   AND m.id IN (
		     SELECT id FROM memory.memories
		     WHERE workspace_id = $1 AND is_pinned = false
		     ORDER BY created_at ASC
		     LIMIT GREATEST(0, (SELECT COUNT(*) FROM memory.memories WHERE workspace_id = $1) - $2)
		   )
		 RETURNING m.id`,
		[workspaceId, maxMemories],
	);
	return result.count ?? 0;
}