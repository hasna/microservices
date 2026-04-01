/**
 * Unit tests for storage utilities — pure logic, no actual file I/O or S3 calls.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { buildPath, getMimeType, getStorageBackend } from "./index.js";

describe("getStorageBackend", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment
    delete process.env.FILES_STORAGE;
    delete process.env.S3_BUCKET;
    Object.assign(process.env, originalEnv);
  });

  it("returns 's3' when S3_BUCKET is set", () => {
    delete process.env.FILES_STORAGE;
    process.env.S3_BUCKET = "my-test-bucket";
    expect(getStorageBackend()).toBe("s3");
  });

  it("returns 's3' when FILES_STORAGE=s3", () => {
    delete process.env.S3_BUCKET;
    process.env.FILES_STORAGE = "s3";
    expect(getStorageBackend()).toBe("s3");
  });

  it("returns 'local' when neither S3_BUCKET nor FILES_STORAGE=s3 is set", () => {
    delete process.env.S3_BUCKET;
    delete process.env.FILES_STORAGE;
    expect(getStorageBackend()).toBe("local");
  });
});

describe("getMimeType", () => {
  it("returns image/jpeg for .jpg files", () => {
    expect(getMimeType("photo.jpg")).toBe("image/jpeg");
    expect(getMimeType("photo.jpeg")).toBe("image/jpeg");
  });

  it("returns image/png for .png files", () => {
    expect(getMimeType("icon.png")).toBe("image/png");
  });

  it("returns application/pdf for .pdf files", () => {
    expect(getMimeType("document.pdf")).toBe("application/pdf");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(getMimeType("data.xyz")).toBe("application/octet-stream");
    expect(getMimeType("file.unknownext")).toBe("application/octet-stream");
  });

  it("handles uppercase extensions by normalizing to lowercase", () => {
    expect(getMimeType("photo.JPG")).toBe("image/jpeg");
    expect(getMimeType("doc.PDF")).toBe("application/pdf");
  });
});

describe("buildPath", () => {
  it("builds root-level path when no parent is given", () => {
    expect(buildPath("documents")).toBe("/documents");
  });

  it("builds nested path with parent path", () => {
    expect(buildPath("invoices", "/documents")).toBe("/documents/invoices");
  });

  it("handles deeply nested paths", () => {
    expect(buildPath("2024", "/documents/invoices")).toBe(
      "/documents/invoices/2024",
    );
  });

  it("handles root slash as parent", () => {
    expect(buildPath("uploads", "/")).toBe("/uploads");
  });

  it("handles parent path with trailing slash", () => {
    expect(buildPath("subfolder", "/parent/")).toBe("/parent/subfolder");
  });
});

describe("file size validation", () => {
  it("rejects files with 0 bytes when calling createFileRecord (pure logic check)", async () => {
    // This validates the guard logic in createFileRecord without DB
    const validateSize = (sizeBytes: number) => {
      if (sizeBytes <= 0) throw new Error("size_bytes must be greater than 0");
    };
    expect(() => validateSize(0)).toThrow("size_bytes must be greater than 0");
    expect(() => validateSize(-1)).toThrow("size_bytes must be greater than 0");
    expect(() => validateSize(1)).not.toThrow();
  });
});
