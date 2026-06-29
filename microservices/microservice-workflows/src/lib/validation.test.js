import { describe, expect, test } from "bun:test";
import { validateWorkflowDefinition } from "./validation.js";

describe("workflow validation", () => {
  test("accepts a simple acyclic workflow", () => {
    const result = validateWorkflowDefinition({
      nodes: [
        { id: "start", type: "trigger" },
        { id: "finish", type: "task" },
      ],
      edges: [{ source: "start", target: "finish" }],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.stats).toMatchObject({
      total_nodes: 2,
      total_edges: 1,
      root_nodes: 1,
      leaf_nodes: 1,
    });
  });

  test("reports duplicate nodes and invalid edge references", () => {
    const result = validateWorkflowDefinition({
      nodes: [{ id: "start" }, { id: "start" }],
      edges: [{ source: "start", target: "missing" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Duplicate node ID: start");
    expect(result.errors).toContain(
      "Edge references unknown target node: missing",
    );
  });
});
