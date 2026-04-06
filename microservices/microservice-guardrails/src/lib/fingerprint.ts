/**
 * Content fingerprinting — simhash-based near-duplicate detection.
 * Useful for detecting repeated malicious prompt injection attempts,
 * policy violations with minor variations, and copy-paste abuse.
 */

import { createHash } from "node:crypto";
import type { Sql } from "postgres";

/**
 * Compute a 64-bit Simhash fingerprint for a text.
 *
 * Simhash works by:
 * 1. Tokenize into features (words, n-grams)
 * 2. Hash each feature
 * 3. Accumulate into a bit vector (add for 1-bit, subtract for 0-bit)
 * 4. Return the final hash as hex string
 *
 * Two similar texts will have similar hashes (Hamming distance ~few bits).
 */
export function computeSimhash(text: string, nGramSize = 2): string {
  const tokens = tokenize(text, nGramSize);
  const v = new Int32Array(64);

  for (const token of tokens) {
    const hash = hashFeature(token);
    for (let i = 0; i < 64; i++) {
      const bit = (hash >>> i) & 1;
      v[i] += bit === 1 ? 1 : -1;
    }
  }

  let fingerprint = 0n;
  for (let i = 0; i < 64; i++) {
    if (v[i] > 0) {
      fingerprint |= 1n << BigInt(i);
    }
  }

  return fingerprint.toString(16).padStart(16, "0");
}

/**
 * Compute Hamming distance between two simhash fingerprints.
 */
export function hammingDistance(hashA: string, hashB: string): number {
  const a = BigInt("0x" + hashA);
  const b = BigInt("0x" + hashB);
  let xor = a ^ b;
  let distance = 0;
  while (xor !== 0n) {
    xor &= xor - 1n;
    distance++;
  }
  return distance;
}

/**
 * Check if two fingerprints are near-duplicates (within threshold bits).
 * Default threshold of 3 means Hamming distance ≤ 3 is considered a match.
 * At 3 bits, probability of false positive is ~0.05 for random hashes.
 */
export function isNearDuplicate(
  hashA: string,
  hashB: string,
  threshold = 3,
): boolean {
  return hammingDistance(hashA, hashB) <= threshold;
}

/**
 * Given a query hash and a set of known hashes, find all near-duplicates.
 */
export function findNearDuplicates(
  queryHash: string,
  knownHashes: Array<{ id: string; fingerprint: string }>,
  threshold = 3,
): Array<{ id: string; hammingDistance: number }> {
  return knownHashes
    .map(({ id, fingerprint }) => ({
      id,
      hammingDistance: hammingDistance(queryHash, fingerprint),
    }))
    .filter(({ hammingDistance }) => hammingDistance <= threshold)
    .sort((a, b) => a.hammingDistance - b.hammingDistance);
}

/**
 * Simple SHA-256 based hash of a feature token (used as input to simhash).
 */
function hashFeature(token: string): number {
  const hash = createHash("sha256").update(token.toLowerCase()).digest();
  // Use first 8 bytes as a 64-bit integer
  return parseInt(hash.slice(0, 8).toString("hex"), 16);
}

/**
 * Tokenize text into n-grams of word tokens.
 */
function tokenize(text: string, nGramSize: number): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const ngrams: string[] = [];
  for (let i = 0; i <= normalized.length - nGramSize; i++) {
    ngrams.push(normalized.slice(i, i + nGramSize).join(" "));
  }

  return ngrams;
}

/**
 * Compute a perceptual hash (average hash) for short text/variant detection.
 * More suitable for short strings than simhash.
 */
export function computeAverageHash(text: string): string {
  const hash = createHash("sha256").update(text.toLowerCase()).digest();
  const bytes = Array.from(hash);

  // Average of all bytes
  const avg = bytes.reduce((a, b) => a + b, 0) / bytes.length;

  // Build hash: 1 if byte >= average, 0 otherwise
  let result = 0n;
  for (let i = 0; i < 64 && i < bytes.length; i++) {
    if (bytes[i]! >= avg) {
      result |= 1n << BigInt(i);
    }
  }

  return result.toString(16).padStart(16, "0");
}

import type { Sql } from "postgres";

export async function storeFingerprint(
  sql: Sql,
  workspaceId: string,
  text: string,
  contentHash?: string,
): Promise<{ id: string; simhash: string; avg_hash: string }> {
  const simhash = computeSimhash(text);
  const avgHash = computeAverageHash(text);
  const hash = contentHash ?? createHash("sha256").update(text).digest("hex");
  const preview = text.slice(0, 200);

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO guardrails.content_fingerprints
      (workspace_id, fingerprint, content_hash, content_preview, simhash, avg_hash)
    VALUES
      (${workspaceId}, ${hash}, ${hash}, ${preview}, ${simhash}, ${avgHash})
    RETURNING id
  `;

  return { id: row.id, simhash, avg_hash: avgHash };
}

export async function getFingerprint(
  sql: Sql,
  id: string,
): Promise<{
  id: string;
  workspace_id: string;
  fingerprint: string;
  content_hash: string;
  content_preview: string | null;
  simhash: string | null;
  avg_hash: string | null;
  created_at: Date;
} | null> {
  const [row] = await sql<any[]>`
    SELECT id, workspace_id, fingerprint, content_hash, content_preview,
           simhash, avg_hash, created_at
    FROM guardrails.content_fingerprints
    WHERE id = ${id}
  `;
  return row ?? null;
}

export async function listFingerprints(
  sql: Sql,
  workspaceId: string,
  limit = 50,
  offset = 0,
): Promise<{
  fingerprints: Array<{
    id: string;
    fingerprint: string;
    content_preview: string | null;
    simhash: string | null;
    avg_hash: string | null;
    created_at: Date;
  }>;
  total: number;
}> {
  const fingerprints = await sql<any[]>`
    SELECT id, fingerprint, content_preview, simhash, avg_hash, created_at
    FROM guardrails.content_fingerprints
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [{ count }] = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM guardrails.content_fingerprints
    WHERE workspace_id = ${workspaceId}
  `;

  return { fingerprints: fingerprints as any, total: parseInt(count) };
}

export async function deleteFingerprint(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const [{ count }] = await sql<{ count: string }[]>`
    DELETE FROM guardrails.content_fingerprints WHERE id = ${id}
    RETURNING count(*) as count
  `;
  return parseInt(count) > 0;
}

export async function findNearDuplicates(
  sql: Sql,
  workspaceId: string,
  text: string,
  threshold = 3,
  limit = 10,
): Promise<Array<{
  id: string;
  fingerprint: string;
  content_preview: string | null;
  hamming_distance: number;
}>> {
  const queryHash = computeSimhash(text);

  const rows = await sql<any[]>`
    SELECT id, fingerprint, content_preview, simhash
    FROM guardrails.content_fingerprints
    WHERE workspace_id = ${workspaceId} AND simhash IS NOT NULL
    LIMIT 200
  `;

  const scored = rows
    .map((row) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      content_preview: row.content_preview,
      hamming_distance: hammingDistance(queryHash, row.simhash),
    }))
    .filter((r) => r.hamming_distance <= threshold)
    .sort((a, b) => a.hamming_distance - b.hamming_distance)
    .slice(0, limit);

  return scored;
}
