/**
 * Opaque token generation (sessions, magic links, API keys).
 */

export function generateToken(byteLength: number = 32): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export function generateApiKey(): { key: string; prefix: string; hash: Promise<string> } {
  const raw = `hsk_${crypto.randomUUID().replace(/-/g, "")}`;
  const prefix = raw.slice(0, 12);
  return {
    key: raw,
    prefix,
    hash: hashToken(raw),
  };
}

export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(buf).toString("hex");
}
