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
  bulkRestore,
  countFiles,
  createFileRecord,
  findDuplicates,
  getFile,
  getFileContent,
  getStorageStats,
  hardDeleteFile,
  listDeletedFiles,
  listFiles,
  moveFile,
  renameFile,
  restoreFile,
  softDeleteFile,
  updateFile,
  uploadFromUrl,
} from "../lib/files.js";
import { buildPath, createFolder, deleteFolder, getFolder, listFolders, moveFolder, renameFolder } from "../lib/folders.js";
import { deleteFile, getMimeType, getPresignedUrl, getStorageBackend, getUrl, upload } from "../lib/storage.js";
import {
  getTypeDistribution,
  searchFiles,
  getStorageQuota,
  getLargestFiles,
  getFileActivityTimeline,
} from "../lib/analytics.js";

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

server.tool(
  "files_upload_from_url",
  "Upload a file by fetching from a URL",
  {
    workspace_id: z.string().optional().describe("Workspace ID"),
    folder_id: z.string().optional().describe("Folder ID"),
    name: z.string().describe("File name"),
    url: z.string().describe("URL to fetch file from"),
    mime_type: z.string().optional().describe("MIME type"),
    access: z.enum(["public", "private", "signed"]).optional().describe("Access level"),
    metadata: z.any().optional().describe("Additional metadata"),
    uploaded_by: z.string().optional().describe("User ID who uploaded"),
  },
  async (data) => text(await uploadFromUrl(sql, data)),
);

server.tool(
  "files_delete_folder",
  "Delete a folder",
  {
    id: z.string().describe("Folder ID to delete"),
    recursive: z.boolean().optional().default(false).describe("Delete non-empty folders"),
  },
  async ({ id, recursive }) => text(await deleteFolder(sql, id, { recursive })),
);

server.tool(
  "files_find_duplicates",
  "Find duplicate files by content hash",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await findDuplicates(sql, workspace_id)),
);

server.tool(
  "files_get_content",
  "Get file content as base64 or URL reference",
  { id: z.string().describe("File ID") },
  async ({ id }) => {
    const result = await getFileContent(sql, id);
    if (!result) return text({ error: "File not found" });
    return text({ ...result, is_url_reference: result.content.startsWith("https://") });
  },
);

server.tool(
  "files_hard_delete",
  "Permanently delete a file (bypass soft-delete)",
  { id: z.string().describe("File ID to permanently delete") },
  async ({ id }) => text({ deleted: await hardDeleteFile(sql, id) }),
);

server.tool(
  "files_count",
  "Count files in workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text({ count: await countFiles(sql, workspace_id) }),
);

server.tool(
  "files_create_file_record",
  "Create a file record directly (for external storage integrations)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    name: z.string().describe("File name"),
    storage_key: z.string().describe("Storage key/path"),
    mime_type: z.string().optional().describe("MIME type"),
    size: z.number().optional().describe("File size in bytes"),
    access: z.enum(["public", "private", "signed"]).optional().default("private"),
    folder_id: z.string().optional().describe("Folder ID"),
    content_hash: z.string().optional().describe("SHA-256 hash of content"),
    uploaded_by: z.string().optional().describe("User ID"),
  },
  async (data) => text(await createFileRecord(sql, data)),
);

server.tool(
  "files_update_file",
  "Update file metadata (name, access, content hash)",
  {
    id: z.string().describe("File ID"),
    name: z.string().optional().describe("New name"),
    access: z.enum(["public", "private", "signed"]).optional(),
    content_hash: z.string().optional(),
    metadata: z.any().optional(),
  },
  async ({ id, ...rest }) => text(await updateFile(sql, id, rest)),
);

server.tool(
  "files_get_folder",
  "Get folder metadata by ID",
  { id: z.string().describe("Folder ID") },
  async ({ id }) => text(await getFolder(sql, id)),
);

server.tool(
  "files_build_path",
  "Build the full slash-separated path string for a folder",
  { folder_id: z.string().describe("Folder ID") },
  async ({ folder_id }) => text({ path: await buildPath(sql, folder_id) }),
);

