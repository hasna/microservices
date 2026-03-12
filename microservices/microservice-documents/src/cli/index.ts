#!/usr/bin/env bun

import { Command } from "commander";
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
  deleteDocument,
  countDocuments,
  searchDocuments,
  addVersion,
  listVersions,
} from "../db/documents.js";

const program = new Command();

program
  .name("microservice-documents")
  .description("Document management microservice")
  .version("0.0.1");

// --- Documents ---

program
  .command("add")
  .description("Add a new document")
  .requiredOption("--title <title>", "Document title")
  .option("--description <text>", "Description")
  .option("--file-path <path>", "File path")
  .option("--file-type <type>", "File type (e.g. pdf, docx)")
  .option("--file-size <bytes>", "File size in bytes")
  .option("--status <status>", "Status: draft|active|archived", "draft")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const doc = createDocument({
      title: opts.title,
      description: opts.description,
      file_path: opts.filePath,
      file_type: opts.fileType,
      file_size: opts.fileSize ? parseInt(opts.fileSize) : undefined,
      status: opts.status,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(doc, null, 2));
    } else {
      console.log(`Created document: ${doc.title} (${doc.id})`);
    }
  });

program
  .command("get")
  .description("Get a document by ID")
  .argument("<id>", "Document ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const doc = getDocument(id);
    if (!doc) {
      console.error(`Document '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(doc, null, 2));
    } else {
      console.log(`${doc.title}`);
      console.log(`  Status:  ${doc.status}`);
      console.log(`  Version: ${doc.version}`);
      if (doc.description) console.log(`  Description: ${doc.description}`);
      if (doc.file_path) console.log(`  File: ${doc.file_path}`);
      if (doc.file_type) console.log(`  Type: ${doc.file_type}`);
      if (doc.file_size) console.log(`  Size: ${doc.file_size} bytes`);
      if (doc.tags.length) console.log(`  Tags: ${doc.tags.join(", ")}`);
    }
  });

program
  .command("list")
  .description("List documents")
  .option("--search <query>", "Search by title or description")
  .option("--type <type>", "Filter by file type")
  .option("--status <status>", "Filter by status")
  .option("--tag <tag>", "Filter by tag")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const docs = listDocuments({
      search: opts.search,
      file_type: opts.type,
      status: opts.status,
      tag: opts.tag,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(docs, null, 2));
    } else {
      if (docs.length === 0) {
        console.log("No documents found.");
        return;
      }
      for (const d of docs) {
        const type = d.file_type ? ` [${d.file_type}]` : "";
        const tags = d.tags.length ? ` {${d.tags.join(", ")}}` : "";
        console.log(`  ${d.title}${type}  v${d.version}  ${d.status}${tags}`);
      }
      console.log(`\n${docs.length} document(s)`);
    }
  });

program
  .command("update")
  .description("Update a document")
  .argument("<id>", "Document ID")
  .option("--title <title>", "Title")
  .option("--description <text>", "Description")
  .option("--file-path <path>", "File path")
  .option("--file-type <type>", "File type")
  .option("--file-size <bytes>", "File size")
  .option("--status <status>", "Status: draft|active|archived")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.filePath !== undefined) input.file_path = opts.filePath;
    if (opts.fileType !== undefined) input.file_type = opts.fileType;
    if (opts.fileSize !== undefined) input.file_size = parseInt(opts.fileSize);
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());

    const doc = updateDocument(id, input);
    if (!doc) {
      console.error(`Document '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(doc, null, 2));
    } else {
      console.log(`Updated: ${doc.title}`);
    }
  });

program
  .command("delete")
  .description("Delete a document")
  .argument("<id>", "Document ID")
  .action((id) => {
    const deleted = deleteDocument(id);
    if (deleted) {
      console.log(`Deleted document ${id}`);
    } else {
      console.error(`Document '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("search")
  .description("Search documents")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchDocuments(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No documents matching "${query}".`);
        return;
      }
      for (const d of results) {
        console.log(`  ${d.title} ${d.file_type ? `[${d.file_type}]` : ""} (${d.status})`);
      }
    }
  });

program
  .command("count")
  .description("Count documents")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const count = countDocuments();
    if (opts.json) {
      console.log(JSON.stringify({ count }));
    } else {
      console.log(`${count} document(s)`);
    }
  });

// --- Versions ---

const versionCmd = program
  .command("version")
  .description("Document version management");

versionCmd
  .command("add")
  .description("Add a new version to a document")
  .requiredOption("--document <id>", "Document ID")
  .option("--file-path <path>", "New file path")
  .option("--notes <notes>", "Version notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const ver = addVersion({
      document_id: opts.document,
      file_path: opts.filePath,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(ver, null, 2));
    } else {
      console.log(`Added version ${ver.version} to document ${ver.document_id}`);
    }
  });

versionCmd
  .command("list")
  .description("List versions for a document")
  .argument("<document-id>", "Document ID")
  .option("--json", "Output as JSON", false)
  .action((documentId, opts) => {
    const versions = listVersions(documentId);

    if (opts.json) {
      console.log(JSON.stringify(versions, null, 2));
    } else {
      if (versions.length === 0) {
        console.log("No versions found.");
        return;
      }
      for (const v of versions) {
        const notes = v.notes ? ` — ${v.notes}` : "";
        console.log(`  v${v.version}  ${v.created_at}${notes}`);
      }
    }
  });

program.parse(process.argv);
