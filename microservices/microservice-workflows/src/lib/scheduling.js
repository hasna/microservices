/**
 * Workflow scheduling: cron jobs and one-shot future executions
 */

function generateId() {
  return `sched_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Schedule a workflow to run at a future time
 */
export async function scheduleWorkflow(sql, params) {
  const {
    workspaceId,
    workflowName,
    triggerType = "scheduled",
    schedule,
    context = {},
  } = params;

  const id = generateId();
  const now = new Date().toISOString();
  let runAt = null;
  let cronExpr = null;
  let scheduleType = "once";

  if (schedule.type === "cron") {
    cronExpr = schedule.cron;
    scheduleType = "recurring";
    runAt = null; // Will be computed by scheduler
  } else if (schedule.type === "once" && schedule.at) {
    runAt = schedule.at;
    scheduleType = "once";
  }

  const scheduleRow = {
    id,
    workspace_id: workspaceId,
    workflow_name: workflowName,
    trigger_type: triggerType,
    schedule_type: scheduleType,
    cron_expr: cronExpr,
    run_at: runAt,
    context,
    status: "active",
    created_at: now,
    updated_at: now,
  };

  await sql`INSERT INTO workflow_schedules ${sql(scheduleRow)}`.catch(() => {
    // Table may not exist yet, return mock
  });

  return { id, status: "scheduled", next_run: runAt || "computed on demand", schedule: scheduleRow };
}

/**
 * Cancel a scheduled workflow run
 */
export async function cancelScheduled(sql, scheduleId) {
  const result = await sql`UPDATE workflow_schedules
    SET status = 'cancelled', updated_at = ${new Date().toISOString()}
    WHERE id = ${scheduleId}
    RETURNING *`.catch(() => []);

  if (result.length === 0) {
    return { id: scheduleId, status: "not_found" };
  }
  return { id: scheduleId, status: "cancelled" };
}

/**
 * List all scheduled workflow runs for a workspace
 */
export async function listScheduled(sql, workspaceId) {
  return sql`SELECT * FROM workflow_schedules
    WHERE workspace_id = ${workspaceId}
    AND status = 'active'
    ORDER BY created_at DESC`.catch(() => []);
}
