/**
 * JWT utilities using Web Crypto (built into Bun/Node 18+).
 */

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  iat: number;
  exp: number;
  type: "access" | "refresh";
}

function getSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return secret;
}

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function base64url(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64url");
}

function decodeBase64url(str: string): string {
  return Buffer.from(str, "base64url").toString("utf8");
}

export async function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  expiresInSeconds: number = 900
): Promise<string> {
  const key = await importKey(getSecret());
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const msg = `${header}.${body}`;

  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return `${msg}.${base64url(sig)}`;
}

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const [header, body, sigStr] = parts;
  const key = await importKey(getSecret());
  const msg = `${header}.${body}`;

  const sig = Buffer.from(sigStr, "base64url");
  const valid = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(msg));
  if (!valid) throw new Error("Invalid JWT signature");

  const payload = JSON.parse(decodeBase64url(body)) as JwtPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("JWT expired");

  return payload;
}

export function generateAccessToken(userId: string, email: string): Promise<string> {
  return signJwt({ sub: userId, email, type: "access" }, 15 * 60); // 15 min
}

export function generateRefreshToken(userId: string, email: string): Promise<string> {
  return signJwt({ sub: userId, email, type: "refresh" }, 30 * 24 * 60 * 60); // 30 days
}
