/**
 * Embedding generation via OpenAI API.
 * Returns null if OPENAI_API_KEY is not set.
 */

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("OpenAI embeddings error:", res.status, err);
      return null;
    }

    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("Failed to generate embedding:", err);
    return null;
  }
}

export function hasEmbeddingKey(): boolean {
  return !!process.env["OPENAI_API_KEY"];
}
