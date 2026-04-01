import { describe, expect, it } from "bun:test";

// Test the pure evaluation logic without DB
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++)
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function evaluateRule(
  rule: { type: string; config: any },
  ctx: { userId?: string; attributes?: any },
): boolean {
  switch (rule.type) {
    case "user_list":
      return ctx.userId
        ? ((rule.config.users as string[]) ?? []).includes(ctx.userId)
        : false;
    case "percentage": {
      const pct = (rule.config.percentage as number) ?? 0;
      if (!ctx.userId) return false;
      return simpleHash(ctx.userId) % 100 < pct;
    }
    case "attribute": {
      const attr = rule.config.attribute as string;
      const op = rule.config.operator as string;
      const expected = rule.config.value;
      const actual = ctx.attributes?.[attr];
      if (actual === undefined) return false;
      if (op === "eq") return String(actual) === String(expected);
      if (op === "contains") return String(actual).includes(String(expected));
      return false;
    }
    default:
      return false;
  }
}

describe("flag evaluation - user_list rule", () => {
  it("matches listed user", () => {
    expect(
      evaluateRule(
        { type: "user_list", config: { users: ["u1", "u2"] } },
        { userId: "u1" },
      ),
    ).toBe(true);
  });
  it("does not match unlisted user", () => {
    expect(
      evaluateRule(
        { type: "user_list", config: { users: ["u1"] } },
        { userId: "u2" },
      ),
    ).toBe(false);
  });
  it("returns false with no userId", () => {
    expect(
      evaluateRule({ type: "user_list", config: { users: ["u1"] } }, {}),
    ).toBe(false);
  });
});

describe("flag evaluation - percentage rule", () => {
  it("is deterministic for same userId", () => {
    const r1 = evaluateRule(
      { type: "percentage", config: { percentage: 50 } },
      { userId: "user-abc" },
    );
    const r2 = evaluateRule(
      { type: "percentage", config: { percentage: 50 } },
      { userId: "user-abc" },
    );
    expect(r1).toBe(r2);
  });
  it("100% includes all users", () => {
    const users = ["u1", "u2", "u3", "u4", "u5"];
    const results = users.map((u) =>
      evaluateRule(
        { type: "percentage", config: { percentage: 100 } },
        { userId: u },
      ),
    );
    expect(results.every(Boolean)).toBe(true);
  });
  it("0% excludes all users", () => {
    const users = ["u1", "u2", "u3"];
    const results = users.map((u) =>
      evaluateRule(
        { type: "percentage", config: { percentage: 0 } },
        { userId: u },
      ),
    );
    expect(results.every((r) => !r)).toBe(true);
  });
});

describe("flag evaluation - attribute rule", () => {
  it("matches eq operator", () => {
    expect(
      evaluateRule(
        {
          type: "attribute",
          config: { attribute: "plan", operator: "eq", value: "pro" },
        },
        { attributes: { plan: "pro" } },
      ),
    ).toBe(true);
  });
  it("does not match wrong value", () => {
    expect(
      evaluateRule(
        {
          type: "attribute",
          config: { attribute: "plan", operator: "eq", value: "pro" },
        },
        { attributes: { plan: "free" } },
      ),
    ).toBe(false);
  });
  it("contains operator works", () => {
    expect(
      evaluateRule(
        {
          type: "attribute",
          config: {
            attribute: "email",
            operator: "contains",
            value: "@example.com",
          },
        },
        { attributes: { email: "user@example.com" } },
      ),
    ).toBe(true);
  });
});

describe("simpleHash", () => {
  it("is deterministic", () => {
    expect(simpleHash("test")).toBe(simpleHash("test"));
  });
  it("produces different values for different inputs", () => {
    expect(simpleHash("a")).not.toBe(simpleHash("b"));
  });
});
