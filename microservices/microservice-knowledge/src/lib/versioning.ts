import type { Sql } from "postgres";

/**
 * Document versioning: track historical versions of document content and metadata.
 * Enables rollback to previous versions and audit history of document changes.
 */

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  content: string;
  content_hash: string;
  metadata_snapshot: Record<string, any>;
  chunk_count: number;
  created_at: string;
  reason: string | null;
}

export interface CreateVersionData {
  documentId: string;
  content: string;
  contentHash: string;
  metadataSnapshot: Record<string, any>;
  chunkCount: number;
  reason?: string;
}

/**
 * Snapshot the current state of a document as a new version.
 * Should be called before updating a document to preserve history.
 */
export async function createDocumentVersion(
  sql: Sql,
  data: CreateVersionData,
): Promise<DocumentVersion> {
  // Get the current latest version number
  const [lastVersion] = await sql<{ version_number: number }[]>`
    SELECT COALESCE(MAX(version_number), 0) as version_number
    FROM knowledge.document_versions
    WHERE document_id = ${data.documentId}
  `;

  const nextVersion = (lastVersion?.version_number ?? 0) + 1;

  const [version] = await sql<DocumentVersion[]>`
    INSERT INTO knowledge.document_versions
      (document_id, version_number, content, content_hash, metadata_snapshot, chunk_count, reason)
    VALUES (
      ${data.documentId},
      ${nextVersion},
      ${data.content},
      ${data.contentHash},
      ${sql.json(data.metadataSnapshot)},
      ${data.chunkCount},
      ${data.reason ?? null}
    )
    RETURNING *
  `;
  return version!;
}

/**
 * Get a specific version of a document.
 */
export async function getDocumentVersion(
  sql: Sql,
  documentId: string,
  versionNumber: number,
): Promise<DocumentVersion | null> {
  const [v] = await sql<DocumentVersion[]>`
    SELECT * FROM knowledge.document_versions
    WHERE document_id = ${documentId} AND version_number = ${versionNumber}
  `;
  return v ?? null;
}

/**
 * List all versions of a document, newest first.
 */
export async function listDocumentVersions(
  sql: Sql,
  documentId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DocumentVersion[]> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  return sql<DocumentVersion[]>`
    SELECT * FROM knowledge.document_versions
    WHERE document_id = ${documentId}
    ORDER BY version_number DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

/**
 * Restore a document to a previous version.
 * Creates a new version snapshot of the current state first (for safety),
 * then overwrites the document content with the historical version.
 *
 * Returns the newly created version record and the restored document.
 */
export async function restoreDocumentVersion(
  sql: Sql,
  documentId: string,
  versionNumber: number,
): Promise<{ backup_version: DocumentVersion; restored_version: DocumentVersion }> {
  // 1. Get current document state
  const [currentDoc] = await sql<any[]>`
    SELECT * FROM knowledge.documents WHERE id = ${documentId}
  `;
  if (!currentDoc) throw new Error(`Document not found: ${documentId}`);

  // 2. Get the version to restore
  const restoreFrom = await getDocumentVersion(sql, documentId, versionNumber);
  if (!restoreFrom) throw new Error(`Version ${versionNumber} not found for document ${documentId}`);

  // 3. Snapshot current state as backup
  const backup = await createDocumentVersion(sql, {
    documentId,
    content: currentDoc.content,
    contentHash: currentDoc.content_hash,
    metadataSnapshot: currentDoc.metadata ?? {},
    chunkCount: currentDoc.chunk_count,
    reason: `Auto-backup before restore to version ${versionNumber}`,
  });

  // 4. Overwrite document with historical version
  const [restored] = await sql<any[]>`
    UPDATE knowledge.documents
    SET content = ${restoreFrom.content},
        content_hash = ${restoreFrom.content_hash},
        metadata = ${sql.json(restoreFrom.metadata_snapshot)},
        chunk_count = ${restoreFrom.chunkCount},
        status = 'pending',
        version = version + 1
    WHERE id = ${documentId}
    RETURNING *
  `;

  // 5. Record the restore as a new version
  const restoredVersion = await createDocumentVersion(sql, {
    documentId,
    content: restoreFrom.content,
    contentHash: restoreFrom.content_hash,
    metadataSnapshot: restoreFrom.metadata_snapshot,
    chunkCount: restoreFrom.chunkCount,
    reason: `Restored from version ${versionNumber}`,
  });

  return { backup_version: backup, restored_version: restoredVersion };
}

/**
 * Compare two versions of a document, returning word-level diff.
 */
export async function compareVersions(
  sql: Sql,
  documentId: string,
  versionA: number,
  versionB: number,
): Promise<{
  version_a: number;
  version_b: number;
  word_diff: Array<{ type: "same" | "added" | "removed"; text: string }>;
  size_diff: number;
  content_changed: boolean;
}> {
  const [vA, vB] = await Promise.all([
    getDocumentVersion(sql, documentId, versionA),
    getDocumentVersion(sql, documentId, versionB),
  ]);

  if (!vA || !vB) {
    throw new Error("One or both versions not found");
  }

  // Simple word-level diff
  const wordsA = vA.content.split(/\s+/);
  const wordsB = vB.content.split(/\s+/);
  const diff = computeWordDiff(wordsA, wordsB);

  return {
    version_a: versionA,
    version_b: versionB,
    word_diff: diff,
    size_diff: vB.content.length - vA.content.length,
    content_changed: vA.content_hash !== vB.content_hash,
  };
}

/**
 * Simple LCS-based word diff.
 */
function computeWordDiff(
  wordsA: string[],
  wordsB: string[],
): Array<{ type: "same" | "added" | "removed"; text: string }> {
  // LCS-based diff
  const m = wordsA.length;
  const n = wordsB.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (wordsA[i - 1] === wordsB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  const result: Array<{ type: "same" | "added" | "removed"; text: string }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsA[i - 1] === wordsB[j - 1]) {
      result.unshift({ type: "same", text: wordsA[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", text: wordsB[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", text: wordsA[i - 1] });
      i--;
    }
  }

  return result;
}

/**
 * Delete old versions, keeping only the most recent N versions.
 * Returns the number of versions deleted.
 */
export async function pruneOldVersions(
  sql: Sql,
  documentId: string,
  keepLast: number = 10,
): Promise<number> {
  const r = await sql`
    DELETE FROM knowledge.document_versions
    WHERE document_id = ${documentId}
      AND version_number NOT IN (
        SELECT version_number
        FROM knowledge.document_versions
        WHERE document_id = ${documentId}
        ORDER BY version_number DESC
        LIMIT ${keepLast}
      )
    RETURNING id
  `;
  return r.count;
}
