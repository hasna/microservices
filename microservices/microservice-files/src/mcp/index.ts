#!/usr/bin/env bun
/**
 * MCP server for microservice-files.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  bulkSoftDelete,
  getFile,
  getStorageStats,
  listFiles,
  moveFile,
  renameFile,
  softDeleteFile,
} from "../lib/files.js";
import { createFolder, listFolders } from "../lib/folders.js";
import { getUrl } from "../lib/storage.js";

const server = new McpServer({
  name: "microservice-files",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "files_list_files",
  "List files in a workspace, optionally filtered by folder",
  {
    workspace_id: z.string().describe("Workspace ID to filter by"),
    folder_id: z.string().optional().describe("Folder ID to filter by"),
    limit: z.number().optional().default(50).describe("Max results"),
    offset: z.number().optional().default(0).describe("Offset for pagination"),
  },
  async ({ workspace_id, folder_id, limit, offset }) =>
    text(await listFiles(sql, workspace_id, { folderId: folder_id, limit, offset })),
);

server.tool(
  "files_get_file",
  "Get file metadata by ID",
  { id: z.string().describe("File ID") },
  async ({ id }) => text(await getFile(sql, id)),
);

server.tool(
  "files_delete_file",
  "Soft delete a file by ID",
  { id: z.string().describe("File ID to delete") },
  async ({ id }) => text({ deleted: await softDeleteFile(sql, id) }),
);

server.tool(
  "files_get_url",
  "Get the URL (or presigned URL) for a file",
  { id: z.string().describe("File ID") },
  async ({ id }) => {
    const file = await getFile(sql, id);
    if (!file) return text({ error: "File not found" });
    const url = await getUrl(file.storage_key, file.access);
    return text({ url, file });
  },
);

server.tool(
  "files_create_folder",
  "Create a new folder",
  {
    workspace_id: z.string().optional().describe("Workspace ID"),
    name: z.string().describe("Folder name"),
    parent_id: z.string().optional().describe("Parent folder ID"),
    created_by: z.string().optional().describe("UUID of the creator"),
  },
  async (folderData) => text(await createFolder(sql, folderData)),
);

server.tool(
  "files_list_folders",
  "List folders in a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    parent_id: z.string().optional().describe("Parent folder ID to list children of"),
  },
  async ({ workspace_id, parent_id }) =>
    text(await listFolders(sql, workspace_id, parent_id)),
);

server.tool(
  "files_rename_file",
  "Rename a file by ID",
  {
    id: z.string().describe("File ID"),
    name: z.string().describe("New name for the file"),
  },
  async ({ id, name }) => text(await renameFile(sql, id, name)),
);

server.tool(
  "files_move_file",
  "Move a file to a different folder",
  {
    id: z.string().describe("File ID"),
    folder_id: z.string().nullable().describe("Target folder ID (null to move to root)"),
  },
  async ({ id, folder_id }) => text(await moveFile(sql, id, folder_id)),
);

server.tool(
  "files_get_storage_stats",
  "Get storage statistics for a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await getStorageStats(sql, workspace_id)),
);

server.tool(
  "files_bulk_delete",
  "Soft delete multiple files by IDs",
  { ids: z.array(z.string()).describe("Array of file IDs to delete") },
  async ({ ids }) => text({ deleted: await bulkSoftDelete(sql, ids) }),
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
