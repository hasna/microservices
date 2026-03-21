/**
 * Media upload handling for social media platforms
 *
 * Provides media validation, format checking, and platform-specific
 * upload functions for X (Twitter) and Meta (Facebook/Instagram).
 */

import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import type { Platform } from "../db/social.js";

// ---- Types ----

export interface MediaUpload {
  filePath: string;
  platform: Platform;
  mediaId?: string;
  url?: string;
}

export interface UploadResult {
  mediaId: string;
  url?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---- Platform Configs ----

const SUPPORTED_FORMATS: Record<Platform, string[]> = {
  x: ["jpg", "jpeg", "png", "gif", "mp4", "webp"],
  linkedin: ["jpg", "jpeg", "png", "gif", "mp4"],
  instagram: ["jpg", "jpeg", "png", "mp4", "mov"],
  threads: ["jpg", "jpeg", "png", "gif", "mp4"],
  bluesky: ["jpg", "jpeg", "png", "gif"],
};

/** Maximum file sizes in bytes per platform */
const MAX_FILE_SIZE: Record<Platform, Record<string, number>> = {
  x: {
    image: 5 * 1024 * 1024,      // 5 MB for images
    gif: 15 * 1024 * 1024,        // 15 MB for GIFs
    video: 512 * 1024 * 1024,     // 512 MB for video
  },
  linkedin: {
    image: 10 * 1024 * 1024,
    gif: 10 * 1024 * 1024,
    video: 200 * 1024 * 1024,
  },
  instagram: {
    image: 8 * 1024 * 1024,
    video: 100 * 1024 * 1024,
  },
  threads: {
    image: 8 * 1024 * 1024,
    gif: 8 * 1024 * 1024,
    video: 100 * 1024 * 1024,
  },
  bluesky: {
    image: 1 * 1024 * 1024,      // 1 MB for Bluesky images
    gif: 1 * 1024 * 1024,
  },
};

const VIDEO_EXTENSIONS = new Set(["mp4", "mov"]);
const GIF_EXTENSIONS = new Set(["gif"]);

// ---- Helpers ----

function getFileExtension(filePath: string): string {
  return extname(filePath).slice(1).toLowerCase();
}

function getMediaType(ext: string): "image" | "gif" | "video" {
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (GIF_EXTENSIONS.has(ext)) return "gif";
  return "image";
}

// ---- Validation ----

/**
 * Get supported media formats for a platform
 */
export function getSupportedFormats(platform: Platform): string[] {
  return SUPPORTED_FORMATS[platform] || [];
}

/**
 * Validate a media file against platform requirements:
 * - File exists
 * - Format is supported
 * - File size is within limits
 */
export function validateMedia(filePath: string, platform: Platform): ValidationResult {
  const errors: string[] = [];

  // Check file exists
  if (!existsSync(filePath)) {
    return { valid: false, errors: [`File not found: ${filePath}`] };
  }

  // Check format
  const ext = getFileExtension(filePath);
  const supportedFormats = getSupportedFormats(platform);
  if (!supportedFormats.includes(ext)) {
    errors.push(
      `Format '${ext}' not supported on ${platform}. Supported: ${supportedFormats.join(", ")}`
    );
  }

  // Check file size
  const stats = statSync(filePath);
  const mediaType = getMediaType(ext);
  const platformLimits = MAX_FILE_SIZE[platform];
  const maxSize = platformLimits?.[mediaType];

  if (maxSize && stats.size > maxSize) {
    const maxMB = (maxSize / (1024 * 1024)).toFixed(0);
    const fileMB = (stats.size / (1024 * 1024)).toFixed(2);
    errors.push(
      `File size ${fileMB} MB exceeds ${platform} ${mediaType} limit of ${maxMB} MB`
    );
  }

  return { valid: errors.length === 0, errors };
}

// ---- Upload Functions ----

/**
 * Upload media to X (Twitter) using the media upload API.
 * Uses chunked upload for video, simple upload for images.
 *
 * Requires X_BEARER_TOKEN or X_ACCESS_TOKEN env var.
 */
export async function uploadToX(filePath: string): Promise<UploadResult> {
  const validation = validateMedia(filePath, "x");
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join("; ")}`);
  }

  const token = process.env["X_BEARER_TOKEN"] || process.env["X_ACCESS_TOKEN"];
  if (!token) {
    throw new Error("Missing X_BEARER_TOKEN or X_ACCESS_TOKEN environment variable");
  }

  const ext = getFileExtension(filePath);
  const mediaType = getMediaType(ext);

  if (mediaType === "video") {
    return uploadToXChunked(filePath, token);
  }

  return uploadToXSimple(filePath, token);
}

async function uploadToXSimple(filePath: string, token: string): Promise<UploadResult> {
  const file = Bun.file(filePath);
  const formData = new FormData();
  formData.append("media", file);

  const response = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`X media upload failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { media_id_string: string };
  return { mediaId: data.media_id_string };
}

