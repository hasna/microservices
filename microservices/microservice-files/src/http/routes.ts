/**
 * Files HTTP routes.
 */

import type { Sql } from "postgres";
import {
  createFileRecord,
  getFile,
  listFiles,
  softDeleteFile,
} from "../lib/files.js";
import { upload, getUrl, getMimeType, getStorageBackend, getPresignedUrl, readFromLocal } from "../lib/storage.js";

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        return json({ ok: true, service: "microservice-files", storage: getStorageBackend() });
      }

      // POST /files/upload — multipart form-data
      if (method === "POST" && path === "/files/upload") {
        const formData = await req.formData();
        const fileEntry = formData.get("file");
        if (!fileEntry || typeof fileEntry === "string") {
          return json({ error: "file field required in multipart form-data" }, 400);
        }

        const workspaceId = formData.get("workspace_id")?.toString() ?? undefined;
        const folderId = formData.get("folder_id")?.toString() ?? undefined;
        const customName = formData.get("name")?.toString();
        const access = (formData.get("access")?.toString() ?? "private") as "public" | "private" | "signed";
        const uploadedBy = formData.get("uploaded_by")?.toString() ?? undefined;

        const file = fileEntry as File;
        const originalName = file.name;
        const mimeType = file.type || getMimeType(originalName);
        const arrayBuffer = await file.arrayBuffer();
        const data = Buffer.from(arrayBuffer);

        if (data.byteLength === 0) {
          return json({ error: "File is empty (0 bytes)" }, 400);
        }

        const timestamp = Date.now();
        const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storageKey = workspaceId
          ? `${workspaceId}/${timestamp}_${safeName}`
          : `uploads/${timestamp}_${safeName}`;

        await upload(storageKey, data, mimeType);

        let fileUrl: string | undefined;
        if (access === "public") {
          fileUrl = await getUrl(storageKey, "public");
        }

        const record = await createFileRecord(sql, {
          workspace_id: workspaceId,
          folder_id: folderId,
          name: customName ?? originalName,
          original_name: originalName,
          mime_type: mimeType,
          size_bytes: data.byteLength,
          storage: getStorageBackend(),
          storage_key: storageKey,
          url: fileUrl,
          access,
          uploaded_by: uploadedBy,
        });

        return json(record, 201);
      }

      // POST /files/presigned-url — returns presigned S3 upload URL
      if (method === "POST" && path === "/files/presigned-url") {
        const { key, workspace_id, mime_type } = await req.json();
        if (!key) return json({ error: "key required" }, 400);

        const backend = getStorageBackend();
        if (backend !== "s3") {
          return json({ error: "Presigned URLs are only available with S3 storage backend" }, 400);
        }

        const bucket = process.env["S3_BUCKET"];
        const region = process.env["S3_REGION"] ?? "us-east-1";
        const accessKeyId = process.env["S3_ACCESS_KEY_ID"] ?? process.env["AWS_ACCESS_KEY_ID"];
        const secretAccessKey = process.env["S3_SECRET_ACCESS_KEY"] ?? process.env["AWS_SECRET_ACCESS_KEY"];

        if (!bucket || !accessKeyId || !secretAccessKey) {
          return json({ error: "S3 credentials not configured" }, 500);
        }

        const storageKey = workspace_id ? `${workspace_id}/${key}` : key;
        const presignedUrl = await getPresignedUrl(storageKey, bucket, region, accessKeyId, secretAccessKey, 3600);

        return json({
          presigned_url: presignedUrl,
          storage_key: storageKey,
          workspace_id: workspace_id ?? null,
          mime_type: mime_type ?? "application/octet-stream",
          expires_in: 3600,
        });
      }

      // GET /files — list files
      if (method === "GET" && path === "/files") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId) return json({ error: "workspace_id query param required" }, 400);
        const folderId = url.searchParams.get("folder_id") ?? undefined;
        const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
        const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
        const files = await listFiles(sql, workspaceId, { folderId, limit, offset });
        return json({ files, workspace_id: workspaceId });
      }

      // GET /files/:id/download — redirect to signed URL
      if (method === "GET" && path.match(/^\/files\/[^/]+\/download$/)) {
        const id = path.split("/")[2];
        const file = await getFile(sql, id);
        if (!file) return json({ error: "File not found" }, 404);
        if (file.deleted_at) return json({ error: "File has been deleted" }, 410);

        const signedUrl = await getUrl(file.storage_key, file.access);
        return Response.redirect(signedUrl, 302);
      }

      // GET /files/:id — get file metadata
      if (method === "GET" && path.match(/^\/files\/[^/]+$/)) {
        const id = path.split("/")[2];
        const file = await getFile(sql, id);
        if (!file) return json({ error: "File not found" }, 404);
        return json(file);
      }

      // DELETE /files/:id — soft delete
      if (method === "DELETE" && path.match(/^\/files\/[^/]+$/)) {
        const id = path.split("/")[2];
        const deleted = await softDeleteFile(sql, id);
        if (!deleted) return json({ error: "File not found or already deleted" }, 404);
        return json({ ok: true, id });
      }

      // GET /files/serve/:key* — serve local files
      if (method === "GET" && path.startsWith("/files/serve/")) {
        const key = path.slice("/files/serve/".length);
        try {
          const data = await readFromLocal(key);
          const mimeType = getMimeType(key);
          return new Response(data, {
            headers: { "Content-Type": mimeType },
          });
        } catch {
          return json({ error: "File not found" }, 404);
        }
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[microservice-files]", msg);
      return json({ error: msg }, 500);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
