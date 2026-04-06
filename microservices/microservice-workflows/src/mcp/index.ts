import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  createWorkflow, getWorkflow, listWorkflows, publishWorkflow, updateWorkflow, getWorkflowVersion,
} from "../lib/definitions.js";
import {
  startExecution, getExecution, listExecutions, cancelExecution, advanceExecution,
} from "../lib/executions.js";
import { executeNode, retryNode, skipNode } from "../lib/executor.js";

const server = new Server(
  { name: "microservice-workflows", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler("initialize", async () => ({
  protocolVersion: "2024-11-05",
  capabilities: { tools: {} },
  serverInfo: { name: "microservice-workflows", version: "0.0.1" },
}));

server.setRequestHandler("listTools", async () => ({
  tools: [
    {
      name: "create_workflow",
      description: "Create a new workflow definition (DAG)",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          definition: {
            type: "object",
            properties: {
              nodes: { type: "array", description: "Array of workflow nodes" },
              edges: { type: "array", description: "Array of directed edges" },
            },
          },
        },
        required: ["workspaceId", "name", "definition"],
      },
    },
    {
      name: "list_workflows",
      description: "List all latest-version workflows for a workspace",
      inputSchema: {
        type: "object",
        properties: { workspaceId: { type: "string" } },
        required: ["workspaceId"],
      },
    },
    {
      name: "start_execution",
      description: "Start a workflow execution",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string" },
          workflowName: { type: "string" },
          triggerType: { type: "string" },
          context: { type: "object" },
        },
        required: ["workspaceId", "workflowName"],
      },
    },
    {
      name: "get_execution",
      description: "Get an execution by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "list_executions",
      description: "List executions for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string" },
          status: { type: "string" },
          workflowId: { type: "string" },
        },
        required: ["workspaceId"],
      },
    },
    {
      name: "cancel_execution",
      description: "Cancel a running execution",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "get_workflow",
      description: "Get a workflow definition by ID",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" } }, required: ["workflow_id"] },
    },
    {
      name: "update_workflow",
      description: "Update a workflow definition (creates a new version)",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          definition: { type: "object" },
        },
        required: ["workflow_id"],
      },
    },
    {
      name: "publish_workflow",
      description: "Publish a workflow to make it active",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" } }, required: ["workflow_id"] },
    },
    {
      name: "get_workflow_version",
      description: "Get a specific version of a workflow",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" }, version: { type: "number" } }, required: ["workflow_id", "version"] },
    },
    {
      name: "advance_execution",
      description: "Manually advance an execution to the next step",
      inputSchema: { type: "object", properties: { execution_id: { type: "string" } }, required: ["execution_id"] },
    },
    {
      name: "retry_node",
      description: "Retry a failed node in an execution",
      inputSchema: { type: "object", properties: { execution_id: { type: "string" }, node_id: { type: "string" } }, required: ["execution_id", "node_id"] },
    },
    {
      name: "skip_node",
      description: "Skip a node in an execution (mark as completed with no-op)",
      inputSchema: { type: "object", properties: { execution_id: { type: "string" }, node_id: { type: "string" } }, required: ["execution_id", "node_id"] },
    },
    {
      name: "workflows_validate_definition",
      description: "Validate a workflow definition DAG (nodes, edges, cycles, missing refs)",
      inputSchema: {
        type: "object",
        properties: {
          definition: {
            type: "object",
            properties: {
              nodes: { type: "array", description: "Array of workflow nodes" },
              edges: { type: "array", description: "Array of directed edges" },
            },
          },
        },
        required: ["definition"],
      },
    },
    {
      name: "workflows_list_versions",
      description: "List all versions of a workflow",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" } }, required: ["workflow_id"] },
    },
    {
      name: "workflows_diff_versions",
      description: "Diff two versions of a workflow definition",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" }, version_a: { type: "number" }, version_b: { type: "number" } }, required: ["workflow_id", "version_a", "version_b"] },
    },
    {
      name: "workflows_pause_execution",
      description: "Pause a running execution (enters wait state)",
      inputSchema: { type: "object", properties: { execution_id: { type: "string" }, reason: { type: "string" } }, required: ["execution_id"] },
    },
    {
      name: "workflows_resume_execution",
      description: "Resume a paused execution",
      inputSchema: { type: "object", properties: { execution_id: { type: "string" } }, required: ["execution_id"] },
    },
    {
      name: "workflows_signal_execution",
      description: "Send a signal/event to a waiting execution",
      inputSchema: { type: "object", properties: { execution_id: { type: "string" }, signal: { type: "string" }, payload: { type: "object" } }, required: ["execution_id", "signal"] },
    },
    {
      name: "workflows_get_step_stats",
      description: "Get execution step statistics for a workflow or node",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" }, node_id: { type: "string" } } },
    },
    {
      name: "workflows_get_node_timing",
      description: "Get timing statistics (avg/min/max duration) per node",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" } }, required: ["workflow_id"] },
    },
    {
      name: "workflows_get_failure_rate",
      description: "Get failure rate per node across all executions",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" } }, required: ["workflow_id"] },
    },
    {
      name: "workflows_get_execution_timeline",
      description: "Get execution timeline (timestamps for each step start/end)",
      inputSchema: { type: "object", properties: { execution_id: { type: "string" } }, required: ["execution_id"] },
    },
    {
      name: "workflows_schedule_workflow",
      description: "Schedule a workflow to run at a future time (cron or one-shot)",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string" },
          workflowName: { type: "string" },
          triggerType: { type: "string" },
          schedule: { type: "object", properties: { type: { type: "string" }, cron: { type: "string" }, at: { type: "string" } } },
          context: { type: "object" },
        },
        required: ["workspaceId", "workflowName", "schedule"],
      },
    },
    {
      name: "workflows_cancel_scheduled",
      description: "Cancel a scheduled workflow run",
      inputSchema: { type: "object", properties: { schedule_id: { type: "string" } }, required: ["schedule_id"] },
    },
    {
      name: "workflows_list_scheduled",
      description: "List all scheduled workflow runs for a workspace",
      inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
    },
    {
      name: "workflows_bulk_cancel_executions",
      description: "Cancel multiple running executions at once",
      inputSchema: { type: "object", properties: { execution_ids: { type: "array", items: { type: "string" } } }, required: ["execution_ids"] },
    },
    {
      name: "workflows_bulk_retry_failures",
      description: "Retry all failed executions for a workflow",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" } }, required: ["workflow_id"] },
    },
    {
      name: "workflows_get_active_executions",
      description: "Get all currently active/running executions for a workspace",
      inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
    },
    {
      name: "workflows_create_template",
      description: "Save a workflow definition as a reusable template",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          definition: { type: "object" },
        },
        required: ["workspaceId", "name", "definition"],
      },
    },
    {
      name: "workflows_list_templates",
      description: "List workflow templates for a workspace",
      inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
    },
    {
      name: "workflows_instantiate_template",
      description: "Create a new workflow from a template",
      inputSchema: {
        type: "object",
        properties: {
          templateId: { type: "string" },
          workspaceId: { type: "string" },
          name: { type: "string" },
        },
        required: ["templateId", "workspaceId", "name"],
      },
    },
    {
      name: "workflows_get_state_machine",
      description: "Get the state machine definition for a workflow (states and transitions)",
      inputSchema: { type: "object", properties: { workflow_id: { type: "string" } }, required: ["workflow_id"] },
    },
    {
      name: "workflows_validate_transition",
      description: "Validate if a state transition is allowed in a workflow execution",
      inputSchema: { type: "object", properties: { execution_id: { type: "string" }, target_state: { type: "string" } }, required: ["execution_id", "target_state"] },
    },
  ],
}));

