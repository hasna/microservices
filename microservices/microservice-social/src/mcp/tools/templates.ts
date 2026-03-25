import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  useTemplate,
} from "../../db/social.js";

export function registerTemplateTools(server: McpServer) {
  server.registerTool(
    "create_template",
    {
      title: "Create Template",
      description: "Create a post template with variables.",
      inputSchema: {
        name: z.string(),
        content: z.string(),
        variables: z.array(z.string()).optional(),
      },
    },
    async (params) => {
      const template = createTemplate(params);
      return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
    }
  );

  server.registerTool(
    "list_templates",
    {
      title: "List Templates",
      description: "List all post templates.",
      inputSchema: {},
    },
    async () => {
      const templates = listTemplates();
      return {
        content: [
          { type: "text", text: JSON.stringify({ templates, count: templates.length }, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "get_template",
    {
      title: "Get Template",
      description: "Get a template by ID.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const template = getTemplate(id);
      if (!template) {
        return { content: [{ type: "text", text: `Template '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
    }
  );

  server.registerTool(
    "delete_template",
    {
      title: "Delete Template",
      description: "Delete a template by ID.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const deleted = deleteTemplate(id);
      return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
    }
  );

  server.registerTool(
    "use_template",
    {
      title: "Use Template",
      description: "Create a post from a template by replacing variables.",
      inputSchema: {
        template_id: z.string(),
        account_id: z.string(),
        values: z.record(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ template_id, account_id, values, tags }) => {
      try {
        const post = useTemplate(template_id, account_id, values || {}, tags);
        return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );
}