server.tool(
  "files_delete_from_storage",
  "Delete the actual file from storage backend (not the DB record — use files_delete_file first)",
  {
    id: z.string().describe("File ID"),
    storage: z.enum(["local", "s3"]).optional().default("local").describe("Storage backend"),
  },
  async ({ id, storage }) => {
    const file = await getFile(sql, id);
    if (!file) return text({ error: "File not found" });
    const deleted = storage === "s3"
      ? await import("../lib/storage.js").then(m => m.deleteFromS3(file.storage_key))
      : await import("../lib/storage.js").then(m => m.deleteFromLocal(file.storage_key));
    return text({ deleted, storage_key: file.storage_key });
  },
);

server.tool(
  "files_get_presigned_url",
  "Generate a presigned URL for secure temporary file access",
  {
    id: z.string().describe("File ID"),
    expires_in_seconds: z.number().optional().default(3600).describe("URL expiry time"),
  },
  async ({ id, expires_in_seconds }) => {
    const file = await getFile(sql, id);
    if (!file) return text({ error: "File not found" });
    const url = await getPresignedUrl(file.storage_key, expires_in_seconds);
    return text({ url });
  },
);

// ─── Storage utilities ─────────────────────────────────────────────────────────

server.tool(
  "files_get_storage_backend",
  "Get the configured storage backend (local or s3)",
  {},
  async () => text({ backend: getStorageBackend() }),
);

server.tool(
  "files_get_mime_type",
  "Detect MIME type from a filename",
  { filename: z.string().describe("File name (e.g. 'document.pdf')") },
  async ({ filename }) => text({ filename, mime_type: getMimeType(filename) }),
);

server.tool(
  "files_upload_direct",
  "Upload a file directly to storage (returns storage_key — use files_create_file_record to create the DB record)",
  {
    storage_key: z.string().describe("Storage key/path for the file"),
    content_base64: z.string().describe("File content as base64"),
    mime_type: z.string().optional().describe("MIME type (auto-detected if omitted)"),
  },
  async ({ storage_key, content_base64, mime_type }) => {
    const content = Buffer.from(content_base64, "base64");
    const detectedMime = mime_type ?? getMimeType(storage_key);
    const key = await upload(storage_key, content, detectedMime);
    const url = await getUrl(key, "private");
    return text({ storage_key: key, url, mime_type: detectedMime, size_bytes: content.length });
  },
);

// ─── Search & Analytics ─────────────────────────────────────────────────────────

server.tool(
  "files_search",
  "Search files by name within a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    query: z.string().describe("Search query (matched case-insensitively against file name)"),
    folder_id: z.string().optional().describe("Limit search to a specific folder"),
    mime_type: z.string().optional().describe("Filter by MIME type"),
    limit: z.number().optional().default(50).describe("Max results"),
  },
  async ({ workspace_id, query, folder_id, mime_type, limit }) =>
    text(await searchFiles(sql, workspace_id, query, { folder_id, mime_type, limit })),
);

server.tool(
  "files_get_type_distribution",
  "Get MIME type distribution and size breakdown for a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) =>
    text(await getTypeDistribution(sql, workspace_id)),
);

server.tool(
  "files_get_storage_quota",
  "Get storage quota status (used/limit) for a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => {
    const quota = await getStorageQuota(sql, workspace_id);
    if (!quota) return text({ error: "No files found for workspace" });
    return text(quota);
  },
);

server.tool(
  "files_get_largest_files",
  "Get the largest files in a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    limit: z.number().optional().default(20).describe("Max files to return"),
  },
  async ({ workspace_id, limit }) =>
    text(await getLargestFiles(sql, workspace_id, limit)),
);

server.tool(
  "files_get_activity_timeline",
  "Get file activity timeline (uploads/deletes per day) for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    days: z.number().optional().default(30).describe("Number of days of history"),
  },
  async ({ workspace_id, days }) =>
    text(await getFileActivityTimeline(sql, workspace_id, days)),
);

