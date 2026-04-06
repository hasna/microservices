/**
 * Memory namespace isolation and hard quotas.
 * Enforces strict boundary between namespaces with resource limits
 * and cross-namespace access controls.
 */

import type { Sql } from "postgres";

export interface NamespaceQuota {
	namespaceId: string;
	maxMemories: number | null;
	maxCollections: number | null;
	maxSizeBytes: number | null;
	enforceHardLimit: boolean;
	currentMemories: number;
	currentCollections: number;
	currentSizeBytes: number;
}

export interface NamespaceAccessPolicy {
	namespaceId: string;
	allowedWorkspaceIds: string[];
	blockedWorkspaceIds: string[];
	publicRead: boolean;
	publicWrite: boolean;
}

export interface NamespaceWithQuota extends NamespaceAccessPolicy {
	quota: NamespaceQuota;
}

/**
 * Check if a workspace can write to a namespace (within its quota).
 */
export async function canWriteToNamespace(
	sql: Sql,
	namespaceId: string,
	workspaceId: string,
): Promise<{ allowed: boolean; reason?: string; quotaRemaining?: number }> {
	const ns = await sql<any[]>`
		SELECT n.*, nq.max_memories, nq.max_collections, nq.max_size_bytes, nq.enforce_hard_limit
		FROM memory.namespaces n
		LEFT JOIN memory.namespace_quotas nq ON n.id = nq.namespace_id
		WHERE n.id = ${namespaceId}
	`;

	if (!ns || ns.length === 0) {
		return { allowed: false, reason: "Namespace not found" };
	}

	const row = ns[0];

	// Check workspace access
	if (row.blocked_workspace_ids && row.blocked_workspace_ids.includes(workspaceId)) {
		return { allowed: false, reason: "Workspace is blocked from this namespace" };
	}

	if (row.allowed_workspace_ids &&
		row.allowed_workspace_ids.length > 0 &&
		!row.allowed_workspace_ids.includes(workspaceId)) {
		return { allowed: false, reason: "Workspace not in allowed list" };
	}

	if (!row.public_write) {
		const hasAccess = row.allowed_workspace_ids?.includes(workspaceId) ?? false;
		if (!hasAccess && !row.public_write) {
			return { allowed: false, reason: "Namespace does not allow write access" };
		}
	}

	// Check quota
	if (row.max_memories !== null && row.enforce_hard_limit) {
		const [countResult] = await sql<any[]>`
			SELECT COUNT(*) as cnt FROM memory.memories m
			JOIN memory.collections c ON m.collection_id = c.id
			WHERE c.namespace = ${namespaceId}
		`;
		const current = Number(countResult?.cnt ?? 0);
		if (current >= row.max_memories) {
			return { allowed: false, reason: `Namespace quota reached: ${current}/${row.max_memories} memories`, quotaRemaining: 0 };
		}
		return { allowed: true, quotaRemaining: row.max_memories - current };
	}

	return { allowed: true, quotaRemaining: undefined };
}

/**
 * Get detailed quota status for a namespace.
 */
export async function getNamespaceQuota(
	sql: Sql,
	namespaceId: string,
): Promise<NamespaceQuota | null> {
	const [row] = await sql<any[]>`
		SELECT
			n.id as namespace_id,
			nq.max_memories,
			nq.max_collections,
			nq.max_size_bytes,
			nq.enforce_hard_limit,
			COALESCE(mc.current_memories, 0) as current_memories,
			COALESCE(cc.current_collections, 0) as current_collections,
			COALESCE(sc.current_size_bytes, 0) as current_size_bytes
		FROM memory.namespaces n
		LEFT JOIN memory.namespace_quotas nq ON n.id = nq.namespace_id
		LEFT JOIN LATERAL (
			SELECT COUNT(*) as current_memories FROM memory.memories m
			JOIN memory.collections c ON m.collection_id = c.id
			WHERE c.namespace = n.id
		) mc ON true
		LEFT JOIN LATERAL (
			SELECT COUNT(*) as current_collections FROM memory.collections c
			WHERE c.namespace = n.id
		) cc ON true
		LEFT JOIN LATERAL (
			SELECT COALESCE(SUM(LENGTH(m.content)), 0) as current_size_bytes
			FROM memory.memories m
			JOIN memory.collections c ON m.collection_id = c.id
			WHERE c.namespace = n.id
		) sc ON true
		WHERE n.id = ${namespaceId}
	`;

	if (!row) return null;

	return {
		namespaceId: row.namespace_id,
		maxMemories: row.max_memories,
		maxCollections: row.max_collections,
		maxSizeBytes: row.max_size_bytes,
		enforceHardLimit: row.enforce_hard_limit ?? false,
		currentMemories: Number(row.current_memories),
		currentCollections: Number(row.current_collections),
		currentSizeBytes: Number(row.current_size_bytes),
	};
}

