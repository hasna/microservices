import { describe, it, expect } from "bun:test";
import { renderTemplate } from "./templates.js";

describe("renderTemplate", () => {
  it("substitutes a single variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "Alice" })).toBe("Hello Alice!");
  });

  it("substitutes multiple variables", () => {
    const result = renderTemplate("Dear {{first}} {{last}}, your code is {{code}}.", {
      first: "John",
      last: "Doe",
      code: "ABC123",
    });
    expect(result).toBe("Dear John Doe, your code is ABC123.");
  });

  it("leaves missing variables as-is", () => {
    const result = renderTemplate("Hello {{name}}, your order {{order_id}} is ready.", { name: "Bob" });
    expect(result).toBe("Hello Bob, your order {{order_id}} is ready.");
  });

  it("handles empty variables map", () => {
    const result = renderTemplate("Hello {{name}}!", {});
    expect(result).toBe("Hello {{name}}!");
  });

  it("returns template unchanged when no placeholders present", () => {
    const plain = "Hello World, no placeholders here.";
    expect(renderTemplate(plain, { name: "ignored" })).toBe(plain);
  });

  it("handles empty template string", () => {
    expect(renderTemplate("", { name: "Alice" })).toBe("");
  });

  it("substitutes the same variable used multiple times", () => {
    const result = renderTemplate("{{greeting}} {{name}}, {{greeting}} again {{name}}!", {
      greeting: "Hi",
      name: "Carol",
    });
    expect(result).toBe("Hi Carol, Hi again Carol!");
  });
});
