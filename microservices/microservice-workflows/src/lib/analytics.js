/**
 * Workflow analytics: step stats, node timing, failure rates
 */

/**
 * Get execution step statistics for a workflow
 */
export async function getStepStats(sql, workflowId, nodeId) {
  let query = `
    SELECT
      COUNT(*) as total_executions,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
      COUNT(CASE WHEN status = 'paused' THEN 1 END) as paused,
      MIN(started_at) as first_run,
      MAX(started_at) as last_run
    FROM workflow_executions
    WHERE workflow_id = ?
  `;
  const params = [workflowId];

  if (nodeId) {
    query = `
      SELECT
        COUNT(*) as total_steps,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        AVG(elapsed_ms) as avg_elapsed_ms
      FROM execution_steps
      WHERE execution_id IN (SELECT id FROM workflow_executions WHERE workflow_id = ?)
        AND node_id = ?
    `;
    return sql`${sql.unsafe(query)}`.catch(() => ({
      total_steps: 0, completed: 0, failed: 0, avg_elapsed_ms: null
    }));
  }

  return sql`${sql.unsafe(query)}`.catch(() => ({
    total_executions: 0, completed: 0, failed: 0, running: 0, paused: 0,
    first_run: null, last_run: null
  }));
}

/**
 * Get timing statistics per node
 */
export async function getNodeTiming(sql, workflowId) {
  const query = `
    SELECT
      es.node_id,
      COUNT(*) as invocations,
      AVG(es.elapsed_ms) as avg_duration_ms,
      MIN(es.elapsed_ms) as min_duration_ms,
      MAX(es.elapsed_ms) as max_duration_ms,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY es.elapsed_ms) as p50_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY es.elapsed_ms) as p95_ms
    FROM execution_steps es
    JOIN workflow_executions we ON es.execution_id = we.id
    WHERE we.workflow_id = ?
      AND es.status = 'completed'
    GROUP BY es.node_id
  `;
  return sql`${sql.unsafe(query)}`.catch(() => []);
}

/**
 * Get failure rate per node
 */
export async function getFailureRate(sql, workflowId) {
  const query = `
    SELECT
      es.node_id,
      COUNT(*) as total_invocations,
      COUNT(CASE WHEN es.status = 'failed' THEN 1 END) as failures,
      ROUND(
        COUNT(CASE WHEN es.status = 'failed' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0),
        2
      ) as failure_rate_pct,
      COUNT(CASE WHEN es.status = 'skipped' THEN 1 END) as skipped
    FROM execution_steps es
    JOIN workflow_executions we ON es.execution_id = we.id
    WHERE we.workflow_id = ?
    GROUP BY es.node_id
    ORDER BY failure_rate_pct DESC
  `;
  return sql`${sql.unsafe(query)}`.catch(() => []);
}
