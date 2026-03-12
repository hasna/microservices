/**
 * Inventory CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Products ---

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit_price: number;
  cost_price: number;
  unit: string;
  quantity_on_hand: number;
  reorder_level: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ProductRow extends Omit<Product, "metadata"> {
  metadata: string;
}

function rowToProduct(row: ProductRow): Product {
  return { ...row, metadata: JSON.parse(row.metadata || "{}") } as Product;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit_price?: number;
  cost_price?: number;
  unit?: string;
  quantity_on_hand?: number;
  reorder_level?: number;
  metadata?: Record<string, unknown>;
}

export function createProduct(input: CreateProductInput): Product {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO products (id, sku, name, description, category, unit_price, cost_price, unit, quantity_on_hand, reorder_level, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.sku,
    input.name,
    input.description || null,
    input.category || null,
    input.unit_price || 0,
    input.cost_price || 0,
    input.unit || "each",
    input.quantity_on_hand || 0,
    input.reorder_level || 0,
    metadata
  );

  return getProduct(id)!;
}

export function getProduct(id: string): Product | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM products WHERE id = ? OR sku = ?").get(id, id) as ProductRow | null;
  return row ? rowToProduct(row) : null;
}

export interface ListProductsOptions {
  category?: string;
  low_stock?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listProducts(options: ListProductsOptions = {}): Product[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }

  if (options.low_stock) {
    conditions.push("quantity_on_hand <= reorder_level");
  }

  if (options.search) {
    conditions.push("(name LIKE ? OR sku LIKE ? OR description LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
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
  sku?: string;
  name?: string;
  description?: string;
  category?: string;
  unit_price?: number;
  cost_price?: number;
  unit?: string;
  quantity_on_hand?: number;
  reorder_level?: number;
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

  if (input.sku !== undefined) {
    sets.push("sku = ?");
    params.push(input.sku);
  }
  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.category !== undefined) {
    sets.push("category = ?");
    params.push(input.category);
  }
  if (input.unit_price !== undefined) {
    sets.push("unit_price = ?");
    params.push(input.unit_price);
  }
  if (input.cost_price !== undefined) {
    sets.push("cost_price = ?");
    params.push(input.cost_price);
  }
  if (input.unit !== undefined) {
    sets.push("unit = ?");
    params.push(input.unit);
  }
  if (input.quantity_on_hand !== undefined) {
    sets.push("quantity_on_hand = ?");
    params.push(input.quantity_on_hand);
  }
  if (input.reorder_level !== undefined) {
    sets.push("reorder_level = ?");
    params.push(input.reorder_level);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(existing.id);

  db.prepare(
    `UPDATE products SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getProduct(existing.id);
}

export function deleteProduct(id: string): boolean {
  const db = getDatabase();
  const existing = getProduct(id);
  if (!existing) return false;
  return db.prepare("DELETE FROM products WHERE id = ?").run(existing.id).changes > 0;
}

// --- Stock Movements ---

export interface StockMovement {
  id: string;
  product_id: string;
  type: "in" | "out" | "adjustment";
  quantity: number;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface RecordMovementInput {
  product_id: string;
  type: "in" | "out" | "adjustment";
  quantity: number;
  reference?: string;
  notes?: string;
}

export function recordMovement(input: RecordMovementInput): StockMovement {
  const db = getDatabase();
  const id = crypto.randomUUID();

  // Resolve product by id or sku
  const product = getProduct(input.product_id);
  if (!product) {
    throw new Error(`Product '${input.product_id}' not found.`);
  }

  db.prepare(
    `INSERT INTO stock_movements (id, product_id, type, quantity, reference, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    product.id,
    input.type,
    input.quantity,
    input.reference || null,
    input.notes || null
  );

  // Adjust quantity_on_hand
  let delta: number;
  if (input.type === "in") {
    delta = input.quantity;
  } else if (input.type === "out") {
    delta = -input.quantity;
  } else {
    // adjustment: quantity is the absolute adjustment (can be positive or negative)
    delta = input.quantity;
  }

  db.prepare(
    "UPDATE products SET quantity_on_hand = quantity_on_hand + ?, updated_at = datetime('now') WHERE id = ?"
  ).run(delta, product.id);

  return db.prepare("SELECT * FROM stock_movements WHERE id = ?").get(id) as StockMovement;
}

export interface ListMovementsOptions {
  product_id?: string;
  type?: "in" | "out" | "adjustment";
  from_date?: string;
  to_date?: string;
  limit?: number;
}

export function listMovements(options: ListMovementsOptions = {}): StockMovement[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.product_id) {
    // Resolve product by id or sku
    const product = getProduct(options.product_id);
    if (product) {
      conditions.push("product_id = ?");
      params.push(product.id);
    } else {
      conditions.push("product_id = ?");
      params.push(options.product_id);
    }
  }

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  if (options.from_date) {
    conditions.push("created_at >= ?");
    params.push(options.from_date);
  }

  if (options.to_date) {
    conditions.push("created_at <= ?");
    params.push(options.to_date);
  }

  let sql = "SELECT * FROM stock_movements";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  return db.prepare(sql).all(...params) as StockMovement[];
}

// --- Low Stock ---

export function getLowStockProducts(): Product[] {
  return listProducts({ low_stock: true });
}

// --- Inventory Value ---

export function getInventoryValue(): {
  total_products: number;
  total_quantity: number;
  total_cost_value: number;
  total_retail_value: number;
} {
  const db = getDatabase();

  const row = db
    .prepare(
      `SELECT
        COUNT(*) as total_products,
        COALESCE(SUM(quantity_on_hand), 0) as total_quantity,
        COALESCE(SUM(quantity_on_hand * cost_price), 0) as total_cost_value,
        COALESCE(SUM(quantity_on_hand * unit_price), 0) as total_retail_value
      FROM products`
    )
    .get() as {
    total_products: number;
    total_quantity: number;
    total_cost_value: number;
    total_retail_value: number;
  };

  return row;
}

// --- Locations ---

export interface Location {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface CreateLocationInput {
  name: string;
  description?: string;
}

export function createLocation(input: CreateLocationInput): Location {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO locations (id, name, description) VALUES (?, ?, ?)`
  ).run(id, input.name, input.description || null);

  return db.prepare("SELECT * FROM locations WHERE id = ?").get(id) as Location;
}

export function listLocations(search?: string): Location[] {
  const db = getDatabase();

  if (search) {
    const q = `%${search}%`;
    return db
      .prepare("SELECT * FROM locations WHERE name LIKE ? OR description LIKE ? ORDER BY name")
      .all(q, q) as Location[];
  }

  return db.prepare("SELECT * FROM locations ORDER BY name").all() as Location[];
}
