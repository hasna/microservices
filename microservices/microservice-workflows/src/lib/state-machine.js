/**
 * Workflow state machine: states and transitions inspection
 */

/**
 * Get the state machine definition for a workflow
 * Infers states from node types and edges represent transitions
 */
export async function getStateMachine(sql, workflowId) {
  const workflows = await sql`SELECT * FROM workflow_definitions WHERE id = ${workflowId}`.catch(() => []);

  if (workflows.length === 0) {
    // Try versions table
    const versions = await sql`SELECT * FROM workflow_versions WHERE workflow_id = ${workflowId}`.catch(() => []);
    if (versions.length === 0) {
      return { workflow_id: workflowId, error: "not_found" };
    }
    const latest = versions.sort((a, b) => b.version - a.version)[0];
    return extractStateMachine(workflowId, latest.definition);
  }

  return extractStateMachine(workflowId, workflows[0].definition);
}

function extractStateMachine(workflowId, definition) {
  const { nodes = [], edges = [] } = definition || {};

  // Extract states from nodes
  const states = nodes.map((n) => ({
    id: n.id,
    name: n.type || n.id,
    metadata: n.metadata || {},
  }));

  // Extract transitions from edges
  const transitions = edges.map((e) => ({
    from: e.source,
    to: e.target,
    condition: e.condition || null,
  }));

  // Infer initial and final states
  const hasIncoming = new Set(edges.map((e) => e.target));
  const hasOutgoing = new Set(edges.map((e) => e.source));

  const initialStates = nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id);
  const finalStates = nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id);

  return {
    workflow_id: workflowId,
    states,
    transitions,
    initial_states: initialStates,
    final_states: finalStates,
  };
}

/**
 * Validate if a state transition is allowed
 */
export async function validateTransition(sql, executionId, targetState) {
  const executions = await sql`SELECT * FROM workflow_executions WHERE id = ${executionId}`.catch(() => []);

  if (executions.length === 0) {
    return { valid: false, reason: "execution_not_found" };
  }

  const exec = executions[0];
  const workflowId = exec.workflow_id;

  // Get the state machine
  const sm = await getStateMachine(sql, workflowId);
  if (sm.error) {
    return { valid: false, reason: sm.error };
  }

  // Check if target state exists
  const stateExists = sm.states.some((s) => s.id === targetState);
  if (!stateExists) {
    return { valid: false, reason: "state_not_found", target_state: targetState };
  }

  // Get current execution state (from steps)
  const steps = await sql`SELECT * FROM execution_steps
    WHERE execution_id = ${executionId}
    ORDER BY started_at DESC LIMIT 1`.catch(() => []);

  const currentState = steps.length > 0 ? steps[0].node_id : sm.initial_states[0];

  // Check if transition exists
  const transitionExists = sm.transitions.some(
    (t) => t.from === currentState && t.to === targetState,
  );

  if (!transitionExists) {
    return {
      valid: false,
      reason: "transition_not_allowed",
      current_state: currentState,
      target_state: targetState,
      available_transitions: sm.transitions.filter((t) => t.from === currentState),
    };
  }

  return {
    valid: true,
    current_state: currentState,
    target_state: targetState,
  };
}