async function uploadToXChunked(filePath: string, token: string): Promise<UploadResult> {
  const file = Bun.file(filePath);
  const fileSize = file.size;
  const ext = getFileExtension(filePath);
  const mimeType = ext === "mp4" ? "video/mp4" : "video/quicktime";

  // INIT
  const initResponse = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      command: "INIT",
      total_bytes: String(fileSize),
      media_type: mimeType,
    }),
  });

  if (!initResponse.ok) {
    const text = await initResponse.text();
    throw new Error(`X chunked upload INIT failed (${initResponse.status}): ${text}`);
  }

  const initData = (await initResponse.json()) as { media_id_string: string };
  const mediaId = initData.media_id_string;

  // APPEND — send in 5MB chunks
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const buffer = await file.arrayBuffer();
  let segmentIndex = 0;

  for (let offset = 0; offset < fileSize; offset += CHUNK_SIZE) {
    const chunk = buffer.slice(offset, Math.min(offset + CHUNK_SIZE, fileSize));
    const formData = new FormData();
    formData.append("command", "APPEND");
    formData.append("media_id", mediaId);
    formData.append("segment_index", String(segmentIndex));
    formData.append("media", new Blob([chunk]));

    const appendResponse = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!appendResponse.ok) {
      const text = await appendResponse.text();
      throw new Error(`X chunked upload APPEND failed (${appendResponse.status}): ${text}`);
    }

    segmentIndex++;
  }

  // FINALIZE
  const finalizeResponse = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      command: "FINALIZE",
      media_id: mediaId,
    }),
  });

  if (!finalizeResponse.ok) {
    const text = await finalizeResponse.text();
    throw new Error(`X chunked upload FINALIZE failed (${finalizeResponse.status}): ${text}`);
  }

  return { mediaId };
}

/**
 * Upload media to Meta (Facebook/Instagram) using the Graph API.
 * Uses /{page-id}/photos for images.
 *
 * Requires META_ACCESS_TOKEN env var.
 */
export async function uploadToMeta(filePath: string, pageId: string): Promise<UploadResult> {
  const validation = validateMedia(filePath, "instagram");
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join("; ")}`);
  }

  const token = process.env["META_ACCESS_TOKEN"];
  if (!token) {
    throw new Error("Missing META_ACCESS_TOKEN environment variable");
  }

  const file = Bun.file(filePath);
  const formData = new FormData();
  formData.append("source", file);
  formData.append("access_token", token);

  const response = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta media upload failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { id: string; post_id?: string };
  return { mediaId: data.id };
}

/**
 * Route upload to the correct platform uploader
 */
export async function uploadMedia(filePath: string, platform: Platform, pageId?: string): Promise<UploadResult> {
  switch (platform) {
    case "x":
      return uploadToX(filePath);
    case "instagram":
    case "linkedin":
      if (!pageId) {
        throw new Error(`Page ID required for ${platform} uploads`);
      }
      return uploadToMeta(filePath, pageId);
    default:
      throw new Error(`Media upload not yet supported for platform '${platform}'`);
  }
}
