/**
 * Pricing tier operations
 */

import { getDatabase } from "./database.js";

export interface PricingTier {
  id: string;
  product_id: string;
  name: string;
  min_quantity: number;
  price: number;
  currency: string;
  created_at: string;
}

export interface CreatePricingTierInput {
  product_id: string;
  name: string;
  min_quantity: number;
  price: number;
  currency?: string;
}

export function createPricingTier(input: CreatePricingTierInput): PricingTier {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO pricing_tiers (id, product_id, name, min_quantity, price, currency)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.product_id,
    input.name,
    input.min_quantity,
    input.price,
    input.currency || "USD"
  );

  return getPricingTier(id)!;
}

export function getPricingTier(id: string): PricingTier | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM pricing_tiers WHERE id = ?").get(id) as PricingTier | null;
}

export function listPricingTiers(productId: string): PricingTier[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM pricing_tiers WHERE product_id = ? ORDER BY min_quantity")
    .all(productId) as PricingTier[];
}

export function deletePricingTier(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM pricing_tiers WHERE id = ?").run(id);
  return result.changes > 0;
}

export function deletePricingTiersByProduct(productId: string): number {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM pricing_tiers WHERE product_id = ?").run(productId);
  return result.changes;
}
