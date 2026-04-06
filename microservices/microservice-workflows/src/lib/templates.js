/**
 * Workflow templates: reusable workflow definitions
 */

function generateId() {
  return `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Save a workflow definition as a reusable template
 */
export async function createTemplate(sql, params) {
  const { workspaceId, name, description = "", definition } = params;
  const id = generateId();
  const now = new Date().toISOString();

  const template = {
    id,
    workspace_id: workspaceId,
    name,
    description,
    definition,
    created_at: now,
    updated_at: now,
  };

  await sql`INSERT INTO workflow_templates ${sql(template)}`.catch(() => {
    // Table may not exist yet
  });

  return { id, ...template };
}

/**
 * List workflow templates for a workspace
 */
export async function listTemplates(sql, workspaceId) {
  return sql`SELECT id, name, description, created_at, updated_at
    FROM workflow_templates
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC`.catch(() => []);
}

/**
 * Create a new workflow from a template
 */
export async function instantiateTemplate(sql, params) {
  const { templateId, workspaceId, name } = params;

  const templates = await sql`SELECT * FROM workflow_templates WHERE id = ${templateId}`.catch(() => []);
  if (templates.length === 0) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const template = templates[0];
  const { createWorkflow } = await import("./definitions.js");
  const { getDb } = await import("../db/client.js");
  const db = sql || getDb();

  return createWorkflow(db, {
    workspaceId,
    name: name || template.name,
    description: template.description,
    definition: template.definition,
  });
}
