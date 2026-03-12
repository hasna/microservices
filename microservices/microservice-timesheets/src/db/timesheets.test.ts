import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "microservice-timesheets-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  logTime,
  getEntry,
  listEntries,
  updateEntry,
  deleteEntry,
  getProjectSummary,
  getWeeklySummary,
  getClientSummary,
} from "./timesheets";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Projects", () => {
  test("create and get project", () => {
    const project = createProject({
      name: "Website Redesign",
      client: "Acme Corp",
      hourly_rate: 150,
      budget_hours: 100,
    });

    expect(project.id).toBeTruthy();
    expect(project.name).toBe("Website Redesign");
    expect(project.client).toBe("Acme Corp");
    expect(project.hourly_rate).toBe(150);
    expect(project.budget_hours).toBe(100);
    expect(project.status).toBe("active");

    const fetched = getProject(project.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(project.id);
  });

  test("list projects", () => {
    createProject({ name: "Mobile App", client: "Beta Inc" });
    const all = listProjects();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("filter projects by status", () => {
    const completed = createProject({
      name: "Old Project",
      status: "completed",
    });
    const active = listProjects({ status: "active" });
    expect(active.every((p) => p.status === "active")).toBe(true);
    expect(active.find((p) => p.id === completed.id)).toBeUndefined();
  });

  test("filter projects by client", () => {
    const results = listProjects({ client: "Acme Corp" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((p) => p.client === "Acme Corp")).toBe(true);
  });

  test("update project", () => {
    const project = createProject({ name: "Update Me" });
    const updated = updateProject(project.id, {
      name: "Updated Project",
      hourly_rate: 200,
      status: "completed",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Project");
    expect(updated!.hourly_rate).toBe(200);
    expect(updated!.status).toBe("completed");
  });

  test("delete project", () => {
    const project = createProject({ name: "Delete Me" });
    expect(deleteProject(project.id)).toBe(true);
    expect(getProject(project.id)).toBeNull();
  });
});

describe("Time Entries", () => {
  let projectId: string;

  test("log time entry", () => {
    const project = createProject({
      name: "Time Test Project",
      hourly_rate: 100,
      budget_hours: 40,
    });
    projectId = project.id;

    const entry = logTime({
      project_id: projectId,
      description: "Initial setup",
      date: "2025-01-06",
      hours: 2.5,
      billable: true,
      tags: ["setup", "devops"],
    });

    expect(entry.id).toBeTruthy();
    expect(entry.project_id).toBe(projectId);
    expect(entry.description).toBe("Initial setup");
    expect(entry.hours).toBe(2.5);
    expect(entry.billable).toBe(true);
    expect(entry.tags).toEqual(["setup", "devops"]);
  });

  test("get time entry", () => {
    const entry = logTime({
      project_id: projectId,
      description: "Code review",
      hours: 1,
    });

    const fetched = getEntry(entry.id);
    expect(fetched).toBeDefined();
    expect(fetched!.description).toBe("Code review");
  });

  test("list entries by project", () => {
    const entries = listEntries({ project_id: projectId });
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every((e) => e.project_id === projectId)).toBe(true);
  });

  test("list entries by date range", () => {
    logTime({
      project_id: projectId,
      description: "Date test",
      date: "2025-01-07",
      hours: 3,
    });

    const entries = listEntries({
      from_date: "2025-01-06",
      to_date: "2025-01-06",
    });
    expect(entries.every((e) => e.date === "2025-01-06")).toBe(true);
  });

  test("list entries by billable", () => {
    logTime({
      project_id: projectId,
      description: "Non-billable task",
      hours: 0.5,
      billable: false,
    });

    const billable = listEntries({ billable: true });
    expect(billable.every((e) => e.billable === true)).toBe(true);

    const nonBillable = listEntries({ billable: false });
    expect(nonBillable.every((e) => e.billable === false)).toBe(true);
    expect(nonBillable.length).toBeGreaterThanOrEqual(1);
  });

  test("update entry", () => {
    const entry = logTime({
      project_id: projectId,
      description: "Original",
      hours: 1,
    });

    const updated = updateEntry(entry.id, {
      description: "Updated description",
      hours: 2,
      billable: false,
      tags: ["updated"],
    });

    expect(updated).toBeDefined();
    expect(updated!.description).toBe("Updated description");
    expect(updated!.hours).toBe(2);
    expect(updated!.billable).toBe(false);
    expect(updated!.tags).toEqual(["updated"]);
  });

  test("delete entry", () => {
    const entry = logTime({
      project_id: projectId,
      description: "Delete me",
      hours: 0.5,
    });
    expect(deleteEntry(entry.id)).toBe(true);
    expect(getEntry(entry.id)).toBeNull();
  });
});

describe("Summaries", () => {
  test("project summary", () => {
    const project = createProject({
      name: "Summary Test",
      client: "Summary Client",
      hourly_rate: 100,
      budget_hours: 20,
    });

    logTime({
      project_id: project.id,
      description: "Billable work",
      hours: 5,
      billable: true,
    });
    logTime({
      project_id: project.id,
      description: "Non-billable work",
      hours: 2,
      billable: false,
    });

    const summary = getProjectSummary(project.id);
    expect(summary).toBeDefined();
    expect(summary!.project_name).toBe("Summary Test");
    expect(summary!.total_hours).toBe(7);
    expect(summary!.billable_hours).toBe(5);
    expect(summary!.non_billable_hours).toBe(2);
    expect(summary!.total_value).toBe(500); // 5 billable hours * $100
    expect(summary!.budget_remaining).toBe(13); // 20 - 7
  });

  test("project summary returns null for missing project", () => {
    const summary = getProjectSummary("nonexistent");
    expect(summary).toBeNull();
  });

  test("weekly summary", () => {
    const project = createProject({ name: "Weekly Test" });

    logTime({
      project_id: project.id,
      description: "Monday work",
      date: "2025-01-06",
      hours: 8,
    });
    logTime({
      project_id: project.id,
      description: "Tuesday work",
      date: "2025-01-07",
      hours: 6,
    });

    const summary = getWeeklySummary("2025-01-06");
    expect(summary.week_start).toBe("2025-01-06");
    expect(summary.days.length).toBe(7);
    expect(summary.total_hours).toBeGreaterThanOrEqual(14);
    expect(summary.total_entries).toBeGreaterThanOrEqual(2);

    const monday = summary.days.find((d) => d.date === "2025-01-06");
    expect(monday).toBeDefined();
    expect(monday!.hours).toBeGreaterThanOrEqual(8);
  });

  test("client summary", () => {
    const summaries = getClientSummary();
    expect(summaries.length).toBeGreaterThanOrEqual(1);

    for (const s of summaries) {
      expect(s.client).toBeTruthy();
      expect(typeof s.projects).toBe("number");
      expect(typeof s.total_hours).toBe("number");
      expect(typeof s.billable_hours).toBe("number");
      expect(typeof s.total_value).toBe("number");
    }
  });
});
