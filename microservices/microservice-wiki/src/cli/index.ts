#!/usr/bin/env bun

import { Command } from "commander";
import {
  createPage,
  getPage,
  getPageBySlug,
  listPages,
  updatePage,
  deletePage,
  searchPages,
  getPageTree,
  getRecentlyUpdated,
  getByCategory,
  getByTag,
  getPageHistory,
  revertToVersion,
  type PageTreeNode,
} from "../db/wiki.js";

const program = new Command();

program
  .name("microservice-wiki")
  .description("Wiki microservice")
  .version("0.0.1");

// --- Pages ---

const pageCmd = program
  .command("page")
  .description("Page management");

pageCmd
  .command("create")
  .description("Create a new page")
  .requiredOption("--title <title>", "Page title")
  .option("--slug <slug>", "URL slug (auto-generated from title if omitted)")
  .option("--content <content>", "Page content")
  .option("--format <format>", "Content format (markdown or html)", "markdown")
  .option("--category <category>", "Category")
  .option("--parent <id>", "Parent page ID")
  .option("--author <author>", "Author name")
  .option("--status <status>", "Status (draft, published, archived)", "published")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const page = createPage({
      title: opts.title,
      slug: opts.slug,
      content: opts.content,
      format: opts.format,
      category: opts.category,
      parent_id: opts.parent,
      author: opts.author,
      status: opts.status,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(page, null, 2));
    } else {
      console.log(`Created page: ${page.title} (${page.id})`);
      console.log(`  Slug: ${page.slug}`);
    }
  });

pageCmd
  .command("get")
  .description("Get a page by ID or slug")
  .argument("<id-or-slug>", "Page ID or slug")
  .option("--json", "Output as JSON", false)
  .action((idOrSlug, opts) => {
    let page = getPage(idOrSlug);
    if (!page) page = getPageBySlug(idOrSlug);
    if (!page) {
      console.error(`Page '${idOrSlug}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(page, null, 2));
    } else {
      console.log(`${page.title} (v${page.version})`);
      console.log(`  Slug: ${page.slug}`);
      console.log(`  Status: ${page.status}`);
      console.log(`  Format: ${page.format}`);
      if (page.category) console.log(`  Category: ${page.category}`);
      if (page.author) console.log(`  Author: ${page.author}`);
      if (page.tags.length) console.log(`  Tags: ${page.tags.join(", ")}`);
      if (page.content) console.log(`\n${page.content}`);
    }
  });

pageCmd
  .command("list")
  .description("List pages")
  .option("--search <query>", "Search by title or content")
  .option("--category <category>", "Filter by category")
  .option("--status <status>", "Filter by status")
  .option("--tag <tag>", "Filter by tag")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const pages = listPages({
      search: opts.search,
      category: opts.category,
      status: opts.status,
      tag: opts.tag,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(pages, null, 2));
    } else {
      if (pages.length === 0) {
        console.log("No pages found.");
        return;
      }
      for (const p of pages) {
        const status = p.status !== "published" ? ` [${p.status}]` : "";
        const tags = p.tags.length ? ` (${p.tags.join(", ")})` : "";
        console.log(`  ${p.title}${status}${tags} — /${p.slug}`);
      }
      console.log(`\n${pages.length} page(s)`);
    }
  });

pageCmd
  .command("update")
  .description("Update a page")
  .argument("<id>", "Page ID")
  .option("--title <title>", "Title")
  .option("--slug <slug>", "Slug")
  .option("--content <content>", "Content")
  .option("--format <format>", "Format")
  .option("--category <category>", "Category")
  .option("--parent <id>", "Parent page ID")
  .option("--author <author>", "Author")
  .option("--status <status>", "Status")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.slug !== undefined) input.slug = opts.slug;
    if (opts.content !== undefined) input.content = opts.content;
    if (opts.format !== undefined) input.format = opts.format;
    if (opts.category !== undefined) input.category = opts.category;
    if (opts.parent !== undefined) input.parent_id = opts.parent;
    if (opts.author !== undefined) input.author = opts.author;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());

    const page = updatePage(id, input);
    if (!page) {
      console.error(`Page '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(page, null, 2));
    } else {
      console.log(`Updated: ${page.title} (v${page.version})`);
    }
  });

pageCmd
  .command("delete")
  .description("Delete a page")
  .argument("<id>", "Page ID")
  .action((id) => {
    const deleted = deletePage(id);
    if (deleted) {
      console.log(`Deleted page ${id}`);
    } else {
      console.error(`Page '${id}' not found.`);
      process.exit(1);
    }
  });

pageCmd
  .command("search")
  .description("Search pages")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchPages(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No pages matching "${query}".`);
        return;
      }
      for (const p of results) {
        console.log(`  ${p.title} — /${p.slug}`);
      }
    }
  });

pageCmd
  .command("tree")
  .description("Show page tree (hierarchical)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const tree = getPageTree();

    if (opts.json) {
      console.log(JSON.stringify(tree, null, 2));
    } else {
      if (tree.length === 0) {
        console.log("No pages found.");
        return;
      }
      function printTree(nodes: PageTreeNode[], indent: number = 0) {
        for (const node of nodes) {
          const prefix = "  ".repeat(indent);
          console.log(`${prefix}${node.title} — /${node.slug}`);
          if (node.children.length > 0) {
            printTree(node.children, indent + 1);
          }
        }
      }
      printTree(tree);
    }
  });

pageCmd
  .command("history")
  .description("Show version history for a page")
  .argument("<id>", "Page ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const history = getPageHistory(id);

    if (opts.json) {
      console.log(JSON.stringify(history, null, 2));
    } else {
      if (history.length === 0) {
        console.log("No version history.");
        return;
      }
      for (const v of history) {
        console.log(`  v${v.version} — ${v.title || "(no title)"} by ${v.author || "unknown"} at ${v.changed_at}`);
      }
    }
  });

pageCmd
  .command("revert")
  .description("Revert a page to a previous version")
  .argument("<id>", "Page ID")
  .requiredOption("--version <n>", "Version number to revert to")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const page = revertToVersion(id, parseInt(opts.version));
    if (!page) {
      console.error(`Page '${id}' or version ${opts.version} not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(page, null, 2));
    } else {
      console.log(`Reverted to v${opts.version}: ${page.title} (now v${page.version})`);
    }
  });

