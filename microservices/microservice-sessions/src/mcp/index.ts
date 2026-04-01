#!/usr/bin/env bun
/**
 * MCP server for microservice-sessions.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { getContextWindow } from "../lib/context.js";
import {
  archiveConversation,
  createConversation,
  deleteConversation,
  forkConversation,
  getConversation,
  listConversations,
} from "../lib/conversations.js";
import { exportConversation } from "../lib/export.js";
import {
  addMessage,
  getMessages,
  pinMessage,
  searchMessages,
} from "../lib/messages.js";

const server = new Server(
  { name: "microservice-sessions", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "sessions_create_conversation",
      description: "Create a new conversation",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          title: { type: "string" },
          model: { type: "string" },
          system_prompt: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["workspace_id", "user_id"],
      },
    },
    {
      name: "sessions_list_conversations",
      description: "List conversations for a workspace and user",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          archived: { type: "boolean" },
          search: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
        required: ["workspace_id", "user_id"],
      },
    },
    {
      name: "sessions_get_conversation",
      description: "Get a conversation by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_add_message",
      description: "Add a message to a conversation",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          role: {
            type: "string",
            enum: ["system", "user", "assistant", "tool"],
          },
          content: { type: "string" },
          name: { type: "string" },
          tool_calls: { type: "object" },
          tokens: { type: "number" },
          latency_ms: { type: "number" },
          model: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["conversation_id", "role", "content"],
      },
    },
    {
      name: "sessions_get_messages",
      description: "Get messages for a conversation",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          limit: { type: "number" },
          before: { type: "string" },
          after: { type: "string" },
          role: { type: "string" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_get_context_window",
      description:
        "Get messages that fit within a token budget for a conversation",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          max_tokens: { type: "number" },
        },
        required: ["conversation_id", "max_tokens"],
      },
    },
    {
      name: "sessions_search_messages",
      description: "Full-text search across messages in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          query: { type: "string" },
          conversation_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["workspace_id", "query"],
      },
    },
    {
      name: "sessions_delete_conversation",
      description: "Delete a conversation and all its messages",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_archive_conversation",
      description: "Archive a conversation",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "sessions_fork_conversation",
      description:
        "Fork a conversation from a specific message, creating a new conversation with messages up to that point",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          from_message_id: { type: "string" },
        },
        required: ["conversation_id", "from_message_id"],
      },
    },
    {
      name: "sessions_export_conversation",
      description: "Export a conversation as markdown or JSON",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          format: { type: "string", enum: ["markdown", "json"] },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "sessions_pin_message",
      description: "Toggle pin status on a message",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as any;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "sessions_create_conversation") {
    return text(
      await createConversation(sql, {
        workspace_id: String(a.workspace_id),
        user_id: String(a.user_id),
        title: a.title ? String(a.title) : undefined,
        model: a.model ? String(a.model) : undefined,
        system_prompt: a.system_prompt ? String(a.system_prompt) : undefined,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "sessions_list_conversations") {
    return text(
      await listConversations(sql, String(a.workspace_id), String(a.user_id), {
        archived: a.archived as boolean | undefined,
        search: a.search ? String(a.search) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
        offset: a.offset ? Number(a.offset) : undefined,
      }),
    );
  }

  if (name === "sessions_get_conversation") {
    return text(await getConversation(sql, String(a.id)));
  }

  if (name === "sessions_add_message") {
    return text(
      await addMessage(sql, String(a.conversation_id), {
        role: String(a.role) as "system" | "user" | "assistant" | "tool",
        content: String(a.content),
        name: a.name ? String(a.name) : undefined,
        tool_calls: a.tool_calls,
        tokens: a.tokens ? Number(a.tokens) : undefined,
        latency_ms: a.latency_ms ? Number(a.latency_ms) : undefined,
        model: a.model ? String(a.model) : undefined,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "sessions_get_messages") {
    return text(
      await getMessages(sql, String(a.conversation_id), {
        limit: a.limit ? Number(a.limit) : undefined,
        before: a.before ? String(a.before) : undefined,
        after: a.after ? String(a.after) : undefined,
        role: a.role ? String(a.role) : undefined,
      }),
    );
  }

  if (name === "sessions_get_context_window") {
    return text(
      await getContextWindow(
        sql,
        String(a.conversation_id),
        Number(a.max_tokens),
      ),
    );
  }

  if (name === "sessions_search_messages") {
    return text(
      await searchMessages(sql, String(a.workspace_id), String(a.query), {
        conversationId: a.conversation_id
          ? String(a.conversation_id)
          : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
      }),
    );
  }

  if (name === "sessions_delete_conversation") {
    return text({ deleted: await deleteConversation(sql, String(a.id)) });
  }

  if (name === "sessions_archive_conversation") {
    return text(await archiveConversation(sql, String(a.id)));
  }

  if (name === "sessions_fork_conversation") {
    return text(
      await forkConversation(
        sql,
        String(a.conversation_id),
        String(a.from_message_id),
      ),
    );
  }

  if (name === "sessions_export_conversation") {
    const format = (a.format ? String(a.format) : "markdown") as
      | "markdown"
      | "json";
    return text(
      await exportConversation(sql, String(a.conversation_id), format),
    );
  }

  if (name === "sessions_pin_message") {
    return text(await pinMessage(sql, String(a.id)));
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
