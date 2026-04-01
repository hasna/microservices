import { describe, expect, it } from "bun:test";

// Unit tests for routing, capability matching, health, and task logic
// These test the pure logic without requiring a database connection

describe("findAgentByCapability — preference logic", () => {
  const agents = [
    {
      id: "a1",
      status: "active",
      capabilities: ["code", "search"],
      current_load: 2,
      max_concurrent: 3,
    },
    {
      id: "a2",
      status: "idle",
      capabilities: ["code", "deploy"],
      current_load: 0,
      max_concurrent: 2,
    },
    {
      id: "a3",
      status: "active",
      capabilities: ["search"],
      current_load: 1,
      max_concurrent: 1,
    },
    {
      id: "a4",
      status: "stopped",
      capabilities: ["code"],
      current_load: 0,
      max_concurrent: 1,
    },
  ];

  function findByCapability(capability: string, preferIdle = false) {
    const available = agents.filter(
      (a) =>
        a.capabilities.includes(capability) &&
        ["active", "idle"].includes(a.status) &&
        a.current_load < a.max_concurrent,
    );
    if (available.length === 0) return null;
    if (preferIdle) {
      available.sort((a, b) => {
        const statusOrder = (s: string) => (s === "idle" ? 0 : 1);
        return (
          statusOrder(a.status) - statusOrder(b.status) ||
          a.current_load - b.current_load
        );
      });
    } else {
      available.sort((a, b) => {
        const statusOrder = (s: string) => (s === "active" ? 0 : 1);
        return (
          statusOrder(a.status) - statusOrder(b.status) ||
          a.current_load - b.current_load
        );
      });
    }
    return available[0];
  }

  it("prefers active agent over idle by default", () => {
    const result = findByCapability("code");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("a1"); // active agent preferred
  });

  it("prefers idle agent when preferIdle is true", () => {
    const result = findByCapability("code", true);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("a2"); // idle agent preferred
  });

  it("returns null when no agent matches capability", () => {
    const result = findByCapability("nonexistent");
    expect(result).toBeNull();
  });

  it("capabilities matching: agent with multiple capabilities matches single capability", () => {
    const result = findByCapability("search");
    expect(result).not.toBeNull();
    // a1 has ['code','search'] and is active with load < max
    expect(result?.id).toBe("a1");
    expect(result?.capabilities).toContain("search");
  });

  it("agent at max_concurrent is not selected", () => {
    // a3 has search capability but current_load (1) >= max_concurrent (1)
    const searchAgents = agents.filter(
      (a) =>
        a.capabilities.includes("search") &&
        ["active", "idle"].includes(a.status),
    );
    expect(searchAgents).toHaveLength(2); // a1 and a3
    const available = searchAgents.filter(
      (a) => a.current_load < a.max_concurrent,
    );
    expect(available).toHaveLength(1); // only a1
    expect(available[0].id).toBe("a1");
  });
});

describe("stale agent threshold logic", () => {
  it("agent without heartbeat for 10 min is stale (threshold=5)", () => {
    const threshold = 5;
    const now = Date.now();
    const lastHeartbeat = new Date(now - 10 * 60 * 1000); // 10 minutes ago
    const cutoff = new Date(now - threshold * 60 * 1000);
    expect(lastHeartbeat < cutoff).toBe(true);
  });

  it("agent with recent heartbeat is NOT stale (threshold=5)", () => {
    const threshold = 5;
    const now = Date.now();
    const lastHeartbeat = new Date(now - 2 * 60 * 1000); // 2 minutes ago
    const cutoff = new Date(now - threshold * 60 * 1000);
    expect(lastHeartbeat < cutoff).toBe(false);
  });

  it("agent exactly at threshold boundary is NOT stale", () => {
    const threshold = 5;
    const now = Date.now();
    const lastHeartbeat = new Date(now - threshold * 60 * 1000); // exactly 5 minutes ago
    const cutoff = new Date(now - threshold * 60 * 1000);
    // Equal to cutoff is NOT strictly less than, so not stale
    expect(lastHeartbeat < cutoff).toBe(false);
  });
});

describe("task priority: higher priority tasks claimed first", () => {
  it("sorts tasks by priority descending", () => {
    const tasks = [
      { id: "t1", priority: 0, created_at: "2024-01-01T00:00:00Z" },
      { id: "t2", priority: 10, created_at: "2024-01-01T00:01:00Z" },
      { id: "t3", priority: 5, created_at: "2024-01-01T00:02:00Z" },
    ];
    const sorted = [...tasks].sort(
      (a, b) =>
        b.priority - a.priority ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    expect(sorted[0].id).toBe("t2"); // priority 10
    expect(sorted[1].id).toBe("t3"); // priority 5
    expect(sorted[2].id).toBe("t1"); // priority 0
  });
});

describe("SKIP LOCKED prevents double-claim (logic)", () => {
  it("concurrent claims should not produce duplicates", () => {
    // Simulate SKIP LOCKED behavior: once a task is locked by one claimer, the next skips it
    const tasks = [
      { id: "t1", status: "pending", locked: false },
      { id: "t2", status: "pending", locked: false },
    ];
    function claimNext(): string | null {
      const available = tasks.find((t) => t.status === "pending" && !t.locked);
      if (!available) return null;
      available.locked = true;
      available.status = "running";
      return available.id;
    }
    const claim1 = claimNext();
    const claim2 = claimNext();
    expect(claim1).toBe("t1");
    expect(claim2).toBe("t2");
    expect(claim1).not.toBe(claim2); // No double-claim

    // Third claim returns null — all tasks taken
    const claim3 = claimNext();
    expect(claim3).toBeNull();
  });
});

describe("health report counts are correct", () => {
  it("correctly counts agents by status", () => {
    const agents = [
      { status: "active" },
      { status: "active" },
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
      { status: "stopped" },
      { status: "error" },
      { status: "error" },
    ];
    const report = {
      total: agents.length,
      active: agents.filter((a) => a.status === "active").length,
      idle: agents.filter((a) => a.status === "idle").length,
      stopped: agents.filter((a) => a.status === "stopped").length,
      error: agents.filter((a) => a.status === "error").length,
      stale_threshold_minutes: 5,
    };
    expect(report.total).toBe(8);
    expect(report.active).toBe(2);
    expect(report.idle).toBe(3);
    expect(report.stopped).toBe(1);
    expect(report.error).toBe(2);
    expect(report.active + report.idle + report.stopped + report.error).toBe(
      report.total,
    );
  });
});
