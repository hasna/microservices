import { describe, it, expect } from "bun:test";
import { calculateCost, COST_PER_1K_TOKENS } from "./costs.js";
import { getProvider } from "./providers.js";

describe("calculateCost", () => {
  it("returns 0 for zero tokens", () => {
    expect(calculateCost("gpt-4o", 0, 0)).toBe(0);
  });

  it("calculates correct cost for gpt-4o", () => {
    // 1000 input @ $0.005/1K + 1000 output @ $0.015/1K = $0.02
    const cost = calculateCost("gpt-4o", 1000, 1000);
    expect(cost).toBeCloseTo(0.02, 5);
  });

  it("calculates correct cost for gpt-4o-mini", () => {
    // 1000 input @ $0.00015/1K + 1000 output @ $0.0006/1K = $0.00075
    const cost = calculateCost("gpt-4o-mini", 1000, 1000);
    expect(cost).toBeCloseTo(0.00075, 6);
  });

  it("calculates correct cost for claude-3-haiku", () => {
    // 1000 input @ $0.00025/1K + 1000 output @ $0.00125/1K = $0.0015
    const cost = calculateCost("claude-3-haiku", 1000, 1000);
    expect(cost).toBeCloseTo(0.0015, 6);
  });

  it("uses default rates for unknown model", () => {
    // default: input=0.001, output=0.002
    // 1000 input + 1000 output = $0.003
    const cost = calculateCost("some-unknown-model-xyz", 1000, 1000);
    expect(cost).toBeCloseTo(0.003, 6);
  });

  it("calculates correct cost for llama-3.1-70b-versatile", () => {
    // 1000 input @ $0.00059/1K + 1000 output @ $0.00079/1K = $0.00138
    const cost = calculateCost("llama-3.1-70b-versatile", 1000, 1000);
    expect(cost).toBeCloseTo(0.00138, 6);
  });

  it("scales linearly with token count", () => {
    const cost1k = calculateCost("gpt-4o", 1000, 0);
    const cost2k = calculateCost("gpt-4o", 2000, 0);
    expect(cost2k).toBeCloseTo(cost1k * 2, 5);
  });
});

describe("getProvider", () => {
  it("routes gpt-4o to openai", () => {
    expect(getProvider("gpt-4o")).toBe("openai");
  });

  it("routes gpt-3.5-turbo to openai", () => {
    expect(getProvider("gpt-3.5-turbo")).toBe("openai");
  });

  it("routes claude-3-haiku to anthropic", () => {
    expect(getProvider("claude-3-haiku")).toBe("anthropic");
  });

  it("routes claude-3-5-sonnet to anthropic", () => {
    expect(getProvider("claude-3-5-sonnet-20241022")).toBe("anthropic");
  });

  it("routes llama-3.1-70b-versatile to groq", () => {
    expect(getProvider("llama-3.1-70b-versatile")).toBe("groq");
  });

  it("routes mixtral model to groq", () => {
    expect(getProvider("mixtral-8x7b-32768")).toBe("groq");
  });

  it("routes gemma model to groq", () => {
    expect(getProvider("gemma-7b-it")).toBe("groq");
  });

  it("returns first available provider for unknown model when config provided", () => {
    const provider = getProvider("some-unknown-model", { openai: "sk-test", anthropic: undefined, groq: undefined });
    expect(provider).toBe("openai");
  });

  it("throws when config has no providers for unknown model", () => {
    expect(() => getProvider("unknown-model", {})).toThrow();
  });

  it("defaults to openai for unknown model without config", () => {
    expect(getProvider("some-future-model")).toBe("openai");
  });
});

describe("COST_PER_1K_TOKENS", () => {
  it("has a default entry", () => {
    expect(COST_PER_1K_TOKENS["default"]).toBeDefined();
    expect(COST_PER_1K_TOKENS["default"]!.input).toBeGreaterThan(0);
    expect(COST_PER_1K_TOKENS["default"]!.output).toBeGreaterThan(0);
  });

  it("output cost is higher than input for gpt-4o", () => {
    const rates = COST_PER_1K_TOKENS["gpt-4o"]!;
    expect(rates.output).toBeGreaterThan(rates.input);
  });
});
