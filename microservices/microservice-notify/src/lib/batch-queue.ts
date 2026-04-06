import type { Sql } from "bun.js";

export interface BatchQueueConfig {
	maxConcurrent?: number;
	maxBatchSize?: number;
	retryAttempts?: number;
	retryDelayMs?: number;
}

export interface QueuedNotification {
	id?: number;
	userId: string;
	workspaceId: string;
	channel: string;
	type: string;
	title: string;
	body: string;
	data?: Record<string, any>;
	priority?: number;
	scheduledAt?: Date;
	createdAt?: Date;
}

export interface BatchQueueStats {
	pending: number;
	processing: number;
	completed: number;
	failed: number;
	totalProcessed: number;
	oldestPendingAge?: number;
}

export async function enqueueBatchNotifications(
	sql: Sql,
	notifications: QueuedNotification[]
): Promise<{ queued: number; rejected: number }> {
	if (!notifications || notifications.length === 0) {
		return { queued: 0, rejected: 0 };
	}

	let queued = 0;
	let rejected = 0;

	const rows = notifications.map((n) => ({
		user_id: n.userId,
		workspace_id: n.workspaceId,
		channel: n.channel,
		type: n.type,
		title: n.title,
		body: n.body,
		data: n.data ? JSON.stringify(n.data) : null,
		priority: n.priority ?? 5,
		scheduled_at: n.scheduledAt ?? null,
		status: "pending",
	}));

	try {
		const result = await sql`INSERT INTO notification_delivery ${sql(rows)} RETURNING id`;
		queued = notifications.length;
		rejected = 0;
	} catch {
		rejected = notifications.length;
	}

	return { queued, rejected };
}

export async function dequeueBatchNotifications(
	sql: Sql,
	limit: number = 100,
	channels?: string[]
): Promise<QueuedNotification[]> {
	let query = sql`SELECT id, user_id, workspace_id, channel, type, title, body, data, priority, scheduled_at, created_at FROM notification_delivery WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= now())`;

	if (channels && channels.length > 0) {
		query = sql`SELECT id, user_id, workspace_id, channel, type, title, body, data, priority, scheduled_at, created_at FROM notification_delivery WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= now()) AND channel IN ${sql(channels)}`;
	}

	query = sql`${query} ORDER BY priority DESC, created_at ASC LIMIT ${limit}`;

	const rows = await query;

	return (rows as any[]).map((row) => ({
		id: row.id,
		userId: row.user_id,
		workspaceId: row.workspace_id,
		channel: row.channel,
		type: row.type,
		title: row.title,
		body: row.body,
		data: row.data ? JSON.parse(row.data) : null,
		priority: row.priority,
		scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : undefined,
		createdAt: row.created_at ? new Date(row.created_at) : undefined,
	}));
}

export async function markBatchDelivered(sql: Sql, ids: number[]): Promise<void> {
	if (ids.length === 0) return;
	await sql`UPDATE notification_delivery SET status = 'delivered', delivered_at = now() WHERE id IN ${sql(ids)}`;
}

export async function markBatchFailed(sql: Sql, ids: number[], reason?: string): Promise<void> {
	if (ids.length === 0) return;
	await sql`UPDATE notification_delivery SET status = 'failed', error = ${reason ?? "Unknown error"}, delivered_at = now() WHERE id IN ${sql(ids)}`;
}

export async function rescheduleBatchNotifications(
	sql: Sql,
	ids: number[],
	newScheduledAt: Date
): Promise<void> {
	if (ids.length === 0) return;
	await sql`UPDATE notification_delivery SET scheduled_at = ${newScheduledAt}, status = 'pending' WHERE id IN ${sql(ids)}`;
}

export async function getBatchQueueStats(sql: Sql): Promise<BatchQueueStats> {
	const stats: BatchQueueStats = {
		pending: 0,
		processing: 0,
		completed: 0,
		failed: 0,
		totalProcessed: 0,
	};

	try {
		const rows = await sql`SELECT status, COUNT(*) as count FROM notification_delivery GROUP BY status`;
		for (const row of rows as any[]) {
			const count = Number(row.count);
			if (row.status === "pending") stats.pending = count;
			else if (row.status === "processing") stats.processing = count;
			else if (row.status === "delivered") { stats.completed = count; stats.totalProcessed += count; }
			else if (row.status === "failed") { stats.failed = count; stats.totalProcessed += count; }
		}

		const oldest = await sql`SELECT MIN(created_at) as oldest FROM notification_delivery WHERE status = 'pending'`;
		if (oldest && (oldest as any[])[0]?.oldest) {
			const oldestTime = new Date((oldest as any[])[0].oldest).getTime();
			stats.oldestPendingAge = Date.now() - oldestTime;
		}
	} catch {}

	return stats;
}

export async function processBatchWithConcurrency(
	sql: Sql,
	handler: (notification: QueuedNotification) => Promise<boolean>,
	config: BatchQueueConfig = {}
): Promise<{ processed: number; succeeded: number; failed: number }> {
	const maxConcurrent = config.maxConcurrent ?? 10;
	const maxBatchSize = config.maxBatchSize ?? 100;

	const queue = await dequeueBatchNotifications(sql, maxBatchSize);

	if (queue.length === 0) {
		return { processed: 0, succeeded: 0, failed: 0 };
	}

	const ids = queue.map((n) => n.id!).filter(Boolean);

	try {
		await sql`UPDATE notification_delivery SET status = 'processing' WHERE id IN ${sql(ids)}`;
	} catch {
		return { processed: 0, succeeded: 0, failed: 0 };
	}

	let processed = 0;
	let succeeded = 0;
	let failed = 0;

	for (let i = 0; i < queue.length; i += maxConcurrent) {
		const batch = queue.slice(i, i + maxConcurrent);
		const results = await Promise.allSettled(
			batch.map(async (notification) => {
				try {
					const ok = await handler(notification);
					return ok;
				} catch {
					return false;
				}
			})
		);

		const batchIds: number[] = [];
		const batchFailedIds: number[] = [];

		for (let j = 0; j < results.length; j++) {
			const result = results[j];
			const id = batch[j].id!;
			processed++;

			if (result.status === "fulfilled" && result.value) {
				succeeded++;
				batchIds.push(id);
			} else {
				failed++;
				batchFailedIds.push(id);
			}
		}

		if (batchIds.length > 0) {
			await markBatchDelivered(sql, batchIds);
		}
		if (batchFailedIds.length > 0) {
			await markBatchFailed(sql, batchFailedIds, "Handler returned false");
		}
	}

	return { processed, succeeded, failed };
}
