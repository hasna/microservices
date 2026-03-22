import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-products-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
  deleteProduct,
  countProducts,
  searchProducts,
  listByCategory,
  listByType,
  listByStatus,
  getProductWithTiers,
  bulkImportProducts,
  exportProducts,
  getProductStats,
} from "./products";
import {
  createCategory,
  getCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  getCategoryTree,
} from "./categories";
import {
  createPricingTier,
  getPricingTier,
  listPricingTiers,
  deletePricingTier,
  deletePricingTiersByProduct,
} from "./pricing-tiers";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// Products
// ============================================================

describe("Products", () => {
  test("create and get product", () => {
    const product = createProduct({
      name: "Widget A",
      description: "A fine widget",
      type: "product",
      sku: "WGT-001",
      price: 29.99,
      currency: "USD",
      unit: "piece",
      category: "Widgets",
      status: "active",
      images: ["https://img.example.com/a.png"],
      metadata: { weight: "100g" },
    });

    expect(product.id).toBeTruthy();
    expect(product.name).toBe("Widget A");
    expect(product.description).toBe("A fine widget");
    expect(product.type).toBe("product");
    expect(product.sku).toBe("WGT-001");
    expect(product.price).toBe(29.99);
    expect(product.currency).toBe("USD");
    expect(product.unit).toBe("piece");
    expect(product.category).toBe("Widgets");
    expect(product.status).toBe("active");
    expect(product.images).toEqual(["https://img.example.com/a.png"]);
    expect(product.metadata).toEqual({ weight: "100g" });

    const fetched = getProduct(product.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(product.id);
  });

  test("create product with defaults", () => {
    const product = createProduct({ name: "Minimal Product" });
    expect(product.type).toBe("product");
    expect(product.status).toBe("draft");
    expect(product.currency).toBe("USD");
    expect(product.images).toEqual([]);
    expect(product.variants).toEqual([]);
    expect(product.metadata).toEqual({});
  });

  test("get non-existent product returns null", () => {
    expect(getProduct("non-existent-id")).toBeNull();
  });

  test("list products", () => {
    createProduct({ name: "Widget B", sku: "WGT-002", status: "active" });
    const all = listProducts();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list products with search", () => {
    const results = listProducts({ search: "Widget A" });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Widget A");
  });

  test("list products with limit", () => {
    const results = listProducts({ limit: 1 });
    expect(results.length).toBe(1);
  });

  test("search products", () => {
    const results = searchProducts("Widget");
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test("search products by SKU", () => {
    const results = searchProducts("WGT-001");
    expect(results.length).toBe(1);
    expect(results[0].sku).toBe("WGT-001");
  });

  test("list by category", () => {
    const results = listByCategory("Widgets");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((p) => p.category === "Widgets")).toBe(true);
  });

  test("list by type", () => {
    createProduct({ name: "Consulting", type: "service", status: "active" });
    const results = listByType("service");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((p) => p.type === "service")).toBe(true);
  });

  test("list by status", () => {
    const active = listByStatus("active");
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(active.every((p) => p.status === "active")).toBe(true);
  });

  test("update product", () => {
    const product = createProduct({ name: "Update Me", sku: "UPD-001" });
    const updated = updateProduct(product.id, {
      name: "Updated Name",
      price: 49.99,
      status: "active",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Name");
    expect(updated!.price).toBe(49.99);
    expect(updated!.status).toBe("active");
  });

  test("update non-existent product returns null", () => {
    expect(updateProduct("non-existent-id", { name: "Nope" })).toBeNull();
  });

  test("update with empty input returns existing", () => {
    const product = createProduct({ name: "No Change" });
    const updated = updateProduct(product.id, {});
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("No Change");
  });

  test("delete product", () => {
    const product = createProduct({ name: "Delete Me" });
    expect(deleteProduct(product.id)).toBe(true);
    expect(getProduct(product.id)).toBeNull();
  });

  test("delete non-existent product returns false", () => {
    expect(deleteProduct("non-existent-id")).toBe(false);
  });

  test("count products", () => {
    const count = countProducts();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("get product with tiers", () => {
    const product = createProduct({ name: "Tiered Product", sku: "TIER-001", price: 10 });
    createPricingTier({ product_id: product.id, name: "Bulk 10+", min_quantity: 10, price: 8.5 });
    createPricingTier({ product_id: product.id, name: "Bulk 100+", min_quantity: 100, price: 7.0 });

    const withTiers = getProductWithTiers(product.id);
    expect(withTiers).toBeDefined();
    expect(withTiers!.pricing_tiers.length).toBe(2);
    expect(withTiers!.pricing_tiers[0].min_quantity).toBe(10);
    expect(withTiers!.pricing_tiers[1].min_quantity).toBe(100);
  });

  test("get product with tiers - non-existent returns null", () => {
    expect(getProductWithTiers("non-existent-id")).toBeNull();
  });

  test("unique SKU constraint", () => {
    createProduct({ name: "Unique SKU", sku: "UNIQUE-001" });
    expect(() => createProduct({ name: "Duplicate SKU", sku: "UNIQUE-001" })).toThrow();
  });

  test("product stats", () => {
    const stats = getProductStats();
    expect(stats.total).toBeGreaterThanOrEqual(5);
    expect(stats.by_status).toBeDefined();
    expect(stats.by_type).toBeDefined();
    expect(stats.by_category).toBeDefined();
    expect(typeof stats.by_status["active"]).toBe("number");
  });

  test("bulk import products from CSV", () => {
    const csv = `name,sku,price,type,status
Import A,IMP-001,19.99,product,active
Import B,IMP-002,29.99,service,draft
Import C,IMP-003,39.99,digital,active`;

    const result = bulkImportProducts(csv);
    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);

    const found = searchProducts("Import A");
    expect(found.length).toBe(1);
    expect(found[0].price).toBe(19.99);
  });

  test("bulk import with missing name column", () => {
    const csv = `sku,price\nX,10`;
    const result = bulkImportProducts(csv);
    expect(result.imported).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("name");
  });

  test("bulk import with insufficient rows", () => {
    const csv = `name`;
    const result = bulkImportProducts(csv);
    expect(result.imported).toBe(0);
    expect(result.errors[0]).toContain("header row");
  });

  test("export products as JSON", () => {
    const json = exportProducts("json");
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test("export products as CSV", () => {
    const csv = exportProducts("csv");
    const lines = csv.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("name");
    expect(lines.length).toBeGreaterThan(1);
  });
});

// ============================================================
// Categories
// ============================================================

describe("Categories", () => {
  test("create and get category", () => {
    const category = createCategory({
      name: "Electronics",
      description: "Electronic goods",
    });

    expect(category.id).toBeTruthy();
    expect(category.name).toBe("Electronics");
    expect(category.description).toBe("Electronic goods");
    expect(category.parent_id).toBeNull();

    const fetched = getCategory(category.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Electronics");
  });

  test("create child category", () => {
    const parent = createCategory({ name: "ParentCat" });
    const child = createCategory({ name: "ChildCat", parent_id: parent.id });

    expect(child.parent_id).toBe(parent.id);
  });

  test("list categories", () => {
    const categories = listCategories();
    expect(categories.length).toBeGreaterThanOrEqual(2);
  });

  test("list categories with search", () => {
    const results = listCategories({ search: "Electronics" });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Electronics");
  });

  test("update category", () => {
    const cat = createCategory({ name: "OldName" });
    const updated = updateCategory(cat.id, { name: "NewName" });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("NewName");
  });

  test("update non-existent category returns null", () => {
    expect(updateCategory("non-existent-id", { name: "X" })).toBeNull();
  });

  test("delete category", () => {
    const cat = createCategory({ name: "DeleteCat" });
    expect(deleteCategory(cat.id)).toBe(true);
    expect(getCategory(cat.id)).toBeNull();
  });

  test("delete non-existent category returns false", () => {
    expect(deleteCategory("non-existent-id")).toBe(false);
  });

  test("category tree", () => {
    // Clean state: create a root and two children
    const root = createCategory({ name: "TreeRoot" });
    const child1 = createCategory({ name: "TreeChild1", parent_id: root.id });
    const child2 = createCategory({ name: "TreeChild2", parent_id: root.id });

    const tree = getCategoryTree();
    const rootNode = tree.find((n) => n.id === root.id);
    expect(rootNode).toBeDefined();
    expect(rootNode!.children.length).toBe(2);
    expect(rootNode!.children.map((c) => c.name).sort()).toEqual(["TreeChild1", "TreeChild2"]);
  });
});

// ============================================================
// Pricing Tiers
// ============================================================

describe("Pricing Tiers", () => {
  test("create and get pricing tier", () => {
    const product = createProduct({ name: "Tier Test Product" });
    const tier = createPricingTier({
      product_id: product.id,
      name: "Standard",
      min_quantity: 1,
      price: 15.0,
      currency: "EUR",
    });

    expect(tier.id).toBeTruthy();
    expect(tier.product_id).toBe(product.id);
    expect(tier.name).toBe("Standard");
    expect(tier.min_quantity).toBe(1);
    expect(tier.price).toBe(15.0);
    expect(tier.currency).toBe("EUR");

    const fetched = getPricingTier(tier.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(tier.id);
  });

  test("list pricing tiers for product", () => {
    const product = createProduct({ name: "Multi Tier Product" });
    createPricingTier({ product_id: product.id, name: "T1", min_quantity: 1, price: 20 });
    createPricingTier({ product_id: product.id, name: "T2", min_quantity: 50, price: 15 });
    createPricingTier({ product_id: product.id, name: "T3", min_quantity: 200, price: 10 });

    const tiers = listPricingTiers(product.id);
    expect(tiers.length).toBe(3);
    // Should be ordered by min_quantity
    expect(tiers[0].min_quantity).toBe(1);
    expect(tiers[1].min_quantity).toBe(50);
    expect(tiers[2].min_quantity).toBe(200);
  });

  test("delete pricing tier", () => {
    const product = createProduct({ name: "Del Tier Product" });
    const tier = createPricingTier({ product_id: product.id, name: "DelTier", min_quantity: 1, price: 5 });
    expect(deletePricingTier(tier.id)).toBe(true);
    expect(getPricingTier(tier.id)).toBeNull();
  });

  test("delete non-existent pricing tier returns false", () => {
    expect(deletePricingTier("non-existent-id")).toBe(false);
  });

  test("delete pricing tiers by product", () => {
    const product = createProduct({ name: "Bulk Del Product" });
    createPricingTier({ product_id: product.id, name: "A", min_quantity: 1, price: 10 });
    createPricingTier({ product_id: product.id, name: "B", min_quantity: 10, price: 8 });

    const deleted = deletePricingTiersByProduct(product.id);
    expect(deleted).toBe(2);
    expect(listPricingTiers(product.id).length).toBe(0);
  });

  test("cascading delete removes tiers when product is deleted", () => {
    const product = createProduct({ name: "Cascade Product" });
    createPricingTier({ product_id: product.id, name: "Cascade Tier", min_quantity: 1, price: 5 });
    expect(listPricingTiers(product.id).length).toBe(1);

    deleteProduct(product.id);
    expect(listPricingTiers(product.id).length).toBe(0);
  });
});
