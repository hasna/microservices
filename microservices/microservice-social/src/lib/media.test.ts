import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "social-media-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

// Create temp media files for testing
const mediaDir = join(tempDir, "media");
mkdirSync(mediaDir, { recursive: true });

// Small valid image file (1x1 PNG)
const smallPng = join(mediaDir, "small.png");
writeFileSync(smallPng, Buffer.alloc(100)); // 100 bytes

const smallJpg = join(mediaDir, "photo.jpg");
writeFileSync(smallJpg, Buffer.alloc(200));

const smallGif = join(mediaDir, "anim.gif");
writeFileSync(smallGif, Buffer.alloc(300));

const smallMp4 = join(mediaDir, "video.mp4");
writeFileSync(smallMp4, Buffer.alloc(500));

const smallMov = join(mediaDir, "clip.mov");
writeFileSync(smallMov, Buffer.alloc(400));

const txtFile = join(mediaDir, "doc.txt");
writeFileSync(txtFile, "hello world");

const webpFile = join(mediaDir, "image.webp");
writeFileSync(webpFile, Buffer.alloc(150));

// Large file that exceeds Bluesky's 1MB limit
const largeFile = join(mediaDir, "large.jpg");
writeFileSync(largeFile, Buffer.alloc(2 * 1024 * 1024)); // 2 MB

import { closeDatabase } from "../db/database";
import {
  getSupportedFormats,
  validateMedia,
  type MediaUpload,
  type ValidationResult,
} from "./media";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ---- getSupportedFormats ----

describe("getSupportedFormats", () => {
  test("returns formats for X", () => {
    const formats = getSupportedFormats("x");
    expect(formats).toContain("jpg");
    expect(formats).toContain("png");
    expect(formats).toContain("gif");
    expect(formats).toContain("mp4");
    expect(formats).toContain("webp");
  });

  test("returns formats for LinkedIn", () => {
    const formats = getSupportedFormats("linkedin");
    expect(formats).toContain("jpg");
    expect(formats).toContain("mp4");
    expect(formats).not.toContain("webp");
  });

  test("returns formats for Instagram", () => {
    const formats = getSupportedFormats("instagram");
    expect(formats).toContain("jpg");
    expect(formats).toContain("mov");
    expect(formats).not.toContain("gif");
  });

  test("returns formats for Bluesky", () => {
    const formats = getSupportedFormats("bluesky");
    expect(formats).toContain("jpg");
    expect(formats).toContain("png");
    expect(formats).not.toContain("mp4");
  });

  test("returns formats for Threads", () => {
    const formats = getSupportedFormats("threads");
    expect(formats).toContain("gif");
    expect(formats).toContain("mp4");
  });
});

// ---- validateMedia ----

describe("validateMedia", () => {
  test("valid PNG for X", () => {
    const result = validateMedia(smallPng, "x");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("valid JPG for LinkedIn", () => {
    const result = validateMedia(smallJpg, "linkedin");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("valid MP4 for X", () => {
    const result = validateMedia(smallMp4, "x");
    expect(result.valid).toBe(true);
  });

  test("valid GIF for X", () => {
    const result = validateMedia(smallGif, "x");
    expect(result.valid).toBe(true);
  });

  test("rejects non-existent file", () => {
    const result = validateMedia("/tmp/does-not-exist.jpg", "x");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("File not found");
  });

  test("rejects unsupported format for platform", () => {
    // .txt is not supported on any platform
    const result = validateMedia(txtFile, "x");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not supported");
  });

  test("rejects GIF on Instagram", () => {
    const result = validateMedia(smallGif, "instagram");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not supported on instagram");
  });

  test("rejects MP4 on Bluesky", () => {
    const result = validateMedia(smallMp4, "bluesky");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not supported on bluesky");
  });

  test("rejects oversized file for Bluesky", () => {
    // largeFile is 2MB, Bluesky limit is 1MB
    const result = validateMedia(largeFile, "bluesky");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exceeds"))).toBe(true);
  });

  test("allows large file within X image limit", () => {
    // largeFile is 2MB, X image limit is 5MB
    const result = validateMedia(largeFile, "x");
    expect(result.valid).toBe(true);
  });

  test("webp is valid for X", () => {
    const result = validateMedia(webpFile, "x");
    expect(result.valid).toBe(true);
  });

  test("webp is invalid for LinkedIn", () => {
    const result = validateMedia(webpFile, "linkedin");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not supported");
  });

  test("MOV is valid for Instagram", () => {
    const result = validateMedia(smallMov, "instagram");
    expect(result.valid).toBe(true);
  });
});
