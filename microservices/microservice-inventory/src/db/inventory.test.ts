import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "microservice-inventory-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
  deleteProduct,
  recordMovement,
  listMovements,
  getLowStockProducts,
  getInventoryValue,
  createLocation,
  listLocations,
} from "./inventory";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Products", () => {
  test("create and get product", () => {
    const product = createProduct({
      sku: "WIDGET-001",
      name: "Blue Widget",
      description: "A standard blue widget",
      category: "Widgets",
      unit_price: 9.99,
      cost_price: 4.50,
      unit: "each",
      quantity_on_hand: 100,
      reorder_level: 20,
    });

    expect(product.id).toBeTruthy();
    expect(product.sku).toBe("WIDGET-001");
    expect(product.name).toBe("Blue Widget");
    expect(product.unit_price).toBe(9.99);
    expect(product.cost_price).toBe(4.50);
    expect(product.quantity_on_hand).toBe(100);
    expect(product.reorder_level).toBe(20);

    const fetched = getProduct(product.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(product.id);
  });

  test("get product by SKU", () => {
    const fetched = getProduct("WIDGET-001");
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Blue Widget");
  });

  test("list products", () => {
    createProduct({ sku: "GADGET-001", name: "Red Gadget", category: "Gadgets" });
    const all = listProducts();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("filter by category", () => {
    const widgets = listProducts({ category: "Widgets" });
    expect(widgets.length).toBeGreaterThanOrEqual(1);
    expect(widgets.every((p) => p.category === "Widgets")).toBe(true);
  });

  test("search products", () => {
    const results = listProducts({ search: "Blue" });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Blue Widget");
  });

  test("update product", () => {
    const product = createProduct({ sku: "UPD-001", name: "Update Me" });
    const updated = updateProduct(product.id, {
      name: "Updated Product",
      unit_price: 19.99,
      category: "Updated",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Product");
    expect(updated!.unit_price).toBe(19.99);
    expect(updated!.category).toBe("Updated");
  });

  test("delete product", () => {
    const product = createProduct({ sku: "DEL-001", name: "Delete Me" });
    expect(deleteProduct(product.id)).toBe(true);
    expect(getProduct(product.id)).toBeNull();
  });
});

describe("Stock Movements", () => {
  test("stock in increases quantity", () => {
    const product = createProduct({
      sku: "MOV-001",
      name: "Movement Test",
      quantity_on_hand: 50,
    });

    const movement = recordMovement({
      product_id: product.id,
      type: "in",
      quantity: 25,
      reference: "PO-1234",
    });

    expect(movement.id).toBeTruthy();
    expect(movement.type).toBe("in");
    expect(movement.quantity).toBe(25);
    expect(movement.reference).toBe("PO-1234");

    const updated = getProduct(product.id)!;
    expect(updated.quantity_on_hand).toBe(75);
  });

  test("stock out decreases quantity", () => {
    const product = createProduct({
      sku: "MOV-002",
      name: "Out Test",
      quantity_on_hand: 50,
    });

    recordMovement({
      product_id: product.id,
      type: "out",
      quantity: 10,
      reference: "ORD-5678",
    });

    const updated = getProduct(product.id)!;
    expect(updated.quantity_on_hand).toBe(40);
  });

  test("adjustment modifies quantity", () => {
    const product = createProduct({
      sku: "MOV-003",
      name: "Adjust Test",
      quantity_on_hand: 50,
    });

    recordMovement({
      product_id: product.id,
      type: "adjustment",
      quantity: -5,
      notes: "Damaged items",
    });

    const updated = getProduct(product.id)!;
    expect(updated.quantity_on_hand).toBe(45);
  });

  test("list movements by product", () => {
    const product = createProduct({
      sku: "MOV-004",
      name: "List Movements Test",
      quantity_on_hand: 100,
    });

    recordMovement({ product_id: product.id, type: "in", quantity: 10 });
    recordMovement({ product_id: product.id, type: "out", quantity: 5 });

    const movements = listMovements({ product_id: product.id });
    expect(movements.length).toBe(2);
  });

  test("list movements by type", () => {
    const inMovements = listMovements({ type: "in" });
    expect(inMovements.every((m) => m.type === "in")).toBe(true);
  });

  test("movement with product SKU", () => {
    const product = createProduct({
      sku: "SKU-MOVE-001",
      name: "SKU Movement Test",
      quantity_on_hand: 30,
    });

    recordMovement({
      product_id: "SKU-MOVE-001",
      type: "in",
      quantity: 10,
    });

    const updated = getProduct("SKU-MOVE-001")!;
    expect(updated.quantity_on_hand).toBe(40);
  });
});

describe("Low Stock", () => {
  test("get low stock products", () => {
    createProduct({
      sku: "LOW-001",
      name: "Low Stock Item",
      quantity_on_hand: 5,
      reorder_level: 10,
    });

    createProduct({
      sku: "HIGH-001",
      name: "Well Stocked Item",
      quantity_on_hand: 100,
      reorder_level: 10,
    });

    const lowStock = getLowStockProducts();
    expect(lowStock.some((p) => p.sku === "LOW-001")).toBe(true);
    expect(lowStock.some((p) => p.sku === "HIGH-001")).toBe(false);
  });
});

describe("Inventory Value", () => {
  test("calculate inventory value", () => {
    const value = getInventoryValue();
    expect(value.total_products).toBeGreaterThan(0);
    expect(typeof value.total_quantity).toBe("number");
    expect(typeof value.total_cost_value).toBe("number");
    expect(typeof value.total_retail_value).toBe("number");
  });
});

describe("Locations", () => {
  test("create and list locations", () => {
    const location = createLocation({
      name: "Warehouse A",
      description: "Main warehouse",
    });

    expect(location.id).toBeTruthy();
    expect(location.name).toBe("Warehouse A");
    expect(location.description).toBe("Main warehouse");

    const locations = listLocations();
    expect(locations.length).toBeGreaterThanOrEqual(1);
  });

  test("search locations", () => {
    createLocation({ name: "Warehouse B" });
    createLocation({ name: "Store Front" });

    const results = listLocations("Warehouse");
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((l) => l.name.includes("Warehouse"))).toBe(true);
  });
});