server.setRequestHandler("callTool", async ({ name, arguments: args }) => {
  const sql = getDb();
  try {
    switch (name) {
      case "create_workflow":
        return { content: [{ type: "text", text: JSON.stringify(await createWorkflow(sql, args as any)) }] };
      case "list_workflows":
        return { content: [{ type: "text", text: JSON.stringify(await listWorkflows(sql, args.workspaceId as string)) }] };
      case "start_execution":
        return { content: [{ type: "text", text: JSON.stringify(await startExecution(sql, args as any)) }] };
      case "get_execution":
        return { content: [{ type: "text", text: JSON.stringify(await getExecution(sql, args.id as string)) }] };
      case "list_executions":
        return { content: [{ type: "text", text: JSON.stringify(await listExecutions(sql, args.workspaceId as string, args as any)) }] };
      case "cancel_execution":
        return { content: [{ type: "text", text: JSON.stringify(await cancelExecution(sql, args.id as string)) }] };
      case "get_workflow":
        return { content: [{ type: "text", text: JSON.stringify(await getWorkflow(sql, args.workflow_id as string)) }] };
      case "update_workflow":
        return { content: [{ type: "text", text: JSON.stringify(await updateWorkflow(sql, args.workflow_id as string, args as any)) }] };
      case "publish_workflow":
        return { content: [{ type: "text", text: JSON.stringify(await publishWorkflow(sql, args.workflow_id as string)) }] };
      case "get_workflow_version":
        return { content: [{ type: "text", text: JSON.stringify(await getWorkflowVersion(sql, args.workflow_id as string, args.version as number)) }] };
      case "advance_execution":
        return { content: [{ type: "text", text: JSON.stringify(await advanceExecution(sql, args.execution_id as string)) }] };
      case "retry_node":
        return { content: [{ type: "text", text: JSON.stringify(await retryNode(sql, args.execution_id as string, args.node_id as string)) }] };
      case "skip_node":
        return { content: [{ type: "text", text: JSON.stringify(await skipNode(sql, args.execution_id as string, args.node_id as string)) }] };
      case "workflows_validate_definition": {
        const { validateWorkflowDefinition } = await import("../lib/validation.js");
        return { content: [{ type: "text", text: JSON.stringify(validateWorkflowDefinition(args.definition as any)) }] };
      }
      case "workflows_list_versions": {
        const { listWorkflowVersions } = await import("../lib/definitions.js");
        return { content: [{ type: "text", text: JSON.stringify(await listWorkflowVersions(sql, args.workflow_id as string)) }] };
      }
      case "workflows_diff_versions": {
        const { diffWorkflowVersions } = await import("../lib/definitions.js");
        return { content: [{ type: "text", text: JSON.stringify(await diffWorkflowVersions(sql, args.workflow_id as string, args.version_a as number, args.version_b as number)) }] };
      }
      case "workflows_pause_execution": {
        const { pauseExecution } = await import("../lib/executions.js");
        return { content: [{ type: "text", text: JSON.stringify(await pauseExecution(sql, args.execution_id as string, args.reason as string)) }] };
      }
      case "workflows_resume_execution": {
        const { resumeExecution } = await import("../lib/executions.js");
        return { content: [{ type: "text", text: JSON.stringify(await resumeExecution(sql, args.execution_id as string)) }] };
      }
      case "workflows_signal_execution": {
        const { signalExecution } = await import("../lib/executions.js");
        return { content: [{ type: "text", text: JSON.stringify(await signalExecution(sql, args.execution_id as string, args.signal as string, args.payload as any)) }] };
      }
      case "workflows_get_step_stats": {
        const { getStepStats } = await import("../lib/analytics.js");
        return { content: [{ type: "text", text: JSON.stringify(await getStepStats(sql, args.workflow_id as string, args.node_id as string)) }] };
      }
      case "workflows_get_node_timing": {
        const { getNodeTiming } = await import("../lib/analytics.js");
        return { content: [{ type: "text", text: JSON.stringify(await getNodeTiming(sql, args.workflow_id as string)) }] };
      }
      case "workflows_get_failure_rate": {
        const { getFailureRate } = await import("../lib/analytics.js");
        return { content: [{ type: "text", text: JSON.stringify(await getFailureRate(sql, args.workflow_id as string)) }] };
      }
      case "workflows_get_execution_timeline": {
        const { getExecutionTimeline } = await import("../lib/executions.js");
        return { content: [{ type: "text", text: JSON.stringify(await getExecutionTimeline(sql, args.execution_id as string)) }] };
      }
      case "workflows_schedule_workflow": {
        const { scheduleWorkflow } = await import("../lib/scheduling.js");
        return { content: [{ type: "text", text: JSON.stringify(await scheduleWorkflow(sql, args as any)) }] };
      }
      case "workflows_cancel_scheduled": {
        const { cancelScheduled } = await import("../lib/scheduling.js");
        return { content: [{ type: "text", text: JSON.stringify(await cancelScheduled(sql, args.schedule_id as string)) }] };
      }
      case "workflows_list_scheduled": {
        const { listScheduled } = await import("../lib/scheduling.js");
        return { content: [{ type: "text", text: JSON.stringify(await listScheduled(sql, args.workspaceId as string)) }] };
      }
      case "workflows_bulk_cancel_executions": {
        const { bulkCancelExecutions } = await import("../lib/executions.js");
        return { content: [{ type: "text", text: JSON.stringify(await bulkCancelExecutions(sql, args.execution_ids as string[])) }] };
      }
      case "workflows_bulk_retry_failures": {
        const { bulkRetryFailures } = await import("../lib/executions.js");
        return { content: [{ type: "text", text: JSON.stringify(await bulkRetryFailures(sql, args.workflow_id as string)) }] };
      }
      case "workflows_get_active_executions": {
        const { getActiveExecutions } = await import("../lib/executions.js");
        return { content: [{ type: "text", text: JSON.stringify(await getActiveExecutions(sql, args.workspaceId as string)) }] };
      }
      case "workflows_create_template": {
        const { createTemplate } = await import("../lib/templates.js");
        return { content: [{ type: "text", text: JSON.stringify(await createTemplate(sql, args as any)) }] };
      }
      case "workflows_list_templates": {
        const { listTemplates } = await import("../lib/templates.js");
        return { content: [{ type: "text", text: JSON.stringify(await listTemplates(sql, args.workspaceId as string)) }] };
      }
      case "workflows_instantiate_template": {
        const { instantiateTemplate } = await import("../lib/templates.js");
        return { content: [{ type: "text", text: JSON.stringify(await instantiateTemplate(sql, args as any)) }] };
      }
      case "workflows_get_state_machine": {
        const { getStateMachine } = await import("../lib/state-machine.js");
        return { content: [{ type: "text", text: JSON.stringify(await getStateMachine(sql, args.workflow_id as string)) }] };
      }
      case "workflows_validate_transition": {
        const { validateTransition } = await import("../lib/state-machine.js");
        return { content: [{ type: "text", text: JSON.stringify(await validateTransition(sql, args.execution_id as string, args.target_state as string)) }] };
      }
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } finally {
    await sql.end();
  }
});

async function main() {
  const sql = getDb();
  await migrate(sql);
  await sql.end();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
