import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-projects-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  searchProjects,
} from "./projects";
import {
  createMilestone,
  getMilestone,
  listMilestones,
  updateMilestone,
  completeMilestone,
  deleteMilestone,
} from "./projects";
import {
  createDeliverable,
  getDeliverable,
  listDeliverables,
  updateDeliverable,
  completeDeliverable,
  deleteDeliverable,
} from "./projects";
import {
  getProjectTimeline,
  getBudgetVsActual,
  getOverdueProjects,
  getOverdueMilestones,
  getProjectStats,
  getMilestoneProgress,
} from "./projects";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// --- Projects ---

describe("Projects", () => {
  test("create and get project", () => {
    const project = createProject({
      name: "Website Redesign",
      description: "Redesign the company website",
      client: "Acme Corp",
      budget: 50000,
      currency: "USD",
      owner: "Alice",
      tags: ["web", "design"],
    });

    expect(project.id).toBeTruthy();
    expect(project.name).toBe("Website Redesign");
    expect(project.description).toBe("Redesign the company website");
    expect(project.client).toBe("Acme Corp");
    expect(project.status).toBe("planning");
    expect(project.budget).toBe(50000);
    expect(project.spent).toBe(0);
    expect(project.currency).toBe("USD");
    expect(project.owner).toBe("Alice");
    expect(project.tags).toEqual(["web", "design"]);

    const fetched = getProject(project.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(project.id);
    expect(fetched!.name).toBe("Website Redesign");
  });

  test("create project with minimal fields", () => {
    const project = createProject({ name: "Minimal Project" });
    expect(project.name).toBe("Minimal Project");
    expect(project.status).toBe("planning");
    expect(project.spent).toBe(0);
    expect(project.currency).toBe("USD");
    expect(project.tags).toEqual([]);
    expect(project.metadata).toEqual({});
  });

  test("list projects", () => {
    const all = listProjects();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list projects with status filter", () => {
    createProject({ name: "Active Project", status: "active" });
    const active = listProjects({ status: "active" });
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active.every((p) => p.status === "active")).toBe(true);
  });

  test("list projects with client filter", () => {
    const acme = listProjects({ client: "Acme Corp" });
    expect(acme.length).toBeGreaterThanOrEqual(1);
    expect(acme.every((p) => p.client === "Acme Corp")).toBe(true);
  });

  test("search projects", () => {
    const results = searchProjects("Redesign");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toContain("Redesign");
  });

  test("update project", () => {
    const project = createProject({ name: "To Update" });
    const updated = updateProject(project.id, {
      name: "Updated Name",
      status: "active",
      budget: 25000,
      spent: 5000,
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Name");
    expect(updated!.status).toBe("active");
    expect(updated!.budget).toBe(25000);
    expect(updated!.spent).toBe(5000);
  });

  test("update nonexistent project returns null", () => {
    const result = updateProject("nonexistent-id", { name: "Nope" });
    expect(result).toBeNull();
  });

  test("delete project", () => {
    const project = createProject({ name: "DeleteMe" });
    expect(deleteProject(project.id)).toBe(true);
    expect(getProject(project.id)).toBeNull();
  });

  test("delete nonexistent project returns false", () => {
    expect(deleteProject("nonexistent-id")).toBe(false);
  });

  test("get nonexistent project returns null", () => {
    expect(getProject("nonexistent-id")).toBeNull();
  });
});

// --- Milestones ---

describe("Milestones", () => {
  test("create and get milestone", () => {
    const project = createProject({ name: "MS Project" });
    const milestone = createMilestone({
      project_id: project.id,
      name: "Phase 1",
      description: "Discovery and planning",
      due_date: "2026-06-01",
    });

    expect(milestone.id).toBeTruthy();
    expect(milestone.project_id).toBe(project.id);
    expect(milestone.name).toBe("Phase 1");
    expect(milestone.status).toBe("pending");
    expect(milestone.due_date).toBe("2026-06-01");

    const fetched = getMilestone(milestone.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Phase 1");
  });

  test("list milestones by project", () => {
    const project = createProject({ name: "List MS Project" });
    createMilestone({ project_id: project.id, name: "M1" });
    createMilestone({ project_id: project.id, name: "M2" });

    const milestones = listMilestones({ project_id: project.id });
    expect(milestones.length).toBe(2);
  });

  test("update milestone", () => {
    const project = createProject({ name: "Update MS Project" });
    const milestone = createMilestone({ project_id: project.id, name: "To Update" });
    const updated = updateMilestone(milestone.id, {
      name: "Updated Milestone",
      status: "in_progress",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Milestone");
    expect(updated!.status).toBe("in_progress");
  });

  test("complete milestone", () => {
    const project = createProject({ name: "Complete MS Project" });
    const milestone = createMilestone({ project_id: project.id, name: "To Complete" });
    const completed = completeMilestone(milestone.id);

    expect(completed).toBeDefined();
    expect(completed!.status).toBe("completed");
    expect(completed!.completed_at).toBeTruthy();
  });

  test("delete milestone", () => {
    const project = createProject({ name: "Delete MS Project" });
    const milestone = createMilestone({ project_id: project.id, name: "To Delete" });
    expect(deleteMilestone(milestone.id)).toBe(true);
    expect(getMilestone(milestone.id)).toBeNull();
  });

  test("get nonexistent milestone returns null", () => {
    expect(getMilestone("nonexistent-id")).toBeNull();
  });
});

// --- Deliverables ---

describe("Deliverables", () => {
  test("create and get deliverable", () => {
    const project = createProject({ name: "Del Project" });
    const milestone = createMilestone({ project_id: project.id, name: "Del MS" });
    const deliverable = createDeliverable({
      milestone_id: milestone.id,
      name: "Wireframes",
      description: "Create UI wireframes",
      assignee: "Bob",
      due_date: "2026-05-15",
    });

    expect(deliverable.id).toBeTruthy();
    expect(deliverable.milestone_id).toBe(milestone.id);
    expect(deliverable.name).toBe("Wireframes");
    expect(deliverable.status).toBe("pending");
    expect(deliverable.assignee).toBe("Bob");

    const fetched = getDeliverable(deliverable.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Wireframes");
  });

  test("list deliverables by milestone", () => {
    const project = createProject({ name: "List Del Project" });
    const milestone = createMilestone({ project_id: project.id, name: "List Del MS" });
    createDeliverable({ milestone_id: milestone.id, name: "D1" });
    createDeliverable({ milestone_id: milestone.id, name: "D2" });

    const deliverables = listDeliverables({ milestone_id: milestone.id });
    expect(deliverables.length).toBe(2);
  });

  test("list deliverables by assignee", () => {
    const project = createProject({ name: "Assignee Del Project" });
    const milestone = createMilestone({ project_id: project.id, name: "Assignee Del MS" });
    createDeliverable({ milestone_id: milestone.id, name: "Assigned D", assignee: "Charlie" });

    const deliverables = listDeliverables({ assignee: "Charlie" });
    expect(deliverables.length).toBeGreaterThanOrEqual(1);
    expect(deliverables.every((d) => d.assignee === "Charlie")).toBe(true);
  });

  test("update deliverable", () => {
    const project = createProject({ name: "Update Del Project" });
    const milestone = createMilestone({ project_id: project.id, name: "Update Del MS" });
    const deliverable = createDeliverable({ milestone_id: milestone.id, name: "To Update" });
    const updated = updateDeliverable(deliverable.id, {
      name: "Updated Deliverable",
      status: "in_progress",
      assignee: "Dave",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Deliverable");
    expect(updated!.status).toBe("in_progress");
    expect(updated!.assignee).toBe("Dave");
  });

  test("complete deliverable", () => {
    const project = createProject({ name: "Complete Del Project" });
    const milestone = createMilestone({ project_id: project.id, name: "Complete Del MS" });
    const deliverable = createDeliverable({ milestone_id: milestone.id, name: "To Complete" });
    const completed = completeDeliverable(deliverable.id);

    expect(completed).toBeDefined();
    expect(completed!.status).toBe("completed");
    expect(completed!.completed_at).toBeTruthy();
  });

  test("delete deliverable", () => {
    const project = createProject({ name: "Delete Del Project" });
    const milestone = createMilestone({ project_id: project.id, name: "Delete Del MS" });
    const deliverable = createDeliverable({ milestone_id: milestone.id, name: "To Delete" });
    expect(deleteDeliverable(deliverable.id)).toBe(true);
    expect(getDeliverable(deliverable.id)).toBeNull();
  });

  test("get nonexistent deliverable returns null", () => {
    expect(getDeliverable("nonexistent-id")).toBeNull();
  });

  test("cascade delete — deleting project removes milestones and deliverables", () => {
    const project = createProject({ name: "Cascade Project" });
    const milestone = createMilestone({ project_id: project.id, name: "Cascade MS" });
    const deliverable = createDeliverable({ milestone_id: milestone.id, name: "Cascade Del" });

    deleteProject(project.id);

    expect(getMilestone(milestone.id)).toBeNull();
    expect(getDeliverable(deliverable.id)).toBeNull();
  });
});

// --- Advanced Queries ---

describe("Advanced Queries", () => {
  test("getProjectTimeline returns milestones and deliverables", () => {
    const project = createProject({ name: "Timeline Project" });
    const m1 = createMilestone({ project_id: project.id, name: "TL M1", due_date: "2026-04-01" });
    const m2 = createMilestone({ project_id: project.id, name: "TL M2", due_date: "2026-05-01" });
    createDeliverable({ milestone_id: m1.id, name: "TL D1", due_date: "2026-03-15" });
    createDeliverable({ milestone_id: m2.id, name: "TL D2", due_date: "2026-04-15" });

    const timeline = getProjectTimeline(project.id);
    expect(timeline.length).toBe(4);
    expect(timeline[0].type).toBe("milestone");
    expect(timeline[0].name).toBe("TL M1");
    expect(timeline[1].type).toBe("deliverable");
    expect(timeline[1].name).toBe("TL D1");
    expect(timeline[2].type).toBe("milestone");
    expect(timeline[2].name).toBe("TL M2");
    expect(timeline[3].type).toBe("deliverable");
    expect(timeline[3].name).toBe("TL D2");
  });

  test("getBudgetVsActual shows budget report", () => {
    const project = createProject({ name: "Budget Project", budget: 100000, spent: 35000 });
    const report = getBudgetVsActual(project.id);

    expect(report).toBeDefined();
    expect(report!.budget).toBe(100000);
    expect(report!.spent).toBe(35000);
    expect(report!.remaining).toBe(65000);
    expect(report!.utilization_pct).toBe(35);
  });

  test("getBudgetVsActual with no budget", () => {
    const project = createProject({ name: "No Budget Project" });
    const report = getBudgetVsActual(project.id);

    expect(report).toBeDefined();
    expect(report!.budget).toBeNull();
    expect(report!.remaining).toBeNull();
    expect(report!.utilization_pct).toBeNull();
  });

  test("getBudgetVsActual for nonexistent project returns null", () => {
    expect(getBudgetVsActual("nonexistent-id")).toBeNull();
  });

  test("getOverdueProjects returns projects past end_date", () => {
    createProject({
      name: "Overdue Project",
      status: "active",
      end_date: "2020-01-01",
    });

    const overdue = getOverdueProjects();
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    expect(overdue.some((p) => p.name === "Overdue Project")).toBe(true);
  });

  test("getOverdueMilestones returns milestones past due_date", () => {
    const project = createProject({ name: "Overdue MS Project" });
    createMilestone({
      project_id: project.id,
      name: "Overdue Milestone",
      due_date: "2020-01-01",
    });

    const overdue = getOverdueMilestones();
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    expect(overdue.some((m) => m.name === "Overdue Milestone")).toBe(true);
  });

  test("getProjectStats returns stats", () => {
    const stats = getProjectStats();

    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(typeof stats.by_status).toBe("object");
    expect(typeof stats.total_budget).toBe("number");
    expect(typeof stats.total_spent).toBe("number");
  });

  test("getMilestoneProgress returns progress", () => {
    const project = createProject({ name: "Progress Project" });
    createMilestone({ project_id: project.id, name: "P M1" });
    const m2 = createMilestone({ project_id: project.id, name: "P M2" });
    completeMilestone(m2.id);

    const progress = getMilestoneProgress(project.id);
    expect(progress.project_id).toBe(project.id);
    expect(progress.total).toBe(2);
    expect(progress.completed).toBe(1);
    expect(progress.pending).toBe(1);
    expect(progress.completion_pct).toBe(50);
  });

  test("getMilestoneProgress with no milestones returns zero", () => {
    const project = createProject({ name: "Empty Progress Project" });
    const progress = getMilestoneProgress(project.id);
    expect(progress.total).toBe(0);
    expect(progress.completion_pct).toBe(0);
  });
});
