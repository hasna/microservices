// Generate and verify single-use unsubscribe tokens
// Token format: base64url(userId:type:hmac)

export async function generateUnsubscribeToken(
  userId: string,
  type: string,
): Promise<string> {
  const secret = process.env.JWT_SECRET ?? "notify-unsubscribe-secret";
  const payload = `${userId}:${type}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const sigHex = Buffer.from(sig).toString("hex").slice(0, 16);
  return Buffer.from(`${payload}:${sigHex}`).toString("base64url");
}

export async function verifyUnsubscribeToken(
  token: string,
): Promise<{ userId: string; type: string } | null> {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;
    const [userId, type, sig] = parts;
    const expected = await generateUnsubscribeToken(userId, type);
    const expectedDecoded = Buffer.from(expected, "base64url").toString("utf8");
    const expectedSig = expectedDecoded.split(":")[2];
    if (sig !== expectedSig) return null;
    return { userId, type };
  } catch {
    return null;
  }
}
