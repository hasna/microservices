import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "microservice-documents-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
  deleteDocument,
  countDocuments,
  searchDocuments,
  getDocumentsByTag,
  addVersion,
  listVersions,
} from "./documents";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Documents", () => {
  test("create and get document", () => {
    const doc = createDocument({
      title: "Project Proposal",
      description: "Q1 project proposal document",
      file_path: "/docs/proposal.pdf",
      file_type: "pdf",
      file_size: 1024,
      tags: ["proposal", "q1"],
    });

    expect(doc.id).toBeTruthy();
    expect(doc.title).toBe("Project Proposal");
    expect(doc.description).toBe("Q1 project proposal document");
    expect(doc.file_type).toBe("pdf");
    expect(doc.file_size).toBe(1024);
    expect(doc.version).toBe(1);
    expect(doc.status).toBe("draft");
    expect(doc.tags).toEqual(["proposal", "q1"]);

    const fetched = getDocument(doc.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(doc.id);
  });

  test("list documents", () => {
    createDocument({ title: "Meeting Notes", file_type: "docx" });
    const all = listDocuments();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("search documents", () => {
    const results = searchDocuments("Proposal");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Project Proposal");
  });

  test("filter by file type", () => {
    const results = listDocuments({ file_type: "pdf" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((d) => d.file_type === "pdf")).toBe(true);
  });

  test("filter by status", () => {
    createDocument({ title: "Active Doc", status: "active" });
    const results = listDocuments({ status: "active" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((d) => d.status === "active")).toBe(true);
  });

  test("filter by tag", () => {
    const results = getDocumentsByTag("proposal");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((d) => d.tags.includes("proposal"))).toBe(true);
  });

  test("update document", () => {
    const doc = createDocument({ title: "Draft Doc" });
    const updated = updateDocument(doc.id, {
      title: "Final Doc",
      description: "Updated description",
      status: "active",
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("Final Doc");
    expect(updated!.description).toBe("Updated description");
    expect(updated!.status).toBe("active");
  });

  test("update tags syncs junction table", () => {
    const doc = createDocument({ title: "Tagged Doc", tags: ["old"] });
    const updated = updateDocument(doc.id, { tags: ["new", "updated"] });
    expect(updated!.tags).toEqual(["new", "updated"]);

    // Verify junction table by filtering
    const byOld = getDocumentsByTag("old");
    expect(byOld.find((d) => d.id === doc.id)).toBeUndefined();

    const byNew = getDocumentsByTag("new");
    expect(byNew.find((d) => d.id === doc.id)).toBeDefined();
  });

  test("delete document", () => {
    const doc = createDocument({ title: "DeleteMe" });
    expect(deleteDocument(doc.id)).toBe(true);
    expect(getDocument(doc.id)).toBeNull();
  });

  test("count documents", () => {
    const count = countDocuments();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

describe("Document Versions", () => {
  test("add version increments document version", () => {
    const doc = createDocument({
      title: "Versioned Doc",
      file_path: "/docs/v1.pdf",
    });
    expect(doc.version).toBe(1);

    const ver = addVersion({
      document_id: doc.id,
      file_path: "/docs/v2.pdf",
      notes: "Updated formatting",
    });

    expect(ver.id).toBeTruthy();
    expect(ver.version).toBe(2);
    expect(ver.file_path).toBe("/docs/v2.pdf");
    expect(ver.notes).toBe("Updated formatting");

    // Document should now be at version 2 with new file path
    const updated = getDocument(doc.id);
    expect(updated!.version).toBe(2);
    expect(updated!.file_path).toBe("/docs/v2.pdf");
  });

  test("add multiple versions", () => {
    const doc = createDocument({ title: "Multi Version Doc" });

    addVersion({ document_id: doc.id, notes: "v2" });
    addVersion({ document_id: doc.id, notes: "v3" });
    addVersion({ document_id: doc.id, notes: "v4" });

    const updated = getDocument(doc.id);
    expect(updated!.version).toBe(4);

    const versions = listVersions(doc.id);
    expect(versions.length).toBe(3); // 3 explicit versions (v2, v3, v4)
    expect(versions[0].version).toBe(4); // Descending order
    expect(versions[2].version).toBe(2);
  });

  test("list versions returns empty for no versions", () => {
    const doc = createDocument({ title: "No Versions" });
    const versions = listVersions(doc.id);
    expect(versions.length).toBe(0);
  });

  test("add version to non-existent document throws", () => {
    expect(() => {
      addVersion({ document_id: "non-existent-id", notes: "fail" });
    }).toThrow("not found");
  });

  test("deleting document cascades to versions", () => {
    const doc = createDocument({ title: "Cascade Doc" });
    addVersion({ document_id: doc.id, notes: "v2" });

    deleteDocument(doc.id);
    const versions = listVersions(doc.id);
    expect(versions.length).toBe(0);
  });
});
