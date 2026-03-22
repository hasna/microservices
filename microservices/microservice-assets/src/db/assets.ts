/**
 * Asset and Collection CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Asset types ---

export interface Asset {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  dimensions: string | null;
  tags: string[];
  category: string | null;
  metadata: Record<string, unknown>;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

interface AssetRow {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  dimensions: string | null;
  tags: string;
  category: string | null;
  metadata: string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAsset(row: AssetRow): Asset {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateAssetInput {
  name: string;
  description?: string;
  type?: string;
  file_path?: string;
  file_size?: number;
  mime_type?: string;
  dimensions?: string;
  tags?: string[];
  category?: string;
  metadata?: Record<string, unknown>;
  uploaded_by?: string;
}

export function createAsset(input: CreateAssetInput): Asset {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO assets (id, name, description, type, file_path, file_size, mime_type, dimensions, tags, category, metadata, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.description || null,
    input.type || null,
    input.file_path || null,
    input.file_size ?? null,
    input.mime_type || null,
    input.dimensions || null,
    tags,
    input.category || null,
    metadata,
    input.uploaded_by || null
  );

  return getAsset(id)!;
}

export function getAsset(id: string): Asset | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | null;
  return row ? rowToAsset(row) : null;
}

export interface ListAssetsOptions {
  search?: string;
  type?: string;
  category?: string;
  tag?: string;
  uploaded_by?: string;
  limit?: number;
  offset?: number;
}

export function listAssets(options: ListAssetsOptions = {}): Asset[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push("(name LIKE ? OR description LIKE ? OR tags LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }

  if (options.tag) {
    conditions.push("tags LIKE ?");
    params.push(`%${options.tag}%`);
  }

  if (options.uploaded_by) {
    conditions.push("uploaded_by = ?");
    params.push(options.uploaded_by);
  }

  let sql = "SELECT * FROM assets";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as AssetRow[];
  return rows.map(rowToAsset);
}

export interface UpdateAssetInput {
  name?: string;
  description?: string;
  type?: string;
  file_path?: string;
  file_size?: number;
  mime_type?: string;
  dimensions?: string;
  tags?: string[];
  category?: string;
  metadata?: Record<string, unknown>;
  uploaded_by?: string;
}

export function updateAsset(id: string, input: UpdateAssetInput): Asset | null {
  const db = getDatabase();
  const existing = getAsset(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.type !== undefined) {
    sets.push("type = ?");
    params.push(input.type);
  }
  if (input.file_path !== undefined) {
    sets.push("file_path = ?");
    params.push(input.file_path);
  }
  if (input.file_size !== undefined) {
    sets.push("file_size = ?");
    params.push(input.file_size);
  }
  if (input.mime_type !== undefined) {
    sets.push("mime_type = ?");
    params.push(input.mime_type);
  }
  if (input.dimensions !== undefined) {
    sets.push("dimensions = ?");
    params.push(input.dimensions);
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }
  if (input.category !== undefined) {
    sets.push("category = ?");
    params.push(input.category);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }
  if (input.uploaded_by !== undefined) {
    sets.push("uploaded_by = ?");
    params.push(input.uploaded_by);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE assets SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getAsset(id);
}

export function deleteAsset(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchAssets(query: string): Asset[] {
  return listAssets({ search: query });
}

export function listByType(type: string): Asset[] {
  return listAssets({ type });
}

export function listByTag(tag: string): Asset[] {
  return listAssets({ tag });
}

export function listByCategory(category: string): Asset[] {
  return listAssets({ category });
}

export interface AssetStats {
  total_assets: number;
  total_size: number;
  by_type: Record<string, number>;
  by_category: Record<string, number>;
}

export function getAssetStats(): AssetStats {
  const db = getDatabase();

  const totalRow = db.prepare("SELECT COUNT(*) as count FROM assets").get() as { count: number };
  const sizeRow = db.prepare("SELECT COALESCE(SUM(file_size), 0) as total FROM assets").get() as { total: number };

  const typeRows = db.prepare(
    "SELECT type, COUNT(*) as count FROM assets WHERE type IS NOT NULL GROUP BY type"
  ).all() as { type: string; count: number }[];

  const categoryRows = db.prepare(
    "SELECT category, COUNT(*) as count FROM assets WHERE category IS NOT NULL GROUP BY category"
  ).all() as { category: string; count: number }[];

  const by_type: Record<string, number> = {};
  for (const row of typeRows) {
    by_type[row.type] = row.count;
  }

  const by_category: Record<string, number> = {};
  for (const row of categoryRows) {
    by_category[row.category] = row.count;
  }

  return {
    total_assets: totalRow.count,
    total_size: sizeRow.total,
    by_type,
    by_category,
  };
}

// --- Collection types ---

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface CreateCollectionInput {
  name: string;
  description?: string;
}

export function createCollection(input: CreateCollectionInput): Collection {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO collections (id, name, description) VALUES (?, ?, ?)`
  ).run(id, input.name, input.description || null);

  return getCollection(id)!;
}

export function getCollection(id: string): Collection | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as Collection | null;
}

export function listCollections(): Collection[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM collections ORDER BY name").all() as Collection[];
}

export function deleteCollection(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM collections WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Collection-Asset operations ---

export function addToCollection(collectionId: string, assetId: string): boolean {
  const db = getDatabase();
  try {
    db.prepare(
      "INSERT OR IGNORE INTO collection_assets (collection_id, asset_id) VALUES (?, ?)"
    ).run(collectionId, assetId);
    return true;
  } catch {
    return false;
  }
}

export function removeFromCollection(collectionId: string, assetId: string): boolean {
  const db = getDatabase();
  const result = db.prepare(
    "DELETE FROM collection_assets WHERE collection_id = ? AND asset_id = ?"
  ).run(collectionId, assetId);
  return result.changes > 0;
}

export function getCollectionAssets(collectionId: string): Asset[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT a.* FROM assets a
     INNER JOIN collection_assets ca ON ca.asset_id = a.id
     WHERE ca.collection_id = ?
     ORDER BY ca.added_at DESC`
  ).all(collectionId) as AssetRow[];
  return rows.map(rowToAsset);
}
