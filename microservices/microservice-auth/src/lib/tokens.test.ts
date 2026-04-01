import { describe, expect, it } from "bun:test";
import { generateApiKey, generateToken, hashToken } from "./tokens.js";

describe("tokens", () => {
  it("generates unique tokens", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThan(32);
  });

  it("generates api key with prefix and hash", async () => {
    const { key, prefix, hash } = generateApiKey();
    expect(key.startsWith("hsk_")).toBe(true);
    expect(prefix.startsWith("hsk_")).toBe(true);
    const h = await hash;
    expect(h).toHaveLength(64); // SHA-256 hex
  });

  it("hash is deterministic", async () => {
    const h1 = await hashToken("same-token");
    const h2 = await hashToken("same-token");
    expect(h1).toBe(h2);
  });

  it("different inputs produce different hashes", async () => {
    const h1 = await hashToken("token-a");
    const h2 = await hashToken("token-b");
    expect(h1).not.toBe(h2);
  });
});
