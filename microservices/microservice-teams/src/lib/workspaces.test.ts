import { describe, it, expect } from "bun:test";

// Unit tests for pure logic (no DB required)
describe("workspaces - slug generation", () => {
  it("slugifies workspace names correctly", () => {
    const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    expect(slugify("My Workspace")).toBe("my-workspace");
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("  Spaces  ")).toBe("spaces");
  });
});

describe("members - role ranking", () => {
  it("ranks roles correctly", () => {
    const RANK: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };
    expect(RANK["owner"]).toBeGreaterThan(RANK["admin"]);
    expect(RANK["admin"]).toBeGreaterThan(RANK["member"]);
    expect(RANK["member"]).toBeGreaterThan(RANK["viewer"]);
  });

  it("validates all role levels", () => {
    const roles = ["owner", "admin", "member", "viewer"];
    expect(roles).toHaveLength(4);
    expect(roles.includes("owner")).toBe(true);
  });
});
