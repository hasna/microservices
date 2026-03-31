/**
 * Storage backends — S3 (via SigV4) and local filesystem.
 */

import { createHmac, createHash } from "crypto";
import { join } from "path";
import { mkdir, writeFile, unlink, readFile } from "fs/promises";
import { existsSync } from "fs";

// ─── MIME TYPE DETECTION ──────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function getMimeType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

// ─── STORAGE BACKEND DETECTION ───────────────────────────────────────────────

export type StorageBackend = "s3" | "local";

export function getStorageBackend(): StorageBackend {
  if (process.env["FILES_STORAGE"] === "s3" || process.env["S3_BUCKET"]) {
    return "s3";
  }
  return "local";
}

// ─── AWS SIGNATURE V4 ────────────────────────────────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  return kSigning;
}

function formatDate(d: Date): { dateStamp: string; amzDate: string } {
  const iso = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return {
    dateStamp: iso.slice(0, 8),
    amzDate: iso,
  };
}

// ─── S3 BACKEND ──────────────────────────────────────────────────────────────

export async function uploadToS3(
  key: string,
  data: Buffer | Uint8Array,
  mimeType: string,
  bucket: string,
  region: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<void> {
  const now = new Date();
  const { dateStamp, amzDate } = formatDate(now);
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${key}`;

  const payloadHash = sha256Hex(Buffer.from(data));
  const canonicalHeaders =
    `content-type:${mimeType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorizationHeader,
    },
    body: data,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`S3 upload failed: ${resp.status} ${text}`);
  }
}

export async function getPresignedUrl(
  key: string,
  bucket: string,
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  expiresIn = 3600
): Promise<string> {
  const now = new Date();
  const { dateStamp, amzDate } = formatDate(now);
  const host = `${bucket}.s3.${region}.amazonaws.com`;

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  });

  const canonicalQueryString = queryParams.toString();
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";

  const canonicalRequest = [
    "GET",
    `/${key}`,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return `https://${host}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export async function deleteFromS3(
  key: string,
  bucket: string,
  region: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<void> {
  const now = new Date();
  const { dateStamp, amzDate } = formatDate(now);
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${key}`;

  const payloadHash = sha256Hex("");
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "DELETE",
    `/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorizationHeader,
    },
  });

  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text();
    throw new Error(`S3 delete failed: ${resp.status} ${text}`);
  }
}

// ─── LOCAL BACKEND ───────────────────────────────────────────────────────────

function getLocalDir(): string {
  return (
    process.env["FILES_LOCAL_DIR"] ??
    join(process.env["HOME"] ?? "/tmp", ".hasna", "files", "uploads")
  );
}

function getLocalPort(): number {
  return parseInt(process.env["FILES_PORT"] ?? "3005", 10);
}

export async function uploadToLocal(key: string, data: Buffer | Uint8Array): Promise<string> {
  const dir = getLocalDir();
  const filePath = join(dir, key);
  const fileDir = filePath.slice(0, filePath.lastIndexOf("/"));

  if (!existsSync(fileDir)) {
    await mkdir(fileDir, { recursive: true });
  }

  await writeFile(filePath, data);
  return filePath;
}

export function getLocalUrl(key: string): string {
  return `http://localhost:${getLocalPort()}/files/serve/${key}`;
}

export async function deleteFromLocal(key: string): Promise<void> {
  const dir = getLocalDir();
  const filePath = join(dir, key);
  try {
    await unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

export async function readFromLocal(key: string): Promise<Buffer> {
  const dir = getLocalDir();
  const filePath = join(dir, key);
  return readFile(filePath);
}

// ─── UNIFIED STORAGE API ──────────────────────────────────────────────────────

function getS3Config() {
  const bucket = process.env["S3_BUCKET"];
  const region = process.env["S3_REGION"] ?? "us-east-1";
  const accessKeyId = process.env["S3_ACCESS_KEY_ID"] ?? process.env["AWS_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["S3_SECRET_ACCESS_KEY"] ?? process.env["AWS_SECRET_ACCESS_KEY"];
  return { bucket, region, accessKeyId, secretAccessKey };
}

export async function upload(key: string, data: Buffer | Uint8Array, mimeType: string): Promise<string> {
  const backend = getStorageBackend();
  if (backend === "s3") {
    const { bucket, region, accessKeyId, secretAccessKey } = getS3Config();
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("S3_BUCKET, S3_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID), and S3_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY) are required for S3 storage");
    }
    await uploadToS3(key, data, mimeType, bucket, region, accessKeyId, secretAccessKey);
    return key;
  }
  await uploadToLocal(key, data);
  return key;
}

export async function getUrl(key: string, access: "public" | "private" | "signed"): Promise<string> {
  const backend = getStorageBackend();
  if (backend === "s3") {
    const { bucket, region, accessKeyId, secretAccessKey } = getS3Config();
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("S3 credentials required");
    }
    if (access === "public") {
      return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    }
    return getPresignedUrl(key, bucket, region, accessKeyId, secretAccessKey);
  }
  return getLocalUrl(key);
}

export async function deleteFile(key: string): Promise<void> {
  const backend = getStorageBackend();
  if (backend === "s3") {
    const { bucket, region, accessKeyId, secretAccessKey } = getS3Config();
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("S3 credentials required");
    }
    await deleteFromS3(key, bucket, region, accessKeyId, secretAccessKey);
  } else {
    await deleteFromLocal(key);
  }
}
