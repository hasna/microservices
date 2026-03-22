#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  searchProjects,
  getProjectTimeline,
  getBudgetVsActual,
  getOverdueProjects,
  getOverdueMilestones,
  getProjectStats,
  getMilestoneProgress,
} from "../db/projects.js";
import {
  createMilestone,
  getMilestone,
  listMilestones,
  updateMilestone,
  completeMilestone,
  deleteMilestone,
} from "../db/projects.js";
import {
  createDeliverable,
  getDeliverable,
  listDeliverables,
  updateDeliverable,
  completeDeliverable,
  deleteDeliverable,
} from "../db/projects.js";

const server = new McpServer({
  name: "microservice-projects",
  version: "0.0.1",
});

// --- Projects ---

server.registerTool(
  "create_project",
  {
    title: "Create Project",
    description: "Create a new project.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
      client: z.string().optional(),
      status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]).optional(),
      budget: z.number().optional(),
      currency: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      owner: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const project = createProject(params);
    return { content: [{ type: "text", text: JSON.stringify(project, null, 2) }] };
  }
);

server.registerTool(
  "get_project",
  {
    title: "Get Project",
    description: "Get a project by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const project = getProject(id);
    if (!project) {
      return { content: [{ type: "text", text: `Project '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(project, null, 2) }] };
  }
);

server.registerTool(
  "list_projects",
  {
    title: "List Projects",
    description: "List projects with optional filters.",
    inputSchema: {
      status: z.string().optional(),
      client: z.string().optional(),
      owner: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const projects = listProjects(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ projects, count: projects.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_project",
  {
    title: "Update Project",
    description: "Update an existing project.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      client: z.string().optional(),
      status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]).optional(),
      budget: z.number().optional(),
      spent: z.number().optional(),
      currency: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      owner: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const project = updateProject(id, input);
    if (!project) {
      return { content: [{ type: "text", text: `Project '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(project, null, 2) }] };
  }
);

server.registerTool(
  "delete_project",
  {
    title: "Delete Project",
    description: "Delete a project by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteProject(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_projects",
  {
    title: "Search Projects",
    description: "Search projects by name, description, client, or owner.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchProjects(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

// --- Milestones ---

server.registerTool(
  "create_milestone",
  {
    title: "Create Milestone",
    description: "Create a new milestone for a project.",
    inputSchema: {
      project_id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      due_date: z.string().optional(),
    },
  },
  async (params) => {
    const milestone = createMilestone(params);
    return { content: [{ type: "text", text: JSON.stringify(milestone, null, 2) }] };
  }
);

server.registerTool(
  "get_milestone",
  {
    title: "Get Milestone",
    description: "Get a milestone by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const milestone = getMilestone(id);
    if (!milestone) {
      return { content: [{ type: "text", text: `Milestone '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(milestone, null, 2) }] };
  }
);

server.registerTool(
  "list_milestones",
  {
    title: "List Milestones",
    description: "List milestones with optional filters.",
    inputSchema: {
      project_id: z.string().optional(),
      status: z.string().optional(),
    },
  },
  async (params) => {
    const milestones = listMilestones(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ milestones, count: milestones.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_milestone",
  {
    title: "Update Milestone",
    description: "Update an existing milestone.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      due_date: z.string().optional(),
      status: z.enum(["pending", "in_progress", "completed", "missed"]).optional(),
    },
  },
  async ({ id, ...input }) => {
    const milestone = updateMilestone(id, input);
    if (!milestone) {
      return { content: [{ type: "text", text: `Milestone '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(milestone, null, 2) }] };
  }
);

server.registerTool(
  "complete_milestone",
  {
    title: "Complete Milestone",
    description: "Mark a milestone as completed.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const milestone = completeMilestone(id);
    if (!milestone) {
      return { content: [{ type: "text", text: `Milestone '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(milestone, null, 2) }] };
  }
);

server.registerTool(
  "delete_milestone",
  {
    title: "Delete Milestone",
    description: "Delete a milestone by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteMilestone(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Deliverables ---

server.registerTool(
  "create_deliverable",
  {
    title: "Create Deliverable",
    description: "Create a new deliverable for a milestone.",
    inputSchema: {
      milestone_id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      assignee: z.string().optional(),
      due_date: z.string().optional(),
    },
  },
  async (params) => {
    const deliverable = createDeliverable(params);
    return { content: [{ type: "text", text: JSON.stringify(deliverable, null, 2) }] };
  }
);

server.registerTool(
  "get_deliverable",
  {
    title: "Get Deliverable",
    description: "Get a deliverable by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deliverable = getDeliverable(id);
    if (!deliverable) {
      return { content: [{ type: "text", text: `Deliverable '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(deliverable, null, 2) }] };
  }
);

server.registerTool(
  "list_deliverables",
  {
    title: "List Deliverables",
    description: "List deliverables with optional filters.",
    inputSchema: {
      milestone_id: z.string().optional(),
      status: z.string().optional(),
      assignee: z.string().optional(),
    },
  },
  async (params) => {
    const deliverables = listDeliverables(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ deliverables, count: deliverables.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_deliverable",
  {
    title: "Update Deliverable",
    description: "Update an existing deliverable.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["pending", "in_progress", "review", "completed"]).optional(),
      assignee: z.string().optional(),
      due_date: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const deliverable = updateDeliverable(id, input);
    if (!deliverable) {
      return { content: [{ type: "text", text: `Deliverable '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(deliverable, null, 2) }] };
  }
);

server.registerTool(
  "complete_deliverable",
  {
    title: "Complete Deliverable",
    description: "Mark a deliverable as completed.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deliverable = completeDeliverable(id);
    if (!deliverable) {
      return { content: [{ type: "text", text: `Deliverable '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(deliverable, null, 2) }] };
  }
);

server.registerTool(
  "delete_deliverable",
  {
    title: "Delete Deliverable",
    description: "Delete a deliverable by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteDeliverable(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Advanced Queries ---

server.registerTool(
  "project_timeline",
  {
    title: "Project Timeline",
    description: "Get a project's timeline showing milestones and deliverables ordered by date.",
    inputSchema: { project_id: z.string() },
  },
  async ({ project_id }) => {
    const project = getProject(project_id);
    if (!project) {
      return { content: [{ type: "text", text: `Project '${project_id}' not found.` }], isError: true };
    }
    const timeline = getProjectTimeline(project_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ project: project.name, timeline }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "project_budget",
  {
    title: "Project Budget",
    description: "Get budget vs actual spending for a project.",
    inputSchema: { project_id: z.string() },
  },
  async ({ project_id }) => {
    const report = getBudgetVsActual(project_id);
    if (!report) {
      return { content: [{ type: "text", text: `Project '${project_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

server.registerTool(
  "overdue_projects",
  {
    title: "Overdue Projects",
    description: "Get all overdue projects (past end_date, not completed/cancelled).",
    inputSchema: {},
  },
  async () => {
    const projects = getOverdueProjects();
    return {
      content: [
        { type: "text", text: JSON.stringify({ projects, count: projects.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "overdue_milestones",
  {
    title: "Overdue Milestones",
    description: "Get all overdue milestones (past due_date, not completed/missed).",
    inputSchema: {},
  },
  async () => {
    const milestones = getOverdueMilestones();
    return {
      content: [
        { type: "text", text: JSON.stringify({ milestones, count: milestones.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "project_stats",
  {
    title: "Project Stats",
    description: "Get project statistics: counts by status, total budget and spent.",
    inputSchema: {},
  },
  async () => {
    const stats = getProjectStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "milestone_progress",
  {
    title: "Milestone Progress",
    description: "Get milestone completion progress for a project.",
    inputSchema: { project_id: z.string() },
  },
  async ({ project_id }) => {
    const progress = getMilestoneProgress(project_id);
    return { content: [{ type: "text", text: JSON.stringify(progress, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-projects MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
