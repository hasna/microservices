#!/usr/bin/env bun
import { Command } from "commander";
import { createNote, getNote, listNotes, updateNote, deleteNote, countNotes, createFolder, listFolders, deleteFolder } from "../db/notes.js";

const program = new Command();
program.name("microservice-notes").description("Notes microservice").version("0.0.1");

program.command("add").description("Create a note")
  .requiredOption("--title <title>", "Title")
  .option("--content <text>", "Content")
  .option("--folder <id>", "Folder ID")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--pinned", "Pin the note", false)
  .option("--json", "JSON output", false)
  .action((opts) => {
    const note = createNote({ title: opts.title, content: opts.content, folder_id: opts.folder, pinned: opts.pinned, tags: opts.tags?.split(",").map((t: string) => t.trim()) });
    opts.json ? console.log(JSON.stringify(note, null, 2)) : console.log(`Created note: ${note.title} (${note.id})`);
  });

program.command("get").argument("<id>").option("--json", "", false).description("Get a note")
  .action((id, opts) => {
    const note = getNote(id);
    if (!note) { console.error(`Note '${id}' not found.`); process.exit(1); }
    opts.json ? console.log(JSON.stringify(note, null, 2)) : console.log(`${note.title}\n${note.content}`);
  });

program.command("list").option("--search <q>").option("--tag <tag>").option("--folder <id>").option("--pinned", "", false).option("--limit <n>").option("--json", "", false).description("List notes")
  .action((opts) => {
    const notes = listNotes({ search: opts.search, tag: opts.tag, folder_id: opts.folder, pinned: opts.pinned || undefined, limit: opts.limit ? parseInt(opts.limit) : undefined });
    if (opts.json) { console.log(JSON.stringify(notes, null, 2)); return; }
    if (!notes.length) { console.log("No notes."); return; }
    for (const n of notes) { const pin = n.pinned ? " [pinned]" : ""; const tags = n.tags.length ? ` [${n.tags.join(", ")}]` : ""; console.log(`  ${n.title}${pin}${tags}`); }
    console.log(`\n${notes.length} note(s)`);
  });

program.command("update").argument("<id>").option("--title <t>").option("--content <t>").option("--folder <id>").option("--tags <tags>").option("--pinned").option("--json", "", false).description("Update a note")
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.content !== undefined) input.content = opts.content;
    if (opts.folder !== undefined) input.folder_id = opts.folder;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());
    if (opts.pinned !== undefined) input.pinned = true;
    const note = updateNote(id, input);
    if (!note) { console.error(`Note '${id}' not found.`); process.exit(1); }
    opts.json ? console.log(JSON.stringify(note, null, 2)) : console.log(`Updated: ${note.title}`);
  });

program.command("delete").argument("<id>").description("Delete a note")
  .action((id) => { deleteNote(id) ? console.log(`Deleted ${id}`) : (console.error(`Not found.`), process.exit(1)); });

program.command("count").option("--json", "", false).description("Count notes")
  .action((opts) => { const c = countNotes(); opts.json ? console.log(JSON.stringify({ count: c })) : console.log(`${c} note(s)`); });

const folderCmd = program.command("folder").description("Folder management");
folderCmd.command("add").requiredOption("--name <name>").option("--parent <id>").option("--json", "", false).description("Create a folder")
  .action((opts) => { const f = createFolder(opts.name, opts.parent); opts.json ? console.log(JSON.stringify(f, null, 2)) : console.log(`Created folder: ${f.name} (${f.id})`); });
folderCmd.command("list").option("--parent <id>").option("--json", "", false).description("List folders")
  .action((opts) => { const folders = listFolders(opts.parent); opts.json ? console.log(JSON.stringify(folders, null, 2)) : folders.forEach(f => console.log(`  ${f.name}`)); });
folderCmd.command("delete").argument("<id>").description("Delete a folder")
  .action((id) => { deleteFolder(id) ? console.log(`Deleted ${id}`) : (console.error(`Not found.`), process.exit(1)); });

program.parse(process.argv);