pageCmd
  .command("recent")
  .description("Show recently updated pages")
  .option("--limit <n>", "Number of results", "10")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const pages = getRecentlyUpdated(parseInt(opts.limit));

    if (opts.json) {
      console.log(JSON.stringify(pages, null, 2));
    } else {
      if (pages.length === 0) {
        console.log("No pages found.");
        return;
      }
      for (const p of pages) {
        console.log(`  ${p.title} — updated ${p.updated_at}`);
      }
    }
  });

// --- Categories & Tags (top-level for convenience) ---

program
  .command("categories")
  .description("List all categories")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const pages = listPages();
    const categories = [...new Set(pages.map((p) => p.category).filter(Boolean))] as string[];
    categories.sort();

    if (opts.json) {
      console.log(JSON.stringify(categories));
    } else {
      if (categories.length === 0) {
        console.log("No categories found.");
        return;
      }
      for (const cat of categories) {
        const count = pages.filter((p) => p.category === cat).length;
        console.log(`  ${cat} (${count})`);
      }
    }
  });

program
  .command("tags")
  .description("List all tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const pages = listPages();
    const tagCounts = new Map<string, number>();
    for (const p of pages) {
      for (const tag of p.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    const tags = [...tagCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    if (opts.json) {
      console.log(JSON.stringify(Object.fromEntries(tags)));
    } else {
      if (tags.length === 0) {
        console.log("No tags found.");
        return;
      }
      for (const [tag, count] of tags) {
        console.log(`  ${tag} (${count})`);
      }
    }
  });

program.parse(process.argv);