/**
 * Enforce namespace hard limits - reject writes when quota exceeded.
 */
export async function enforceNamespaceHardQuota(
	sql: Sql,
	namespaceId: string,
	contentSizeBytes: number = 0,
): Promise<{ allowed: boolean; reason?: string }> {
	const quota = await getNamespaceQuota(sql, namespaceId);
	if (!quota) return { allowed: true };

	if (quota.maxMemories !== null && quota.enforceHardLimit) {
		if (quota.currentMemories >= quota.maxMemories) {
			return { allowed: false, reason: `Namespace memory quota exceeded: ${quota.currentMemories}/${quota.maxMemories}` };
		}
	}

	if (quota.maxCollections !== null && quota.enforceHardLimit) {
		if (quota.currentCollections >= quota.maxCollections) {
			return { allowed: false, reason: `Namespace collection quota exceeded: ${quota.currentCollections}/${quota.maxCollections}` };
		}
	}

	if (quota.maxSizeBytes !== null && quota.enforceHardLimit) {
		if (quota.currentSizeBytes + contentSizeBytes > quota.maxSizeBytes) {
			return { allowed: false, reason: `Namespace storage quota would be exceeded` };
		}
	}

	return { allowed: true };
}

/**
 * Set quota for a namespace.
 */
export async function setNamespaceQuota(
	sql: Sql,
	namespaceId: string,
	opts: {
		maxMemories?: number | null;
		maxCollections?: number | null;
		maxSizeBytes?: number | null;
		enforceHardLimit?: boolean;
	},
): Promise<void> {
	await sql`
		INSERT INTO memory.namespace_quotas (namespace_id, max_memories, max_collections, max_size_bytes, enforce_hard_limit)
		VALUES (${namespaceId}, ${opts.maxMemories ?? null}, ${opts.maxCollections ?? null}, ${opts.maxSizeBytes ?? null}, ${opts.enforceHardLimit ?? false})
		ON CONFLICT (namespace_id)
		DO UPDATE SET
			max_memories = EXCLUDED.max_memories,
			max_collections = EXCLUDED.max_collections,
			max_size_bytes = EXCLUDED.max_size_bytes,
			enforce_hard_limit = EXCLUDED.enforce_hard_limit
	`;
}

/**
 * Set access policy for a namespace.
 */
export async function setNamespaceAccessPolicy(
	sql: Sql,
	namespaceId: string,
	opts: {
		allowedWorkspaceIds?: string[];
		blockedWorkspaceIds?: string[];
		publicRead?: boolean;
		publicWrite?: boolean;
	},
): Promise<void> {
	await sql`
		UPDATE memory.namespaces SET
			allowed_workspace_ids = ${opts.allowedWorkspaceIds ?? null},
			blocked_workspace_ids = ${opts.blockedWorkspaceIds ?? null},
			public_read = ${opts.publicRead ?? false},
			public_write = ${opts.publicWrite ?? false}
		WHERE id = ${namespaceId}
	`;
}

/**
 * List namespaces with quota information for a workspace.
 */
export async function listNamespacesWithQuota(
	sql: Sql,
	workspaceId: string,
): Promise<NamespaceWithQuota[]> {
	const namespaces = await sql<any[]>`
		SELECT * FROM memory.namespaces
		WHERE workspace_id = ${workspaceId}
		ORDER BY name
	`;

	const results: NamespaceWithQuota[] = [];
	for (const row of namespaces) {
		const quota = await getNamespaceQuota(sql, row.id);
		results.push({
			namespaceId: row.id,
			allowedWorkspaceIds: row.allowed_workspace_ids ?? [],
			blockedWorkspaceIds: row.blocked_workspace_ids ?? [],
			publicRead: row.public_read ?? false,
			publicWrite: row.public_write ?? false,
			quota: quota!,
		});
	}
	return results;
}

/**
 * Delete all memories in a namespace (hard delete, quota enforced).
 */
export async function deleteNamespaceMemories(
	sql: Sql,
	namespaceId: string,
): Promise<number> {
	const result = await sql.unsafe(
		`DELETE FROM memory.memories m USING memory.collections c
		 WHERE m.collection_id = c.id AND c.namespace = $1
		 RETURNING m.id`,
		[namespaceId],
	);
	return result.count ?? 0;
}

/**
 * Check if a workspace can read from a namespace.
 */
export async function canReadFromNamespace(
	sql: Sql,
	namespaceId: string,
	workspaceId: string,
): Promise<boolean> {
	const [row] = await sql<any[]>`
		SELECT allowed_workspace_ids, blocked_workspace_ids, public_read
		FROM memory.namespaces WHERE id = ${namespaceId}
	`;

	if (!row) return false;

	if (row.blocked_workspace_ids?.includes(workspaceId)) return false;
	if (row.public_read) return true;
	if (row.allowed_workspace_ids?.includes(workspaceId)) return true;

	return false;
}