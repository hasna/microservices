import type { Sql } from "bun.js";

export interface NotificationTemplate {
	id?: number;
	workspaceId: string;
	name: string;
	channel: string;
	subject?: string;
	body: string;
	version: number;
	active: boolean;
	variables?: string[];
	createdAt?: Date;
	updatedAt?: Date;
}

export interface TemplateRenderResult {
	subject?: string;
	body: string;
	missingVariables?: string[];
}

export interface TemplateAnalytics {
	templateId: number;
	rendered: number;
	delivered: number;
	opened: number;
	clicked: number;
	conversionRate: number;
}

export async function createTemplateV2(
	sql: Sql,
	template: Omit<NotificationTemplate, "id" | "version" | "createdAt" | "updatedAt">
): Promise<number> {
	const existing = await sql`SELECT id FROM notification_templates WHERE workspace_id = ${template.workspaceId} AND name = ${template.name} AND channel = ${template.channel}`;

	if ((existing as any[]).length > 0) {
		const existingId = (existing as any[])[0].id;
		await sql`UPDATE notification_templates SET active = false, updated_at = now() WHERE id = ${existingId}`;
	}

	const bodyVars = extractVariables(template.body);
	const subjectVars = template.subject ? extractVariables(template.subject) : [];
	const allVars = [...new Set([...bodyVars, ...subjectVars])];

	const result = await sql`INSERT INTO notification_templates (workspace_id, name, channel, subject, body, version, active, variables) VALUES (${template.workspaceId}, ${template.name}, ${template.channel}, ${template.subject ?? null}, ${template.body}, 1, true, ${JSON.stringify(allVars)}) RETURNING id`;

	return (result as any[])[0].id;
}

export async function getTemplateV2(
	sql: Sql,
	workspaceId: string,
	name: string,
	channel: string,
	version?: number
): Promise<NotificationTemplate | null> {
	let query;
	if (version !== undefined) {
		query = await sql`SELECT id, workspace_id, name, channel, subject, body, version, active, variables, created_at, updated_at FROM notification_templates WHERE workspace_id = ${workspaceId} AND name = ${name} AND channel = ${channel} AND version = ${version}`;
	} else {
		query = await sql`SELECT id, workspace_id, name, channel, subject, body, version, active, variables, created_at, updated_at FROM notification_templates WHERE workspace_id = ${workspaceId} AND name = ${name} AND channel = ${channel} AND active = true ORDER BY version DESC LIMIT 1`;
	}

	const rows = query as any[];
	if (rows.length === 0) return null;

	const row = rows[0];
	return {
		id: row.id,
		workspaceId: row.workspace_id,
		name: row.name,
		channel: row.channel,
		subject: row.subject,
		body: row.body,
		version: row.version,
		active: row.active,
		variables: row.variables ? JSON.parse(row.variables) : [],
		createdAt: row.created_at ? new Date(row.created_at) : undefined,
		updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
	};
}

export async function updateTemplateV2(
	sql: Sql,
	id: number,
	updates: Partial<Pick<NotificationTemplate, "subject" | "body">>
): Promise<void> {
	const existing = await sql`SELECT workspace_id, name, channel, version FROM notification_templates WHERE id = ${id}`;
	if ((existing as any[]).length === 0) return;

	const row = (existing as any[])[0];
	const newVersion = row.version + 1;

	const bodyVars = updates.body ? extractVariables(updates.body) : [];
	const subjectVars = updates.subject ? extractVariables(updates.subject) : [];
	const allVars = [...new Set([...bodyVars, ...subjectVars])];

	await sql`UPDATE notification_templates SET active = false, updated_at = now() WHERE id = ${id}`;

	await sql`INSERT INTO notification_templates (workspace_id, name, channel, subject, body, version, active, variables) VALUES (${row.workspace_id}, ${row.name}, ${row.channel}, ${updates.subject ?? null}, ${updates.body ?? ""}, ${newVersion}, true, ${JSON.stringify(allVars)})`;
}