server.tool(
  "files_copy_file",
  "Copy a file to a new location (optionally with a new name) within the same workspace",
  {
    id: z.string().describe("Source file ID"),
    target_folder_id: z.string().nullable().optional().describe("Target folder ID (null for root)"),
    new_name: z.string().optional().describe("New name for the copy (defaults to original name)"),
  },
  async ({ id, target_folder_id, new_name }) => {
    const file = await getFile(sql, id);
    if (!file) return text({ error: "File not found" });
    const copy = await createFileRecord(sql, {
      workspace_id: file.workspace_id ?? undefined,
      folder_id: target_folder_id ?? null,
      name: new_name ?? `${file.name} (copy)`,
      original_name: new_name ? file.original_name : `${file.original_name} (copy)`,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      storage: file.storage,
      storage_key: file.storage_key,
      url: file.url ?? undefined,
      access: file.access,
      metadata: file.metadata,
      uploaded_by: file.uploaded_by ?? undefined,
    });
    return text({ copied: true, file: copy });
  },
);

server.tool(
  "files_get_folder",
  "Get a folder by ID",
  { id: z.string().describe("Folder ID") },
  async ({ id }) => {
    const folder = await getFolder(sql, id);
    if (!folder) return text({ error: "Folder not found" });
    return text({ found: true, folder });
  },
);

server.tool(
  "files_get_workspace_tree",
  "Get a full folder tree for a workspace (all folders and file counts per folder)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    max_depth: z.number().optional().default(10).describe("Maximum recursion depth"),
  },
  async ({ workspace_id, max_depth }) => {
    const folders = await listFolders(sql, workspace_id, null);
    const tree = folders.map(f => ({ ...f, children: [] as any[], file_count: 0 }));
    const files = await listFiles(sql, workspace_id, { limit: 10000 });
    for (const file of files) {
      if (file.folder_id) {
        const folder = tree.find(f => f.id === file.folder_id);
        if (folder) (folder as any).file_count++;
      }
    }
    return text({ folders: tree, total_files: files.length });
  },
);

server.tool(
  "files_duplicate_check",
  "Check if a file with the same content hash already exists in the workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    id: z.string().optional().describe("File ID to check (excludes itself from check)"),
  },
  async ({ workspace_id, id }) => {
    if (!id) return text({ error: "id required — provide a file ID to check for duplicates" });
    const file = await getFile(sql, id);
    if (!file) return text({ error: "File not found" });
    const duplicates = await findDuplicates(sql, workspace_id);
    const match = duplicates.find(d => d.files.some(f => f.id === id));
    if (!match) return text({ has_duplicate: false, duplicates: [] });
    return text({
      has_duplicate: true,
      duplicate_of: match.files.filter(f => f.id !== id).map(f => ({ id: f.id, name: f.name, size_bytes: f.size_bytes })),
    });
  },
);

server.tool(
  "files_restore_file",
  "Restore a soft-deleted file (undo a soft delete)",
  { id: z.string().describe("File ID to restore") },
  async ({ id }) => text({ restored: await restoreFile(sql, id) }),
);

server.tool(
  "files_list_deleted",
  "List soft-deleted (trashed) files in a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    limit: z.number().optional().default(100).describe("Max results"),
    offset: z.number().optional().default(0).describe("Offset for pagination"),
  },
  async ({ workspace_id, limit, offset }) =>
    text(await listDeletedFiles(sql, workspace_id, { limit, offset })),
);

server.tool(
  "files_bulk_restore",
  "Restore multiple soft-deleted files at once",
  { ids: z.array(z.string()).describe("Array of file IDs to restore") },
  async ({ ids }) => text({ restored: await bulkRestore(sql, ids) }),
);

server.tool(
  "files_rename_folder",
  "Rename a folder (also updates all descendant folder paths)",
  {
    id: z.string().describe("Folder ID"),
    name: z.string().describe("New folder name"),
  },
  async ({ id, name }) => text(await renameFolder(sql, id, name)),
);

server.tool(
  "files_move_folder",
  "Move a folder to a new parent (null parent_id = root level)",
  {
    id: z.string().describe("Folder ID to move"),
    parent_id: z.string().nullable().describe("New parent folder ID (null for root)"),
  },
  async ({ id, parent_id }) => text(await moveFolder(sql, id, parent_id)),
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
