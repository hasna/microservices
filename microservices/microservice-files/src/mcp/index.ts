#!/usr/bin/env bun
/**
 * MCP server for microservice-files.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { listFiles, getFile, softDeleteFile, renameFile, moveFile, bulkSoftDelete, getStorageStats } from "../lib/files.js";
import { createFolder, listFolders } from "../lib/folders.js";
import { getUrl } from "../lib/storage.js";

const server = new Server(
  { name: "microservice-files", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "files_list_files",
      description: "List files in a workspace, optionally filtered by folder",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID to filter by" },
          folder_id: { type: "string", description: "Folder ID to filter by" },
          limit: { type: "number", description: "Max results (default 50)" },
          offset: { type: "number", description: "Offset for pagination" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "files_get_file",
      description: "Get file metadata by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "File ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "files_delete_file",
      description: "Soft delete a file by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "File ID to delete" },
        },
        required: ["id"],
      },
    },
    {
      name: "files_get_url",
      description: "Get the URL (or presigned URL) for a file",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "File ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "files_create_folder",
      description: "Create a new folder",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          name: { type: "string", description: "Folder name" },
          parent_id: { type: "string", description: "Parent folder ID (optional)" },
          created_by: { type: "string", description: "UUID of the creator (optional)" },
        },
        required: ["name"],
      },
    },
    {
      name: "files_list_folders",
      description: "List folders in a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
          parent_id: { type: "string", description: "Parent folder ID to list children of (optional)" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "files_rename_file",
      description: "Rename a file by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "File ID" },
          name: { type: "string", description: "New name for the file" },
        },
        required: ["id", "name"],
      },
    },
    {
      name: "files_move_file",
      description: "Move a file to a different folder",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "File ID" },
          folder_id: { type: ["string", "null"], description: "Target folder ID (null to move to root)" },
        },
        required: ["id"],
      },
    },
    {
      name: "files_get_storage_stats",
      description: "Get storage statistics for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "files_bulk_delete",
      description: "Soft delete multiple files by IDs",
      inputSchema: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "Array of file IDs to delete" },
        },
        required: ["ids"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as Record<string, unknown>;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "files_list_files") {
    return text(
      await listFiles(sql, String(a.workspace_id), {
        folderId: a.folder_id ? String(a.folder_id) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
        offset: a.offset ? Number(a.offset) : undefined,
      })
    );
  }

  if (name === "files_get_file") {
    return text(await getFile(sql, String(a.id)));
  }

  if (name === "files_delete_file") {
    return text({ deleted: await softDeleteFile(sql, String(a.id)) });
  }

  if (name === "files_get_url") {
    const file = await getFile(sql, String(a.id));
    if (!file) return text({ error: "File not found" });
    const url = await getUrl(file.storage_key, file.access);
    return text({ url, file });
  }

  if (name === "files_create_folder") {
    return text(
      await createFolder(sql, {
        workspace_id: a.workspace_id ? String(a.workspace_id) : undefined,
        name: String(a.name),
        parent_id: a.parent_id ? String(a.parent_id) : undefined,
        created_by: a.created_by ? String(a.created_by) : undefined,
      })
    );
  }

  if (name === "files_list_folders") {
    return text(
      await listFolders(
        sql,
        String(a.workspace_id),
        a.parent_id !== undefined ? String(a.parent_id) : undefined
      )
    );
  }

  if (name === "files_rename_file") {
    return text(await renameFile(sql, String(a.id), String(a.name)));
  }

  if (name === "files_move_file") {
    const folderId = a.folder_id !== undefined && a.folder_id !== null ? String(a.folder_id) : null;
    return text(await moveFile(sql, String(a.id), folderId));
  }

  if (name === "files_get_storage_stats") {
    return text(await getStorageStats(sql, String(a.workspace_id)));
  }

  if (name === "files_bulk_delete") {
    const ids = Array.isArray(a.ids) ? (a.ids as unknown[]).map(String) : [];
    return text({ deleted: await bulkSoftDelete(sql, ids) });
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