export async function listTemplatesV2(
	sql: Sql,
	workspaceId: string,
	channel?: string
): Promise<NotificationTemplate[]> {
	let query;
	if (channel) {
		query = await sql`SELECT id, workspace_id, name, channel, subject, body, version, active, variables, created_at, updated_at FROM notification_templates WHERE workspace_id = ${workspaceId} AND channel = ${channel} ORDER BY name, version DESC`;
	} else {
		query = await sql`SELECT id, workspace_id, name, channel, subject, body, version, active, variables, created_at, updated_at FROM notification_templates WHERE workspace_id = ${workspaceId} ORDER BY name, channel, version DESC`;
	}

	return (query as any[]).map((row) => ({
		id: row.id,
		workspaceId: row.workspace_id,
		name: row.name,
		channel: row.channel,
		subject: row.subject,
		body: row.body,
		version: row.version,
		active: row.active,
		variables: row.variables ? JSON.parse(row.variables) : [],
		createdAt: row.created_at ? new Date(row.created_at) : undefined,
		updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
	}));
}

export async function renderTemplateV2(
	template: NotificationTemplate,
	variables: Record<string, string | number>
): Promise<TemplateRenderResult> {
	const missingVariables: string[] = [];
	const renderedBody = template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
		if (variables[key] === undefined) {
			missingVariables.push(key);
			return `{{${key}}}`;
		}
		return String(variables[key]);
	});

	let renderedSubject: string | undefined;
	if (template.subject) {
		renderedSubject = template.subject.replace(/\{\{(\w+)\}\}/g, (_, key) => {
			if (variables[key] === undefined) {
				missingVariables.push(key);
				return `{{${key}}}`;
			}
			return String(variables[key]);
		});
	}

	return {
		subject: renderedSubject,
		body: renderedBody,
		missingVariables: missingVariables.length > 0 ? missingVariables : undefined,
	};
}

export async function getTemplateAnalytics(
	sql: Sql,
	templateId: number,
	startDate?: Date,
	endDate?: Date
): Promise<TemplateAnalytics> {
	const analytics: TemplateAnalytics = {
		templateId,
		rendered: 0,
		delivered: 0,
		opened: 0,
		clicked: 0,
		conversionRate: 0,
	};

	try {
		let dateFilter = "";
		const params: any[] = [templateId];

		if (startDate && endDate) {
			dateFilter = " AND created_at BETWEEN $2 AND $3";
			params.push(startDate, endDate);
		}

		const renderedRows = await sql`SELECT COUNT(*) as count FROM notification_render_log WHERE template_id = ${templateId}${sql.unsafe(dateFilter)}`;
		if ((renderedRows as any[]).length > 0) {
			analytics.rendered = Number((renderedRows as any[])[0].count);
		}

		const deliveredRows = await sql`SELECT COUNT(*) as count FROM notification_delivery WHERE template_id = ${templateId} AND status = 'delivered'${sql.unsafe(dateFilter)}`;
		if ((deliveredRows as any[]).length > 0) {
			analytics.delivered = Number((deliveredRows as any[])[0].count);
		}

		const openedRows = await sql`SELECT COUNT(*) as count FROM notification_events WHERE template_id = ${templateId} AND event_type = 'opened'${sql.unsafe(dateFilter)}`;
		if ((openedRows as any[]).length > 0) {
			analytics.opened = Number((openedRows as any[])[0].count);
		}

		const clickedRows = await sql`SELECT COUNT(*) as count FROM notification_events WHERE template_id = ${templateId} AND event_type = 'clicked'${sql.unsafe(dateFilter)}`;
		if ((clickedRows as any[]).length > 0) {
			analytics.clicked = Number((clickedRows as any[])[0].count);
		}

		if (analytics.rendered > 0) {
			analytics.conversionRate = Math.round((analytics.delivered / analytics.rendered) * 10000) / 100;
		}
	} catch {}

	return analytics;
}

export async function archiveTemplate(sql: Sql, id: number): Promise<void> {
	await sql`UPDATE notification_templates SET active = false, updated_at = now() WHERE id = ${id}`;
}

function extractVariables(text: string): string[] {
	const matches = text.matchAll(/\{\{(\w+)\}\}/g);
	return [...new Set([...matches].map((m) => m[1]))];
}
