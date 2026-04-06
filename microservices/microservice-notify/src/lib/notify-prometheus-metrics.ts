import type { Sql } from "bun.js";

export interface NotifyMetric {
	name: string;
	help: string;
	type: "counter" | "gauge" | "histogram" | "summary";
	value: number;
	labels?: Record<string, string>;
}

export interface NotifyMetrics {
	timestamps: NotifyMetric[];
	deliveries: NotifyMetric[];
	channels: NotifyMetric[];
	latencies: NotifyMetric[];
}

export function getNotifyMetrics(): NotifyMetrics {
	const now = Date.now();
	return {
		timestamps: [
			{ name: "notify_processing_duration_ms", help: "Time spent processing notifications", type: "gauge", value: now, labels: {} },
		],
		deliveries: [
			{ name: "notify_deliveries_total", help: "Total notifications delivered", type: "counter", value: 0, labels: { channel: "all" } },
			{ name: "notify_deliveries_success", help: "Successful deliveries", type: "counter", value: 0, labels: { channel: "all" } },
			{ name: "notify_deliveries_failed", help: "Failed deliveries", type: "counter", value: 0, labels: { channel: "all" } },
			{ name: "notify_deliveries_retried", help: "Retry attempts", type: "counter", value: 0, labels: { channel: "all" } },
		],
		channels: [
			{ name: "notify_channel_queue_size", help: "Pending notifications per channel", type: "gauge", value: 0, labels: { channel: "email" } },
			{ name: "notify_channel_queue_size", help: "Pending notifications per channel", type: "gauge", value: 0, labels: { channel: "sms" } },
			{ name: "notify_channel_queue_size", help: "Pending notifications per channel", type: "gauge", value: 0, labels: { channel: "push" } },
			{ name: "notify_channel_queue_size", help: "Pending notifications per channel", type: "gauge", value: 0, labels: { channel: "webhook" } },
		],
		latencies: [
			{ name: "notify_delivery_latency_ms", help: "Notification delivery latency", type: "histogram", value: 0, labels: { channel: "all" } },
		],
	};
}

export function toPrometheusTextFormat(metrics: NotifyMetrics): string {
	const lines: string[] = [];

	for (const metric of [...metrics.timestamps, ...metrics.deliveries, ...metrics.channels, ...metrics.latencies]) {
		const labelStr = metric.labels && Object.keys(metric.labels).length > 0
			? `{${Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(",")}}`
			: "";
		lines.push(`# HELP ${metric.name} ${metric.help}`);
		lines.push(`# TYPE ${metric.name} ${metric.type}`);
		lines.push(`${metric.name}${labelStr} ${metric.value}`);
	}

	return lines.join("\n") + "\n";
}

export async function exportNotifyMetrics(sql: Sql): Promise<string> {
	const metrics = await fetchNotifyMetricsFromDb(sql);
	return toPrometheusTextFormat(metrics);
}

export async function exportNotifyMetricsJSON(sql: Sql): Promise<string> {
	const metrics = await fetchNotifyMetricsFromDb(sql);
	return JSON.stringify(metrics, null, 2);
}

async function fetchNotifyMetricsFromDb(sql: Sql): Promise<NotifyMetrics> {
	const now = Date.now();

	let totalDeliveries = 0;
	let successDeliveries = 0;
	let failedDeliveries = 0;
	let retriedDeliveries = 0;

	try {
		const deliveryRows = await sql`SELECT status, COUNT(*) as count FROM notification_delivery GROUP BY status`;
		for (const row of deliveryRows as any[]) {
			totalDeliveries += Number(row.count);
			if (row.status === "delivered") successDeliveries += Number(row.count);
			else if (row.status === "failed") failedDeliveries += Number(row.count);
			else if (row.status === "pending") retriedDeliveries += Number(row.count);
		}
	} catch {}

	const channelQueueSizes: Record<string, number> = { email: 0, sms: 0, push: 0, webhook: 0 };
	try {
		const queueRows = await sql`SELECT channel, COUNT(*) as count FROM notification_delivery WHERE status = 'pending' GROUP BY channel`;
		for (const row of queueRows as any[]) {
			channelQueueSizes[row.channel] = Number(row.count);
		}
	} catch {}

	return {
		timestamps: [
			{ name: "notify_processing_duration_ms", help: "Time spent processing notifications", type: "gauge", value: now, labels: {} },
		],
		deliveries: [
			{ name: "notify_deliveries_total", help: "Total notifications delivered", type: "counter", value: totalDeliveries, labels: { channel: "all" } },
			{ name: "notify_deliveries_success", help: "Successful deliveries", type: "counter", value: successDeliveries, labels: { channel: "all" } },
			{ name: "notify_deliveries_failed", help: "Failed deliveries", type: "counter", value: failedDeliveries, labels: { channel: "all" } },
			{ name: "notify_deliveries_retried", help: "Retry attempts", type: "counter", value: retriedDeliveries, labels: { channel: "all" } },
		],
		channels: [
			{ name: "notify_channel_queue_size", help: "Pending notifications per channel", type: "gauge", value: channelQueueSizes.email, labels: { channel: "email" } },
			{ name: "notify_channel_queue_size", help: "Pending notifications per channel", type: "gauge", value: channelQueueSizes.sms, labels: { channel: "sms" } },
			{ name: "notify_channel_queue_size", help: "Pending notifications per channel", type: "gauge", value: channelQueueSizes.push, labels: { channel: "push" } },
			{ name: "notify_channel_queue_size", help: "Pending notifications per channel", type: "gauge", value: channelQueueSizes.webhook, labels: { channel: "webhook" } },
		],
		latencies: [
			{ name: "notify_delivery_latency_ms", help: "Notification delivery latency", type: "histogram", value: 0, labels: { channel: "all" } },
		],
	};
}
