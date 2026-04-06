/**
 * Text embedding generation via OpenAI (or compatible) API.
 * Used by the LLM service to provide an embeddings endpoint.
 */

import type { Sql } from "postgres";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

export interface EmbeddingOptions {
  model?: string;
  dimensions?: number;
  user?: string;
}

function getApiKey(): string {
  return process.env["OPENAI_API_KEY"] ?? "";
}

/**
 * Generate text embeddings using OpenAI's embedding API.
 */
export async function generateEmbeddings(
  texts: string[],
  opts: EmbeddingOptions = {},
): Promise<EmbeddingResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  const dimensions = opts.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;

  // Use embeddings API
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model,
      dimensions,
      user: opts.user,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${err}`);
  }

  const data = await response.json() as {
    data: { embedding: number[] }[];
    usage: { prompt_tokens: number; total_tokens: number };
  };

  // Return first result
  return {
    embedding: data.data[0]?.embedding ?? [],
    model,
    usage: data.usage,
  };
}

/**
 * Generate a single embedding (convenience wrapper).
 */
export async function generateEmbedding(
  text: string,
  opts: EmbeddingOptions = {},
): Promise<number[]> {
  const result = await generateEmbeddings([text], opts);
  return result.embedding;
}

// Store embeddings in the llm service's DB for caching/retrieval
export interface StoredEmbedding {
  id: string;
  workspace_id: string;
  text_hash: string;
  text_snippet: string;
  embedding: number[];
  model: string;
  dimensions: number;
  created_at: Date;
}

export interface CacheEmbeddingInput {
  workspace_id: string;
  text: string;
  embedding: number[];
  model: string;
  dimensions: number;
}

/**
 * Cache an embedding for later retrieval.
 */
export async function cacheEmbedding(
  sql: Sql,
  input: CacheEmbeddingInput,
): Promise<StoredEmbedding> {
  const textHash = await hashText(input.text);
  const snippet = input.text.slice(0, 200);

  const [stored] = await sql<StoredEmbedding[]>`
    INSERT INTO llm.embeddings_cache
      (workspace_id, text_hash, text_snippet, embedding, model, dimensions)
    VALUES (
      ${input.workspace_id},
      ${textHash},
      ${snippet},
      ${input.embedding},
      ${input.model},
      ${input.dimensions}
    )
    ON CONFLICT (workspace_id, text_hash)
    DO UPDATE SET embedding = ${input.embedding}, created_at = NOW()
    RETURNING *
  `;
  return stored;
}

/**
 * Retrieve a cached embedding by text hash.
 */
export async function getCachedEmbedding(
  sql: Sql,
  workspaceId: string,
  text: string,
): Promise<StoredEmbedding | null> {
  const textHash = await hashText(text);
  const [row] = await sql<StoredEmbedding[]>`
    SELECT * FROM llm.embeddings_cache
    WHERE workspace_id = ${workspaceId} AND text_hash = ${textHash}
  `;
  return row ?? null;
}

// Simple hash using Web Crypto API
async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Delete old cached embeddings.
 */
export async function pruneEmbeddingCache(
  sql: Sql,
  workspaceId: string,
  olderThanDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await sql`
    DELETE FROM llm.embeddings_cache
    WHERE workspace_id = ${workspaceId} AND created_at < ${cutoff}
  `;
  return (result as any).count ?? 0;
}