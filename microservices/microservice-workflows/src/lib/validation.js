/**
 * Validate a workflow definition DAG
 * Checks: cycles, missing node refs, duplicate IDs, root nodes
 */
export function validateWorkflowDefinition(definition) {
  const errors = [];
  const warnings = [];
  const { nodes = [], edges = [] } = definition;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeMap = new Map();

  // Check for duplicate node IDs
  const seenIds = new Set();
  for (const node of nodes) {
    if (seenIds.has(node.id)) {
      errors.push(`Duplicate node ID: ${node.id}`);
    }
    seenIds.add(node.id);
  }

  // Check edges reference valid nodes
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge references unknown source node: ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge references unknown target node: ${edge.target}`);
    }
    if (!edgeMap.has(edge.source)) {
      edgeMap.set(edge.source, []);
    }
    edgeMap.get(edge.source).push(edge.target);
  }

  // Check for cycles using DFS
  const visited = new Set();
  const recStack = new Set();

  function hasCycle(nodeId, path = []) {
    if (recStack.has(nodeId)) {
      errors.push(`Cycle detected involving node: ${nodeId}, path: ${[...path, nodeId].join(" -> ")}`);
      return true;
    }
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    recStack.add(nodeId);

    const children = edgeMap.get(nodeId) || [];
    for (const child of children) {
      hasCycle(child, [...path, nodeId]);
    }

    recStack.delete(nodeId);
    return false;
  }

  // Start cycle detection from all nodes
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      hasCycle(node.id);
    }
  }

  // Check for unreachable nodes (warning)
  const reachable = new Set();
  function markReachable(id) {
    if (reachable.has(id)) return;
    reachable.add(id);
    const children = edgeMap.get(id) || [];
    for (const child of children) markReachable(child);
  }

  // Find root nodes (no incoming edges)
  const hasIncoming = new Set(edges.map((e) => e.target));
  const roots = nodes.filter((n) => !hasIncoming.has(n.id));
  for (const root of roots) markReachable(root.id);

  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      warnings.push(`Unreachable node: ${node.id}`);
    }
  }

  // Check for nodes with no outgoing edges (leaf nodes - OK, just informational)
  const hasOutgoing = new Set(edges.map((e) => e.source));
  const leafNodes = nodes.filter((n) => !hasOutgoing.has(n.id));
  void leafNodes;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      total_nodes: nodes.length,
      total_edges: edges.length,
      root_nodes: roots.length,
      leaf_nodes: leafNodes.length,
      unreachable_count: warnings.length,
    },
  };
}
