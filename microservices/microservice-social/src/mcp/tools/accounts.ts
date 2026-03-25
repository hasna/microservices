import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
  deleteAccount,
} from "../../db/social.js";

const PlatformEnum = z.enum(["x", "linkedin", "instagram", "threads", "bluesky"]);

export function registerAccountTools(server: McpServer) {
  server.registerTool(
    "create_account",
    {
      title: "Create Social Account",
      description: "Add a social media account.",
      inputSchema: {
        platform: PlatformEnum,
        handle: z.string(),
        display_name: z.string().optional(),
        connected: z.boolean().optional(),
        access_token_env: z.string().optional(),
      },
    },
    async (params) => {
      const account = createAccount(params);
      return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
    }
  );

  server.registerTool(
    "get_account",
    {
      title: "Get Social Account",
      description: "Get a social media account by ID.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const account = getAccount(id);
      if (!account) {
        return { content: [{ type: "text", text: `Account '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
    }
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List Social Accounts",
      description: "List social media accounts with optional filters.",
      inputSchema: {
        platform: PlatformEnum.optional(),
        connected: z.boolean().optional(),
        limit: z.number().optional(),
      },
    },
    async (params) => {
      const accounts = listAccounts(params);
      return {
        content: [
          { type: "text", text: JSON.stringify({ accounts, count: accounts.length }, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "update_account",
    {
      title: "Update Social Account",
      description: "Update a social media account.",
      inputSchema: {
        id: z.string(),
        platform: PlatformEnum.optional(),
        handle: z.string().optional(),
        display_name: z.string().optional(),
        connected: z.boolean().optional(),
        access_token_env: z.string().optional(),
      },
    },
    async ({ id, ...input }) => {
      const account = updateAccount(id, input);
      if (!account) {
        return { content: [{ type: "text", text: `Account '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
    }
  );

  server.registerTool(
    "delete_account",
    {
      title: "Delete Social Account",
      description: "Delete a social media account by ID.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const deleted = deleteAccount(id);
      return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
    }
  );
}
