import { beforeAll, describe, expect, it } from "bun:test";
import {
  generateAccessToken,
  generateRefreshToken,
  signJwt,
  verifyJwt,
} from "./jwt.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long!!";
});

describe("jwt", () => {
  it("signs and verifies a token", async () => {
    const token = await signJwt(
      { sub: "user-1", email: "a@b.com", type: "access" },
      60,
    );
    const payload = await verifyJwt(token);
    expect(payload.sub).toBe("user-1");
    expect(payload.email).toBe("a@b.com");
    expect(payload.type).toBe("access");
  });

  it("rejects an expired token", async () => {
    const token = await signJwt(
      { sub: "u", email: "e@e.com", type: "access" },
      -1,
    );
    expect(verifyJwt(token)).rejects.toThrow("expired");
  });

  it("rejects a tampered token", async () => {
    const token = await signJwt(
      { sub: "u", email: "e@e.com", type: "access" },
      60,
    );
    const tampered = `${token.slice(0, -5)}XXXXX`;
    expect(verifyJwt(tampered)).rejects.toThrow();
  });

  it("generates access token (15 min expiry)", async () => {
    const token = await generateAccessToken("user-1", "a@b.com");
    const p = await verifyJwt(token);
    expect(p.type).toBe("access");
    expect(p.exp - p.iat).toBe(900);
  });

  it("generates refresh token (30 day expiry)", async () => {
    const token = await generateRefreshToken("user-1", "a@b.com");
    const p = await verifyJwt(token);
    expect(p.type).toBe("refresh");
    expect(p.exp - p.iat).toBe(30 * 24 * 60 * 60);
  });
});
