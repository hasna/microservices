import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-wiki-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createPage,
  getPage,
  getPageBySlug,
  updatePage,
  deletePage,
  listPages,
  searchPages,
  getPageTree,
  getRecentlyUpdated,
  getByCategory,
  getByTag,
  getPageHistory,
  revertToVersion,
  addLink,
  removeLink,
  getLinksFrom,
  getLinksTo,
} from "./wiki";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Pages — CRUD", () => {
  test("create and get page", () => {
    const page = createPage({
      title: "Getting Started",
      content: "# Welcome\nThis is the getting started guide.",
      category: "Guides",
      author: "admin",
      tags: ["intro", "guide"],
    });

    expect(page.id).toBeTruthy();
    expect(page.title).toBe("Getting Started");
    expect(page.slug).toBe("getting-started");
    expect(page.content).toBe("# Welcome\nThis is the getting started guide.");
    expect(page.format).toBe("markdown");
    expect(page.category).toBe("Guides");
    expect(page.author).toBe("admin");
    expect(page.status).toBe("published");
    expect(page.tags).toEqual(["intro", "guide"]);
    expect(page.version).toBe(1);

    const fetched = getPage(page.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(page.id);
  });

  test("create page with custom slug", () => {
    const page = createPage({
      title: "Custom Slug Page",
      slug: "my-custom-slug",
    });

    expect(page.slug).toBe("my-custom-slug");
  });

  test("create page with html format", () => {
    const page = createPage({
      title: "HTML Page",
      content: "<h1>Hello</h1>",
      format: "html",
    });

    expect(page.format).toBe("html");
  });

  test("create page with draft status", () => {
    const page = createPage({
      title: "Draft Page",
      status: "draft",
    });

    expect(page.status).toBe("draft");
  });

  test("get page by slug", () => {
    const page = createPage({ title: "Slug Lookup Test" });
    const fetched = getPageBySlug(page.slug!);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(page.id);
  });

  test("get nonexistent page returns null", () => {
    expect(getPage("nonexistent-id")).toBeNull();
  });

  test("get nonexistent slug returns null", () => {
    expect(getPageBySlug("nonexistent-slug")).toBeNull();
  });

  test("update page", () => {
    const page = createPage({ title: "To Update", content: "Original" });
    const updated = updatePage(page.id, {
      title: "Updated Title",
      content: "Updated content",
      category: "Docs",
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("Updated Title");
    expect(updated!.content).toBe("Updated content");
    expect(updated!.category).toBe("Docs");
    expect(updated!.version).toBe(2);
  });

  test("update nonexistent page returns null", () => {
    expect(updatePage("nonexistent", { title: "test" })).toBeNull();
  });

  test("update with no changes returns existing", () => {
    const page = createPage({ title: "No Change" });
    const result = updatePage(page.id, {});
    expect(result).toBeDefined();
    expect(result!.title).toBe("No Change");
  });

  test("delete page", () => {
    const page = createPage({ title: "Delete Me" });
    expect(deletePage(page.id)).toBe(true);
    expect(getPage(page.id)).toBeNull();
  });

  test("delete nonexistent page returns false", () => {
    expect(deletePage("nonexistent")).toBe(false);
  });
});

describe("Pages — Listing & Search", () => {
  test("list pages", () => {
    const all = listPages();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  test("list pages with category filter", () => {
    createPage({ title: "Cat Page 1", category: "Engineering" });
    createPage({ title: "Cat Page 2", category: "Engineering" });
    const results = listPages({ category: "Engineering" });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((p) => p.category === "Engineering")).toBe(true);
  });

  test("list pages with status filter", () => {
    createPage({ title: "Archived Page", status: "archived" });
    const results = listPages({ status: "archived" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((p) => p.status === "archived")).toBe(true);
  });

  test("list pages with tag filter", () => {
    createPage({ title: "Tagged Page", tags: ["special-tag"] });
    const results = listPages({ tag: "special-tag" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((p) => p.tags.includes("special-tag"))).toBe(true);
  });

  test("list pages with limit", () => {
    const results = listPages({ limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("search pages by title", () => {
    createPage({ title: "Unique Searchable Title" });
    const results = searchPages("Unique Searchable");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe("Unique Searchable Title");
  });

  test("search pages by content", () => {
    createPage({ title: "Content Search Page", content: "supercalifragilistic" });
    const results = searchPages("supercalifragilistic");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("get recently updated", () => {
    const recent = getRecentlyUpdated(5);
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent.length).toBeLessThanOrEqual(5);
  });

  test("get by category", () => {
    const pages = getByCategory("Engineering");
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });

  test("get by tag", () => {
    const pages = getByTag("intro");
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Pages — Tree", () => {
  test("get page tree with parent-child hierarchy", () => {
    const parent = createPage({ title: "Parent Page" });
    createPage({ title: "Child Page 1", parent_id: parent.id });
    createPage({ title: "Child Page 2", parent_id: parent.id });

    const tree = getPageTree();
    const parentNode = tree.find((n) => n.id === parent.id);
    expect(parentNode).toBeDefined();
    expect(parentNode!.children.length).toBe(2);
  });
});

describe("Pages — Version History", () => {
  test("update creates version history entry", () => {
    const page = createPage({ title: "Versioned", content: "v1 content", author: "alice" });
    updatePage(page.id, { content: "v2 content", author: "bob" });

    const history = getPageHistory(page.id);
    expect(history.length).toBe(1);
    expect(history[0].version).toBe(1);
    expect(history[0].content).toBe("v1 content");
    expect(history[0].author).toBe("alice");
  });

  test("multiple updates create multiple versions", () => {
    const page = createPage({ title: "Multi Version", content: "v1" });
    updatePage(page.id, { content: "v2" });
    updatePage(page.id, { content: "v3" });

    const history = getPageHistory(page.id);
    expect(history.length).toBe(2);
  });

  test("revert to version", () => {
    const page = createPage({ title: "Revert Test", content: "Original content" });
    updatePage(page.id, { content: "Changed content" });

    const history = getPageHistory(page.id);
    expect(history.length).toBe(1);
    expect(history[0].version).toBe(1);

    const reverted = revertToVersion(page.id, 1);
    expect(reverted).toBeDefined();
    expect(reverted!.content).toBe("Original content");
    expect(reverted!.version).toBe(3); // was 2, now incremented to 3
  });

  test("revert nonexistent page returns null", () => {
    expect(revertToVersion("nonexistent", 1)).toBeNull();
  });

  test("revert to nonexistent version returns null", () => {
    const page = createPage({ title: "No Such Version" });
    expect(revertToVersion(page.id, 999)).toBeNull();
  });
});

describe("Pages — Links", () => {
  test("add and get links from/to", () => {
    const p1 = createPage({ title: "Link Source" });
    const p2 = createPage({ title: "Link Target" });

    const link = addLink(p1.id, p2.id);
    expect(link.source_id).toBe(p1.id);
    expect(link.target_id).toBe(p2.id);

    const from = getLinksFrom(p1.id);
    expect(from.length).toBe(1);
    expect(from[0].target_id).toBe(p2.id);

    const to = getLinksTo(p2.id);
    expect(to.length).toBe(1);
    expect(to[0].source_id).toBe(p1.id);
  });

  test("add duplicate link is idempotent", () => {
    const p1 = createPage({ title: "Dup Source" });
    const p2 = createPage({ title: "Dup Target" });

    addLink(p1.id, p2.id);
    addLink(p1.id, p2.id); // duplicate

    const from = getLinksFrom(p1.id);
    expect(from.length).toBe(1);
  });

  test("remove link", () => {
    const p1 = createPage({ title: "Rem Source" });
    const p2 = createPage({ title: "Rem Target" });

    addLink(p1.id, p2.id);
    expect(removeLink(p1.id, p2.id)).toBe(true);

    const from = getLinksFrom(p1.id);
    expect(from.length).toBe(0);
  });

  test("remove nonexistent link returns false", () => {
    expect(removeLink("nope1", "nope2")).toBe(false);
  });

  test("get links from page with no links", () => {
    const p = createPage({ title: "No Links" });
    expect(getLinksFrom(p.id)).toEqual([]);
    expect(getLinksTo(p.id)).toEqual([]);
  });
});
