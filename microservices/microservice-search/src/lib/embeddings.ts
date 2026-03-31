/**
 * Generate embeddings via OpenAI text-embedding-3-small.
 * Returns null if OPENAI_API_KEY is not set or the request fails.
 */

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}
