#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createNote, getNote, listNotes, updateNote, deleteNote, countNotes, createFolder, listFolders, deleteFolder } from "../db/notes.js";

const server = new McpServer({ name: "microservice-notes", version: "0.0.1" });

server.registerTool("create_note", { title: "Create Note", description: "Create a new note.", inputSchema: { title: z.string(), content: z.string().optional(), folder_id: z.string().optional(), pinned: z.boolean().optional(), tags: z.array(z.string()).optional() } },
  async (p) => ({ content: [{ type: "text", text: JSON.stringify(createNote(p), null, 2) }] }));

server.registerTool("get_note", { title: "Get Note", description: "Get a note by ID.", inputSchema: { id: z.string() } },
  async ({ id }) => { const n = getNote(id); return n ? { content: [{ type: "text", text: JSON.stringify(n, null, 2) }] } : { content: [{ type: "text", text: `Note '${id}' not found.` }], isError: true }; });

server.registerTool("list_notes", { title: "List Notes", description: "List notes with filters.", inputSchema: { search: z.string().optional(), tag: z.string().optional(), folder_id: z.string().optional(), pinned: z.boolean().optional(), limit: z.number().optional() } },
  async (p) => { const notes = listNotes(p); return { content: [{ type: "text", text: JSON.stringify({ notes, count: notes.length }, null, 2) }] }; });

server.registerTool("update_note", { title: "Update Note", description: "Update a note.", inputSchema: { id: z.string(), title: z.string().optional(), content: z.string().optional(), folder_id: z.string().optional(), pinned: z.boolean().optional(), tags: z.array(z.string()).optional() } },
  async ({ id, ...input }) => { const n = updateNote(id, input); return n ? { content: [{ type: "text", text: JSON.stringify(n, null, 2) }] } : { content: [{ type: "text", text: `Note '${id}' not found.` }], isError: true }; });

server.registerTool("delete_note", { title: "Delete Note", description: "Delete a note.", inputSchema: { id: z.string() } },
  async ({ id }) => ({ content: [{ type: "text", text: JSON.stringify({ id, deleted: deleteNote(id) }) }] }));

server.registerTool("count_notes", { title: "Count Notes", description: "Count all notes.", inputSchema: {} },
  async () => ({ content: [{ type: "text", text: JSON.stringify({ count: countNotes() }) }] }));

server.registerTool("create_folder", { title: "Create Folder", description: "Create a folder.", inputSchema: { name: z.string(), parent_id: z.string().optional() } },
  async ({ name, parent_id }) => ({ content: [{ type: "text", text: JSON.stringify(createFolder(name, parent_id), null, 2) }] }));

server.registerTool("list_folders", { title: "List Folders", description: "List folders.", inputSchema: { parent_id: z.string().optional() } },
  async ({ parent_id }) => ({ content: [{ type: "text", text: JSON.stringify(listFolders(parent_id), null, 2) }] }));

server.registerTool("delete_folder", { title: "Delete Folder", description: "Delete a folder.", inputSchema: { id: z.string() } },
  async ({ id }) => ({ content: [{ type: "text", text: JSON.stringify({ id, deleted: deleteFolder(id) }) }] }));

async function main() { const t = new StdioServerTransport(); await server.connect(t); console.error("microservice-notes MCP running"); }
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
