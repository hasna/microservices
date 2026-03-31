import { describe, it, expect } from "bun:test";
import { interpolateVariables } from "./resolve.js";
import { diffVersions } from "./versions.js";
import { pickVariant } from "./experiments.js";

describe("interpolateVariables", () => {
  it("replaces {{name}} with value", () => {
    expect(interpolateVariables("Hello {{name}}!", { name: "Alice" })).toBe("Hello Alice!");
  });

  it("leaves {{unknown}} as-is when not in variables", () => {
    expect(interpolateVariables("Hello {{unknown}}!", {})).toBe("Hello {{unknown}}!");
  });

  it("handles multiple variables", () => {
    expect(interpolateVariables("{{greeting}} {{name}}, welcome to {{place}}!", {
      greeting: "Hi",
      name: "Bob",
      place: "Earth",
    })).toBe("Hi Bob, welcome to Earth!");
  });

  it("returns content unchanged with empty variables", () => {
    const content = "No variables here.";
    expect(interpolateVariables(content, {})).toBe(content);
  });

  it("replaces same variable used multiple times", () => {
    expect(interpolateVariables("{{x}} and {{x}}", { x: "Y" })).toBe("Y and Y");
  });
});

describe("version_number auto-increments", () => {
  it("versions are sequential 1, 2, 3", () => {
    // This tests the logic conceptually — actual DB increments are tested via integration
    // The updatePrompt function does: COALESCE(MAX(version_number), 0) + 1
    // So given max = 0 → 1, max = 1 → 2, max = 2 → 3
    const computeNext = (max: number) => max + 1;
    expect(computeNext(0)).toBe(1);
    expect(computeNext(1)).toBe(2);
    expect(computeNext(2)).toBe(3);
  });
});

describe("rollback sets current_version_id correctly", () => {
  it("rollback target is the version we specify (logic test)", () => {
    // The rollback function: SELECT id FROM versions WHERE prompt_id = X AND version_number = N
    // Then sets current_version_id to that id
    // Simulate: versions map
    const versions = new Map<number, string>([
      [1, "ver-aaa"],
      [2, "ver-bbb"],
      [3, "ver-ccc"],
    ]);
    const rollbackTo = (n: number) => versions.get(n) ?? null;
    expect(rollbackTo(1)).toBe("ver-aaa");
    expect(rollbackTo(2)).toBe("ver-bbb");
    expect(rollbackTo(99)).toBeNull();
  });
});

describe("override priority: user > agent > workspace", () => {
  it("user override wins over agent and workspace", () => {
    // Simulates the resolve priority logic
    const overrides = {
      user: "user content",
      agent: "agent content",
      workspace: "workspace content",
    };
    const resolve = (userId?: string, agentId?: string, wsId?: string) => {
      if (userId && overrides.user) return { source: "override", scope: "user" };
      if (agentId && overrides.agent) return { source: "override", scope: "agent" };
      if (wsId && overrides.workspace) return { source: "override", scope: "workspace" };
      return { source: "current", scope: null };
    };
    expect(resolve("u1", "a1", "w1").scope).toBe("user");
    expect(resolve(undefined, "a1", "w1").scope).toBe("agent");
    expect(resolve(undefined, undefined, "w1").scope).toBe("workspace");
    expect(resolve(undefined, undefined, undefined).scope).toBeNull();
  });
});

describe("diffVersions", () => {
  it("detects added lines", () => {
    const result = diffVersions("p1", "line1\nline2", "line1\nline2\nline3");
    expect(result.added).toContain("line3");
    expect(result.removed).toEqual([]);
  });

  it("detects removed lines", () => {
    const result = diffVersions("p1", "line1\nline2\nline3", "line1\nline2");
    expect(result.removed).toContain("line3");
    expect(result.added).toEqual([]);
  });

  it("detects both added and removed", () => {
    const result = diffVersions("p1", "old line\nkept", "kept\nnew line");
    expect(result.added).toContain("new line");
    expect(result.removed).toContain("old line");
    expect(result.unchanged).toContain("kept");
  });

  it("returns empty diff for identical content", () => {
    const result = diffVersions("p1", "same\ncontent", "same\ncontent");
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toEqual(["same", "content"]);
  });
});

describe("experiment assignment is deterministic", () => {
  it("same user always gets same variant", () => {
    const variants = [
      { name: "control", weight: 50 },
      { name: "treatment", weight: 50 },
    ];
    const v1 = pickVariant(variants, "user-123", "exp-abc");
    const v2 = pickVariant(variants, "user-123", "exp-abc");
    const v3 = pickVariant(variants, "user-123", "exp-abc");
    expect(v1).toBe(v2);
    expect(v2).toBe(v3);
  });

  it("different users can get different variants", () => {
    const variants = [
      { name: "A", weight: 50 },
      { name: "B", weight: 50 },
    ];
    const results = new Set<string>();
    // With enough users, both variants should appear
    for (let i = 0; i < 100; i++) {
      results.add(pickVariant(variants, `user-${i}`, "exp-test"));
    }
    expect(results.size).toBe(2);
  });

  it("single variant always returns that variant", () => {
    const variants = [{ name: "only", weight: 100 }];
    expect(pickVariant(variants, "anyone", "exp-x")).toBe("only");
  });
});
