import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "microservice-invoices-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createInvoice,
  getInvoice,
  getInvoiceWithItems,
  listInvoices,
  updateInvoiceStatus,
  deleteInvoice,
  addLineItem,
  removeLineItem,
  recordPayment,
  getInvoiceSummary,
} from "./invoices";
import {
  createClient,
  getClient,
  listClients,
  deleteClient,
} from "./clients";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Invoices", () => {
  test("create invoice with auto-number", () => {
    const inv = createInvoice();
    expect(inv.id).toBeTruthy();
    expect(inv.invoice_number).toBe("INV-00001");
    expect(inv.status).toBe("draft");
    expect(inv.total).toBe(0);
  });

  test("create second invoice increments number", () => {
    const inv = createInvoice();
    expect(inv.invoice_number).toBe("INV-00002");
  });

  test("get invoice by ID", () => {
    const inv = createInvoice();
    const fetched = getInvoice(inv.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(inv.id);
  });

  test("get invoice by number", () => {
    const inv = createInvoice();
    const fetched = getInvoice(inv.invoice_number);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(inv.id);
  });

  test("add line items and recalculate", () => {
    const inv = createInvoice({ tax_rate: 10 });

    addLineItem({
      invoice_id: inv.id,
      description: "Service A",
      unit_price: 100,
      quantity: 2,
    });

    addLineItem({
      invoice_id: inv.id,
      description: "Service B",
      unit_price: 50,
    });

    const full = getInvoiceWithItems(inv.id)!;
    expect(full.line_items.length).toBe(2);
    expect(full.subtotal).toBe(250); // 200 + 50
    expect(full.tax_amount).toBe(25); // 250 * 10%
    expect(full.total).toBe(275); // 250 + 25
  });

  test("remove line item recalculates", () => {
    const inv = createInvoice();
    const item1 = addLineItem({
      invoice_id: inv.id,
      description: "Item 1",
      unit_price: 100,
    });
    addLineItem({
      invoice_id: inv.id,
      description: "Item 2",
      unit_price: 200,
    });

    removeLineItem(item1.id);

    const updated = getInvoice(inv.id)!;
    expect(updated.subtotal).toBe(200);
    expect(updated.total).toBe(200);
  });

  test("update status", () => {
    const inv = createInvoice();
    const updated = updateInvoiceStatus(inv.id, "sent");
    expect(updated!.status).toBe("sent");
  });

  test("mark as paid sets paid_at", () => {
    const inv = createInvoice();
    const paid = updateInvoiceStatus(inv.id, "paid");
    expect(paid!.status).toBe("paid");
    expect(paid!.paid_at).toBeTruthy();
  });

  test("record payment auto-marks as paid", () => {
    const inv = createInvoice();
    addLineItem({
      invoice_id: inv.id,
      description: "Work",
      unit_price: 500,
    });
    updateInvoiceStatus(inv.id, "sent");

    recordPayment({
      invoice_id: inv.id,
      amount: 500,
      method: "bank_transfer",
    });

    const final = getInvoice(inv.id)!;
    expect(final.status).toBe("paid");
  });

  test("list invoices with filters", () => {
    const drafts = listInvoices({ status: "draft" });
    expect(drafts.every((i) => i.status === "draft")).toBe(true);
  });

  test("delete invoice", () => {
    const inv = createInvoice();
    expect(deleteInvoice(inv.id)).toBe(true);
    expect(getInvoice(inv.id)).toBeNull();
  });

  test("invoice summary", () => {
    const summary = getInvoiceSummary();
    expect(summary.total_invoices).toBeGreaterThan(0);
    expect(typeof summary.draft).toBe("number");
    expect(typeof summary.total_outstanding).toBe("number");
  });
});

describe("Clients", () => {
  test("create and get client", () => {
    const client = createClient({
      name: "Test Client",
      email: "client@test.com",
    });
    expect(client.id).toBeTruthy();
    expect(client.name).toBe("Test Client");

    const fetched = getClient(client.id);
    expect(fetched).toBeDefined();
  });

  test("list clients", () => {
    const clients = listClients();
    expect(clients.length).toBeGreaterThanOrEqual(1);
  });

  test("search clients", () => {
    const results = listClients("Test Client");
    expect(results.length).toBe(1);
  });

  test("delete client", () => {
    const client = createClient({ name: "DeleteMe" });
    expect(deleteClient(client.id)).toBe(true);
    expect(getClient(client.id)).toBeNull();
  });
});
