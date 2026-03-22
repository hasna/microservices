import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-proposals-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createProposal,
  getProposal,
  listProposals,
  updateProposal,
  deleteProposal,
  sendProposal,
  markViewed,
  acceptProposal,
  declineProposal,
  convertToInvoice,
  listExpiring,
  getProposalStats,
  searchProposals,
  countProposals,
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  useTemplate,
  type ProposalItem,
} from "./proposals";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

const sampleItems: ProposalItem[] = [
  { description: "Web Design", quantity: 1, unit_price: 5000, amount: 5000 },
  { description: "Development", quantity: 40, unit_price: 150, amount: 6000 },
];

describe("Proposal CRUD", () => {
  test("create and get proposal", () => {
    const proposal = createProposal({
      title: "Website Redesign",
      client_name: "Acme Corp",
      client_email: "contact@acme.com",
      items: sampleItems,
      tax_rate: 10,
      discount: 500,
    });

    expect(proposal.id).toBeTruthy();
    expect(proposal.title).toBe("Website Redesign");
    expect(proposal.client_name).toBe("Acme Corp");
    expect(proposal.client_email).toBe("contact@acme.com");
    expect(proposal.status).toBe("draft");
    expect(proposal.items).toEqual(sampleItems);
    expect(proposal.subtotal).toBe(11000);
    expect(proposal.tax_rate).toBe(10);
    expect(proposal.discount).toBe(500);
    // tax_amount = (11000 - 500) * 0.10 = 1050
    expect(proposal.tax_amount).toBe(1050);
    // total = 11000 - 500 + 1050 = 11550
    expect(proposal.total).toBe(11550);
    expect(proposal.currency).toBe("USD");

    const fetched = getProposal(proposal.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(proposal.id);
    expect(fetched!.items).toEqual(sampleItems);
  });

  test("create proposal with defaults", () => {
    const proposal = createProposal({
      title: "Simple Proposal",
      client_name: "Bob Inc",
    });

    expect(proposal.status).toBe("draft");
    expect(proposal.items).toEqual([]);
    expect(proposal.subtotal).toBe(0);
    expect(proposal.total).toBe(0);
    expect(proposal.currency).toBe("USD");
    expect(proposal.tax_rate).toBe(0);
    expect(proposal.discount).toBe(0);
  });

  test("list proposals", () => {
    const all = listProposals();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list proposals with status filter", () => {
    const drafts = listProposals({ status: "draft" });
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    expect(drafts.every((p) => p.status === "draft")).toBe(true);
  });

  test("list proposals with client_name filter", () => {
    const results = listProposals({ client_name: "Acme Corp" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((p) => p.client_name === "Acme Corp")).toBe(true);
  });

  test("search proposals", () => {
    const results = searchProposals("Website");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toContain("Website");
  });

  test("update proposal", () => {
    const proposal = createProposal({
      title: "Draft Proposal",
      client_name: "Test Co",
    });

    const updated = updateProposal(proposal.id, {
      title: "Updated Proposal",
      notes: "Added notes",
      terms: "Net 30",
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("Updated Proposal");
    expect(updated!.notes).toBe("Added notes");
    expect(updated!.terms).toBe("Net 30");
  });

  test("update proposal items recalculates totals", () => {
    const proposal = createProposal({
      title: "Recalc Test",
      client_name: "Math Co",
      items: [{ description: "Item A", quantity: 1, unit_price: 100, amount: 100 }],
      tax_rate: 10,
    });

    expect(proposal.subtotal).toBe(100);
    expect(proposal.total).toBe(110); // 100 + 10% tax

    const updated = updateProposal(proposal.id, {
      items: [
        { description: "Item A", quantity: 2, unit_price: 100, amount: 200 },
        { description: "Item B", quantity: 1, unit_price: 50, amount: 50 },
      ],
    });

    expect(updated!.subtotal).toBe(250);
    expect(updated!.tax_amount).toBe(25); // 250 * 10%
    expect(updated!.total).toBe(275); // 250 + 25
  });

  test("update non-existent proposal returns null", () => {
    const result = updateProposal("non-existent-id", { title: "Nope" });
    expect(result).toBeNull();
  });

  test("delete proposal", () => {
    const proposal = createProposal({
      title: "Delete Me",
      client_name: "Bye Co",
    });
    expect(deleteProposal(proposal.id)).toBe(true);
    expect(getProposal(proposal.id)).toBeNull();
  });

  test("delete non-existent proposal returns false", () => {
    expect(deleteProposal("non-existent-id")).toBe(false);
  });

  test("count proposals", () => {
    const count = countProposals();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("get non-existent proposal returns null", () => {
    expect(getProposal("non-existent-id")).toBeNull();
  });
});

describe("Proposal Workflow", () => {
  test("send proposal sets status and sent_at", () => {
    const proposal = createProposal({
      title: "Send Test",
      client_name: "Send Co",
    });

    const sent = sendProposal(proposal.id);
    expect(sent).toBeDefined();
    expect(sent!.status).toBe("sent");
    expect(sent!.sent_at).toBeTruthy();
  });

  test("mark proposal as viewed", () => {
    const proposal = createProposal({
      title: "View Test",
      client_name: "View Co",
    });
    sendProposal(proposal.id);

    const viewed = markViewed(proposal.id);
    expect(viewed).toBeDefined();
    expect(viewed!.status).toBe("viewed");
    expect(viewed!.viewed_at).toBeTruthy();
  });

  test("accept proposal sets responded_at", () => {
    const proposal = createProposal({
      title: "Accept Test",
      client_name: "Accept Co",
      items: [{ description: "Service", quantity: 1, unit_price: 1000, amount: 1000 }],
    });

    const accepted = acceptProposal(proposal.id);
    expect(accepted).toBeDefined();
    expect(accepted!.status).toBe("accepted");
    expect(accepted!.responded_at).toBeTruthy();
  });

  test("decline proposal with reason", () => {
    const proposal = createProposal({
      title: "Decline Test",
      client_name: "Decline Co",
    });

    const declined = declineProposal(proposal.id, "Too expensive");
    expect(declined).toBeDefined();
    expect(declined!.status).toBe("declined");
    expect(declined!.responded_at).toBeTruthy();
    expect(declined!.metadata.decline_reason).toBe("Too expensive");
  });

  test("decline proposal without reason", () => {
    const proposal = createProposal({
      title: "Decline No Reason",
      client_name: "Silent Co",
    });

    const declined = declineProposal(proposal.id);
    expect(declined).toBeDefined();
    expect(declined!.status).toBe("declined");
    expect(declined!.metadata.decline_reason).toBeNull();
  });

  test("send non-existent proposal returns null", () => {
    expect(sendProposal("non-existent-id")).toBeNull();
  });

  test("accept non-existent proposal returns null", () => {
    expect(acceptProposal("non-existent-id")).toBeNull();
  });

  test("decline non-existent proposal returns null", () => {
    expect(declineProposal("non-existent-id")).toBeNull();
  });

  test("mark viewed non-existent proposal returns null", () => {
    expect(markViewed("non-existent-id")).toBeNull();
  });
});

describe("Convert to Invoice", () => {
  test("convert proposal to invoice data", () => {
    const proposal = createProposal({
      title: "Invoice Convert Test",
      client_name: "Invoice Co",
      client_email: "billing@invoice.co",
      items: sampleItems,
      tax_rate: 8,
      discount: 200,
      notes: "Thank you",
      terms: "Due on receipt",
    });

    const invoiceData = convertToInvoice(proposal.id);
    expect(invoiceData).toBeDefined();
    expect(invoiceData!.client_name).toBe("Invoice Co");
    expect(invoiceData!.client_email).toBe("billing@invoice.co");
    expect(invoiceData!.items).toEqual(sampleItems);
    expect(invoiceData!.proposal_id).toBe(proposal.id);
    expect(invoiceData!.total).toBe(proposal.total);
    expect(invoiceData!.notes).toBe("Thank you");
    expect(invoiceData!.terms).toBe("Due on receipt");
  });

  test("convert non-existent proposal returns null", () => {
    expect(convertToInvoice("non-existent-id")).toBeNull();
  });
});

describe("Expiring Proposals", () => {
  test("listExpiring returns proposals within range", () => {
    // Create a proposal that expires tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    createProposal({
      title: "Expiring Soon",
      client_name: "Urgent Co",
      valid_until: tomorrowStr,
    });

    const expiring = listExpiring(7);
    expect(expiring.length).toBeGreaterThanOrEqual(1);
    expect(expiring.some((p) => p.title === "Expiring Soon")).toBe(true);
  });
});

describe("Proposal Stats", () => {
  test("get proposal stats", () => {
    const stats = getProposalStats();
    expect(stats.total).toBeGreaterThanOrEqual(5);
    expect(stats.by_status).toBeDefined();
    expect(typeof stats.by_status.draft).toBe("number");
    expect(typeof stats.by_status.accepted).toBe("number");
    expect(typeof stats.by_status.declined).toBe("number");
    expect(typeof stats.total_value).toBe("number");
    expect(typeof stats.average_value).toBe("number");
    expect(typeof stats.conversion_rate).toBe("number");
    expect(typeof stats.accepted_value).toBe("number");
  });

  test("conversion rate calculation", () => {
    // We have at least 1 accepted and 2 declined from earlier tests
    const stats = getProposalStats();
    const decided = stats.by_status.accepted + stats.by_status.declined;
    if (decided > 0) {
      const expectedRate = (stats.by_status.accepted / decided) * 100;
      expect(stats.conversion_rate).toBeCloseTo(expectedRate, 1);
    }
  });
});

describe("Templates", () => {
  test("create and get template", () => {
    const template = createTemplate({
      name: "Standard Web Project",
      items: sampleItems,
      terms: "Net 30",
      notes: "Standard web project template",
    });

    expect(template.id).toBeTruthy();
    expect(template.name).toBe("Standard Web Project");
    expect(template.items).toEqual(sampleItems);
    expect(template.terms).toBe("Net 30");

    const fetched = getTemplate(template.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Standard Web Project");
  });

  test("list templates", () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(1);
  });

  test("use template to create proposal", () => {
    const template = createTemplate({
      name: "Consulting Template",
      items: [{ description: "Consulting", quantity: 10, unit_price: 200, amount: 2000 }],
      terms: "Net 15",
      notes: "Consulting engagement",
    });

    const proposal = useTemplate(template.id, {
      title: "Consulting for BigCo",
      client_name: "BigCo",
      client_email: "cfo@bigco.com",
      valid_until: "2026-12-31",
    });

    expect(proposal).toBeDefined();
    expect(proposal!.title).toBe("Consulting for BigCo");
    expect(proposal!.client_name).toBe("BigCo");
    expect(proposal!.client_email).toBe("cfo@bigco.com");
    expect(proposal!.items).toEqual(template.items);
    expect(proposal!.terms).toBe("Net 15");
    expect(proposal!.notes).toBe("Consulting engagement");
    expect(proposal!.valid_until).toBe("2026-12-31");
  });

  test("use non-existent template returns null", () => {
    const proposal = useTemplate("non-existent-id", {
      title: "Nope",
      client_name: "Nobody",
    });
    expect(proposal).toBeNull();
  });

  test("delete template", () => {
    const template = createTemplate({ name: "Delete Me Template" });
    expect(deleteTemplate(template.id)).toBe(true);
    expect(getTemplate(template.id)).toBeNull();
  });

  test("delete non-existent template returns false", () => {
    expect(deleteTemplate("non-existent-id")).toBe(false);
  });
});
