/**
 * Product CRUD operations
 */

import { getDatabase } from "./database.js";

export interface Product {
  id: string;
  name: string;
  description: string | null;
  type: "product" | "service" | "subscription" | "digital";
  sku: string | null;
  price: number | null;
  currency: string;
  unit: string | null;
  category: string | null;
  status: "active" | "draft" | "archived";
  images: string[];
  variants: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  sku: string | null;
  price: number | null;
  currency: string;
  unit: string | null;
  category: string | null;
  status: string;
  images: string;
  variants: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToProduct(row: ProductRow): Product {
  return {
    ...row,
    type: row.type as Product["type"],
    status: row.status as Product["status"],
    images: JSON.parse(row.images || "[]"),
    variants: JSON.parse(row.variants || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateProductInput {
  name: string;
  description?: string;
  type?: "product" | "service" | "subscription" | "digital";
  sku?: string;
  price?: number;
  currency?: string;
  unit?: string;
  category?: string;
  status?: "active" | "draft" | "archived";
  images?: string[];
  variants?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

export function createProduct(input: CreateProductInput): Product {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const images = JSON.stringify(input.images || []);
  const variants = JSON.stringify(input.variants || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO products (id, name, description, type, sku, price, currency, unit, category, status, images, variants, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.description || null,
    input.type || "product",
    input.sku || null,
    input.price ?? null,
    input.currency || "USD",
    input.unit || null,
    input.category || null,
    input.status || "draft",
    images,
    variants,
    metadata
  );

  return getProduct(id)!;
}

export function getProduct(id: string): Product | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow | null;
  return row ? rowToProduct(row) : null;
}

export interface ListProductsOptions {
  search?: string;
  category?: string;
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listProducts(options: ListProductsOptions = {}): Product[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push(
      "(name LIKE ? OR description LIKE ? OR sku LIKE ?)"
    );
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM products";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as ProductRow[];
  return rows.map(rowToProduct);
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  type?: "product" | "service" | "subscription" | "digital";
  sku?: string;
  price?: number;
  currency?: string;
  unit?: string;
  category?: string | null;
  status?: "active" | "draft" | "archived";
  images?: string[];
  variants?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

export function updateProduct(
  id: string,
  input: UpdateProductInput
): Product | null {
  const db = getDatabase();
  const existing = getProduct(id);
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
  if (input.sku !== undefined) {
    sets.push("sku = ?");
    params.push(input.sku);
  }
  if (input.price !== undefined) {
    sets.push("price = ?");
    params.push(input.price);
  }
  if (input.currency !== undefined) {
    sets.push("currency = ?");
    params.push(input.currency);
  }
  if (input.unit !== undefined) {
    sets.push("unit = ?");
    params.push(input.unit);
  }
  if (input.category !== undefined) {
    sets.push("category = ?");
    params.push(input.category);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.images !== undefined) {
    sets.push("images = ?");
    params.push(JSON.stringify(input.images));
  }
  if (input.variants !== undefined) {
    sets.push("variants = ?");
    params.push(JSON.stringify(input.variants));
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE products SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getProduct(id);
}

export function deleteProduct(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countProducts(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number };
  return row.count;
}

export function searchProducts(query: string): Product[] {
  return listProducts({ search: query });
}

export function listByCategory(category: string): Product[] {
  return listProducts({ category });
}

export function listByType(type: string): Product[] {
  return listProducts({ type });
}

export function listByStatus(status: string): Product[] {
  return listProducts({ status });
}

export interface ProductWithTiers extends Product {
  pricing_tiers: PricingTier[];
}

export interface PricingTier {
  id: string;
  product_id: string;
  name: string;
  min_quantity: number;
  price: number;
  currency: string;
  created_at: string;
}

export function getProductWithTiers(id: string): ProductWithTiers | null {
  const product = getProduct(id);
  if (!product) return null;

  const db = getDatabase();
  const tiers = db
    .prepare("SELECT * FROM pricing_tiers WHERE product_id = ? ORDER BY min_quantity")
    .all(id) as PricingTier[];

  return { ...product, pricing_tiers: tiers };
}

export interface BulkImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export function bulkImportProducts(csv: string): BulkImportResult {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    return { imported: 0, skipped: 0, errors: ["CSV must have a header row and at least one data row"] };
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  if (nameIdx === -1) {
    return { imported: 0, skipped: 0, errors: ["CSV must have a 'name' column"] };
  }

  const result: BulkImportResult = { imported: 0, skipped: 0, errors: [] };

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    if (values.length < headers.length) {
      result.errors.push(`Row ${i + 1}: insufficient columns`);
      result.skipped++;
      continue;
    }

    try {
      const input: CreateProductInput = {
        name: values[nameIdx],
      };

      const descIdx = headers.indexOf("description");
      if (descIdx !== -1 && values[descIdx]) input.description = values[descIdx];

      const typeIdx = headers.indexOf("type");
      if (typeIdx !== -1 && values[typeIdx]) {
        const t = values[typeIdx] as CreateProductInput["type"];
        if (["product", "service", "subscription", "digital"].includes(values[typeIdx])) {
          input.type = t;
        }
      }

      const skuIdx = headers.indexOf("sku");
      if (skuIdx !== -1 && values[skuIdx]) input.sku = values[skuIdx];

      const priceIdx = headers.indexOf("price");
      if (priceIdx !== -1 && values[priceIdx]) {
        const p = parseFloat(values[priceIdx]);
        if (!isNaN(p)) input.price = p;
      }

      const currencyIdx = headers.indexOf("currency");
      if (currencyIdx !== -1 && values[currencyIdx]) input.currency = values[currencyIdx];

      const unitIdx = headers.indexOf("unit");
      if (unitIdx !== -1 && values[unitIdx]) input.unit = values[unitIdx];

      const categoryIdx = headers.indexOf("category");
      if (categoryIdx !== -1 && values[categoryIdx]) input.category = values[categoryIdx];

      const statusIdx = headers.indexOf("status");
      if (statusIdx !== -1 && values[statusIdx]) {
        const s = values[statusIdx] as CreateProductInput["status"];
        if (["active", "draft", "archived"].includes(values[statusIdx])) {
          input.status = s;
        }
      }

      createProduct(input);
      result.imported++;
    } catch (error) {
      result.errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
      result.skipped++;
    }
  }

  return result;
}

export function exportProducts(format: "csv" | "json" = "json"): string {
  const products = listProducts();

  if (format === "json") {
    return JSON.stringify(products, null, 2);
  }

  // CSV format
  const headers = [
    "id", "name", "description", "type", "sku", "price", "currency",
    "unit", "category", "status", "created_at", "updated_at",
  ];
  const rows = products.map((p) =>
    headers.map((h) => {
      const val = p[h as keyof Product];
      if (val === null || val === undefined) return "";
      if (typeof val === "string" && val.includes(",")) return `"${val}"`;
      return String(val);
    }).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export interface ProductStats {
  total: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_category: Record<string, number>;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
}

export function getProductStats(): ProductStats {
  const db = getDatabase();

  const total = (db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number }).count;

  const statusRows = db
    .prepare("SELECT status, COUNT(*) as count FROM products GROUP BY status")
    .all() as { status: string; count: number }[];
  const by_status: Record<string, number> = {};
  for (const r of statusRows) by_status[r.status] = r.count;

  const typeRows = db
    .prepare("SELECT type, COUNT(*) as count FROM products GROUP BY type")
    .all() as { type: string; count: number }[];
  const by_type: Record<string, number> = {};
  for (const r of typeRows) by_type[r.type] = r.count;

  const catRows = db
    .prepare("SELECT COALESCE(category, 'uncategorized') as category, COUNT(*) as count FROM products GROUP BY category")
    .all() as { category: string; count: number }[];
  const by_category: Record<string, number> = {};
  for (const r of catRows) by_category[r.category] = r.count;

  const priceRow = db
    .prepare("SELECT AVG(price) as avg_price, MIN(price) as min_price, MAX(price) as max_price FROM products WHERE price IS NOT NULL")
    .get() as { avg_price: number | null; min_price: number | null; max_price: number | null };

  return {
    total,
    by_status,
    by_type,
    by_category,
    avg_price: priceRow.avg_price,
    min_price: priceRow.min_price,
    max_price: priceRow.max_price,
  };
}
