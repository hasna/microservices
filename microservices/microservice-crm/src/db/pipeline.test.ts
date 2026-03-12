import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "microservice-crm-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createPipeline,
  listPipelines,
  createStage,
  listStages,
  createDeal,
  getDeal,
  listDeals,
  updateDeal,
  moveDeal,
  closeDeal,
  deleteDeal,
  addActivity,
  listActivities,
  getPipelineSummary,
} from "./pipeline";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// Helpers to create a pipeline + stages for deal tests
function setupPipeline() {
  const pipeline = createPipeline({ name: "Sales", description: "Main sales pipeline" });
  const lead = createStage({ pipeline_id: pipeline.id, name: "Lead" });
  const qualified = createStage({ pipeline_id: pipeline.id, name: "Qualified" });
  const proposal = createStage({ pipeline_id: pipeline.id, name: "Proposal" });
  const closed = createStage({ pipeline_id: pipeline.id, name: "Closed" });
  return { pipeline, stages: { lead, qualified, proposal, closed } };
}

describe("Pipelines", () => {
  test("create and list pipelines", () => {
    const pipeline = createPipeline({
      name: "Test Pipeline",
      description: "A test pipeline",
    });

    expect(pipeline.id).toBeTruthy();
    expect(pipeline.name).toBe("Test Pipeline");
    expect(pipeline.description).toBe("A test pipeline");

    const all = listPipelines();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Stages", () => {
  test("create stages with auto sort order", () => {
    const pipeline = createPipeline({ name: "Stage Test Pipeline" });

    const s1 = createStage({ pipeline_id: pipeline.id, name: "Lead" });
    const s2 = createStage({ pipeline_id: pipeline.id, name: "Qualified" });
    const s3 = createStage({ pipeline_id: pipeline.id, name: "Closed" });

    expect(s1.sort_order).toBe(0);
    expect(s2.sort_order).toBe(1);
    expect(s3.sort_order).toBe(2);
  });

  test("create stage with explicit sort order", () => {
    const pipeline = createPipeline({ name: "Explicit Sort Pipeline" });
    const stage = createStage({ pipeline_id: pipeline.id, name: "Custom", sort_order: 10 });
    expect(stage.sort_order).toBe(10);
  });

  test("list stages ordered by sort_order", () => {
    const pipeline = createPipeline({ name: "List Stages Pipeline" });
    createStage({ pipeline_id: pipeline.id, name: "Third", sort_order: 2 });
    createStage({ pipeline_id: pipeline.id, name: "First", sort_order: 0 });
    createStage({ pipeline_id: pipeline.id, name: "Second", sort_order: 1 });

    const stages = listStages(pipeline.id);
    expect(stages.length).toBe(3);
    expect(stages[0].name).toBe("First");
    expect(stages[1].name).toBe("Second");
    expect(stages[2].name).toBe("Third");
  });
});

describe("Deals", () => {
  test("create and get deal", () => {
    const { pipeline, stages } = setupPipeline();

    const deal = createDeal({
      pipeline_id: pipeline.id,
      stage_id: stages.lead.id,
      title: "Big Deal",
      value: 50000,
      currency: "USD",
      contact_name: "Alice Smith",
      contact_email: "alice@example.com",
      probability: 30,
      expected_close_date: "2026-06-15",
      notes: "Initial contact made",
    });

    expect(deal.id).toBeTruthy();
    expect(deal.title).toBe("Big Deal");
    expect(deal.value).toBe(50000);
    expect(deal.status).toBe("open");
    expect(deal.probability).toBe(30);
    expect(deal.contact_name).toBe("Alice Smith");

    const fetched = getDeal(deal.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(deal.id);
  });

  test("list deals with filters", () => {
    const { pipeline, stages } = setupPipeline();

    createDeal({ pipeline_id: pipeline.id, stage_id: stages.lead.id, title: "Deal A", value: 1000 });
    createDeal({ pipeline_id: pipeline.id, stage_id: stages.qualified.id, title: "Deal B", value: 2000 });
    createDeal({ pipeline_id: pipeline.id, stage_id: stages.lead.id, title: "Deal C", value: 3000 });

    const allDeals = listDeals({ pipeline_id: pipeline.id });
    expect(allDeals.length).toBe(3);

    const leadDeals = listDeals({ stage_id: stages.lead.id });
    expect(leadDeals.length).toBe(2);

    const limited = listDeals({ pipeline_id: pipeline.id, limit: 1 });
    expect(limited.length).toBe(1);
  });

  test("update deal", () => {
    const { pipeline, stages } = setupPipeline();
    const deal = createDeal({
      pipeline_id: pipeline.id,
      stage_id: stages.lead.id,
      title: "Update Me",
      value: 1000,
    });

    const updated = updateDeal(deal.id, {
      title: "Updated Deal",
      value: 5000,
      probability: 60,
      notes: "Updated notes",
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("Updated Deal");
    expect(updated!.value).toBe(5000);
    expect(updated!.probability).toBe(60);
    expect(updated!.notes).toBe("Updated notes");
  });

  test("update non-existent deal returns null", () => {
    const result = updateDeal("non-existent-id", { title: "Nope" });
    expect(result).toBeNull();
  });

  test("move deal to different stage", () => {
    const { pipeline, stages } = setupPipeline();
    const deal = createDeal({
      pipeline_id: pipeline.id,
      stage_id: stages.lead.id,
      title: "Move Me",
    });

    expect(deal.stage_id).toBe(stages.lead.id);

    const moved = moveDeal(deal.id, stages.qualified.id);
    expect(moved).toBeDefined();
    expect(moved!.stage_id).toBe(stages.qualified.id);
  });

  test("close deal as won", () => {
    const { pipeline, stages } = setupPipeline();
    const deal = createDeal({
      pipeline_id: pipeline.id,
      stage_id: stages.proposal.id,
      title: "Win This",
      value: 10000,
    });

    const won = closeDeal(deal.id, "won");
    expect(won).toBeDefined();
    expect(won!.status).toBe("won");
    expect(won!.closed_at).toBeTruthy();
  });

  test("close deal as lost", () => {
    const { pipeline, stages } = setupPipeline();
    const deal = createDeal({
      pipeline_id: pipeline.id,
      stage_id: stages.lead.id,
      title: "Lose This",
      value: 5000,
    });

    const lost = closeDeal(deal.id, "lost");
    expect(lost).toBeDefined();
    expect(lost!.status).toBe("lost");
    expect(lost!.closed_at).toBeTruthy();
  });

  test("delete deal", () => {
    const { pipeline, stages } = setupPipeline();
    const deal = createDeal({
      pipeline_id: pipeline.id,
      stage_id: stages.lead.id,
      title: "Delete Me",
    });

    expect(deleteDeal(deal.id)).toBe(true);
    expect(getDeal(deal.id)).toBeNull();
  });

  test("delete non-existent deal returns false", () => {
    expect(deleteDeal("non-existent-id")).toBe(false);
  });

  test("list deals by status", () => {
    const { pipeline, stages } = setupPipeline();

    const deal1 = createDeal({ pipeline_id: pipeline.id, stage_id: stages.lead.id, title: "Open Deal" });
    const deal2 = createDeal({ pipeline_id: pipeline.id, stage_id: stages.lead.id, title: "Won Deal" });
    closeDeal(deal2.id, "won");

    const openDeals = listDeals({ pipeline_id: pipeline.id, status: "open" });
    expect(openDeals.every((d) => d.status === "open")).toBe(true);
    expect(openDeals.some((d) => d.id === deal1.id)).toBe(true);

    const wonDeals = listDeals({ pipeline_id: pipeline.id, status: "won" });
    expect(wonDeals.every((d) => d.status === "won")).toBe(true);
    expect(wonDeals.some((d) => d.id === deal2.id)).toBe(true);
  });
});

describe("Activities", () => {
  test("add and list activities", () => {
    const { pipeline, stages } = setupPipeline();
    const deal = createDeal({
      pipeline_id: pipeline.id,
      stage_id: stages.lead.id,
      title: "Activity Deal",
    });

    const note = addActivity({ deal_id: deal.id, type: "note", description: "Initial call went well" });
    const call = addActivity({ deal_id: deal.id, type: "call", description: "Follow-up call" });
    const email = addActivity({ deal_id: deal.id, type: "email", description: "Sent proposal" });
    const meeting = addActivity({ deal_id: deal.id, type: "meeting", description: "Demo meeting" });

    expect(note.id).toBeTruthy();
    expect(note.type).toBe("note");
    expect(call.type).toBe("call");
    expect(email.type).toBe("email");
    expect(meeting.type).toBe("meeting");

    const activities = listActivities(deal.id);
    expect(activities.length).toBe(4);
  });

  test("activity defaults to note type", () => {
    const { pipeline, stages } = setupPipeline();
    const deal = createDeal({
      pipeline_id: pipeline.id,
      stage_id: stages.lead.id,
      title: "Default Activity Deal",
    });

    const activity = addActivity({ deal_id: deal.id, description: "Default note" });
    expect(activity.type).toBe("note");
  });
});

describe("Pipeline Summary", () => {
  test("get pipeline summary with deals per stage", () => {
    const { pipeline, stages } = setupPipeline();

    createDeal({ pipeline_id: pipeline.id, stage_id: stages.lead.id, title: "Lead 1", value: 10000, probability: 20 });
    createDeal({ pipeline_id: pipeline.id, stage_id: stages.lead.id, title: "Lead 2", value: 5000, probability: 30 });
    createDeal({ pipeline_id: pipeline.id, stage_id: stages.qualified.id, title: "Qual 1", value: 25000, probability: 50 });
    const wonDeal = createDeal({ pipeline_id: pipeline.id, stage_id: stages.closed.id, title: "Won Deal", value: 50000, probability: 100 });
    closeDeal(wonDeal.id, "won");

    const summary = getPipelineSummary(pipeline.id);
    expect(summary).toBeDefined();
    expect(summary!.pipeline_name).toBe("Sales");
    expect(summary!.total_deals).toBe(4);
    expect(summary!.open_deals).toBe(3);
    expect(summary!.won_deals).toBe(1);
    expect(summary!.lost_deals).toBe(0);
    expect(summary!.total_value).toBe(90000);
    expect(summary!.stages.length).toBe(4);

    // Lead stage should have 2 open deals
    const leadStage = summary!.stages.find((s) => s.stage_name === "Lead");
    expect(leadStage).toBeDefined();
    expect(leadStage!.deal_count).toBe(2);
    expect(leadStage!.total_value).toBe(15000);
  });

  test("non-existent pipeline returns null", () => {
    const summary = getPipelineSummary("non-existent-id");
    expect(summary).toBeNull();
  });
});
