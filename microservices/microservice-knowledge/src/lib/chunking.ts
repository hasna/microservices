/**
 * Text chunking strategies for document ingestion.
 */

export type ChunkingStrategy = "fixed" | "paragraph" | "sentence" | "recursive";

export interface ChunkOptions {
  strategy: ChunkingStrategy;
  chunkSize: number;
  chunkOverlap: number;
}

/**
 * Split text into chunks using the specified strategy.
 */
export function chunkText(text: string, opts: ChunkOptions): string[] {
  if (opts.chunkSize <= 0) throw new Error("chunkSize must be greater than 0");
  if (!text) return [];

  switch (opts.strategy) {
    case "fixed":
      return fixedChunk(text, opts.chunkSize, opts.chunkOverlap);
    case "paragraph":
      return paragraphChunk(text, opts.chunkSize, opts.chunkOverlap);
    case "sentence":
      return sentenceChunk(text, opts.chunkSize, opts.chunkOverlap);
    case "recursive":
      return recursiveChunk(text, opts.chunkSize, opts.chunkOverlap);
    default:
      return fixedChunk(text, opts.chunkSize, opts.chunkOverlap);
  }
}

/**
 * Fixed: split every chunkSize chars with overlap.
 */
function fixedChunk(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

/**
 * Paragraph: split on double newlines, merge small paragraphs to reach chunkSize.
 */
function paragraphChunk(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return [];

  const merged = mergeParts(paragraphs, chunkSize, "\n\n");
  if (merged.length <= 1) return merged;

  return applyOverlap(merged, overlap);
}

/**
 * Sentence: split on sentence boundaries (. ! ?), merge to chunkSize.
 */
function sentenceChunk(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end of string
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return [];

  const merged = mergeParts(sentences, chunkSize, " ");
  if (merged.length <= 1) return merged;

  return applyOverlap(merged, overlap);
}

/**
 * Recursive: try paragraph -> sentence -> fixed (fallback chain).
 */
function recursiveChunk(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  // Try paragraph splitting first
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length > 1) {
    const result = paragraphChunk(text, chunkSize, overlap);
    // Check if any chunk is too large; if so, split those with sentence strategy
    const final: string[] = [];
    for (const chunk of result) {
      if (chunk.length > chunkSize * 1.5) {
        final.push(...sentenceChunk(chunk, chunkSize, overlap));
      } else {
        final.push(chunk);
      }
    }
    return final;
  }

  // Try sentence splitting
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
  if (sentences.length > 1) {
    return sentenceChunk(text, chunkSize, overlap);
  }

  // Fall back to fixed
  return fixedChunk(text, chunkSize, overlap);
}

/**
 * Merge small parts until they reach chunkSize.
 */
function mergeParts(
  parts: string[],
  chunkSize: number,
  separator: string,
): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    const candidate = current ? current + separator + part : part;
    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Apply character-level overlap between consecutive chunks.
 */
function applyOverlap(chunks: string[], overlap: number): string[] {
  if (overlap <= 0 || chunks.length <= 1) return chunks;

  const result: string[] = [chunks[0]!];
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]!;
    const overlapText = prev.slice(-overlap);
    result.push(overlapText + chunks[i]!);
  }
  return result;
}

/**
 * Rough token count estimation (~4 chars per token for English).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
