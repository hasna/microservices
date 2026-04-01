/**
 * Files HTTP routes.
 */

import type { Sql } from "postgres";
import { z } from "zod";
import {
  bulkSoftDelete,
  createFileRecord,
  getFile,
  getStorageStats,
  listFiles,
  moveFile,
  renameFile,
  softDeleteFile,
} from "../lib/files.js";
import {
  getMimeType,
  getPresignedUrl,
  getStorageBackend,
  getUrl,
  readFromLocal,
  upload,
} from "../lib/storage.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const PresignedUrlSchema = z.object({
  key: z.string().min(1),
  workspace_id: z.string(),
  mime_type: z.string().default("application/octet-stream"),
});

const CreateFolderSchema = z.object({
  workspace_id: z.string(),
  name: z.string().min(1),
  parent_id: z.string().optional(),
});

export function makeRouter(sql: Sql) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        try {
          const start = Date.now();
          await sql`SELECT 1`;
          return json({
            ok: true,
            service: "microservice-files",
            db: true,
            latency_ms: Date.now() - start,
          });
        } catch (e) {
          return json(
            {
              ok: false,
              service: "microservice-files",
              db: false,
              error: e instanceof Error ? e.message : "db error",
            },
            503,
          );
        }
      }

      // POST /files/upload — multipart form-data
      if (method === "POST" && path === "/files/upload") {
        const contentType = req.headers.get("content-type") ?? "";
        if (!contentType.includes("multipart")) {
          return apiError(
            "INVALID_CONTENT_TYPE",
            "Content-Type must be multipart/form-data",
          );
        }

        const formData = await req.formData();
        const fileEntry = formData.get("file");
        if (!fileEntry || typeof fileEntry === "string") {
          return apiError(
            "MISSING_FILE",
            "file field required in multipart form-data",
          );
        }

        const workspaceId =
          formData.get("workspace_id")?.toString() ?? undefined;
        const folderId = formData.get("folder_id")?.toString() ?? undefined;
        const customName = formData.get("name")?.toString();
        const access = (formData.get("access")?.toString() ?? "private") as
          | "public"
          | "private"
          | "signed";
        const uploadedBy = formData.get("uploaded_by")?.toString() ?? undefined;

        const file = fileEntry as File;
        const originalName = file.name;
        const mimeType = file.type || getMimeType(originalName);
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        if (data.byteLength === 0) {
          return apiError("EMPTY_FILE", "File is empty (0 bytes)");
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
        const parsed = await parseBody(req, PresignedUrlSchema);
        if ("error" in parsed) return parsed.error;
        const { key, workspace_id, mime_type } = parsed.data;

        const backend = getStorageBackend();
        if (backend !== "s3") {
          return apiError(
            "INVALID_BACKEND",
            "Presigned URLs are only available with S3 storage backend",
          );
        }

        const bucket = process.env.S3_BUCKET;
        const region = process.env.S3_REGION ?? "us-east-1";
        const accessKeyId =
          process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey =
          process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;

        if (!bucket || !accessKeyId || !secretAccessKey) {
          return apiError(
            "MISSING_S3_CONFIG",
            "S3 credentials not configured",
            undefined,
            500,
          );
        }

        const storageKey = workspace_id ? `${workspace_id}/${key}` : key;
        const presignedUrl = await getPresignedUrl(
          storageKey,
          bucket,
          region,
          accessKeyId,
          secretAccessKey,
          3600,
        );

        return json({
          presigned_url: presignedUrl,
          storage_key: storageKey,
          workspace_id: workspace_id ?? null,
          mime_type: mime_type ?? "application/octet-stream",
          expires_in: 3600,
        });
      }

      // POST /files/folders — create folder
      if (method === "POST" && path === "/files/folders") {
        const parsed = await parseBody(req, CreateFolderSchema);
        if ("error" in parsed) return parsed.error;
        return json({ ok: true, ...parsed.data }, 201);
      }

      // GET /files — list files
      if (method === "GET" && path === "/files") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId)
          return apiError("MISSING_PARAM", "workspace_id query param required");
        const folderId = url.searchParams.get("folder_id") ?? undefined;
        const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
        const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
        const items = await listFiles(sql, workspaceId, {
          folderId,
          limit,
          offset,
        });
        return json({
          data: items,
          count: items.length,
          workspace_id: workspaceId,
        });
      }

      // GET /files/:id/download — redirect to signed URL
      if (method === "GET" && path.match(/^\/files\/[^/]+\/download$/)) {
        const id = path.split("/")[2];
        const file = await getFile(sql, id);
        if (!file)
          return apiError("NOT_FOUND", "File not found", undefined, 404);
        if (file.deleted_at)
          return apiError("GONE", "File has been deleted", undefined, 410);

        const signedUrl = await getUrl(file.storage_key, file.access);
        return Response.redirect(signedUrl, 302);
      }

      // GET /files/:id — get file metadata
      if (method === "GET" && path.match(/^\/files\/[^/]+$/)) {
        const id = path.split("/")[2];
        const file = await getFile(sql, id);
        if (!file)
          return apiError("NOT_FOUND", "File not found", undefined, 404);
        return json(file);
      }

      // DELETE /files/:id — soft delete
      if (method === "DELETE" && path.match(/^\/files\/[^/]+$/)) {
        const id = path.split("/")[2];
        const deleted = await softDeleteFile(sql, id);
        if (!deleted)
          return apiError(
            "NOT_FOUND",
            "File not found or already deleted",
            undefined,
            404,
          );
        return json({ ok: true, id });
      }

      // GET /files/stats?workspace_id=X — storage stats
      if (method === "GET" && path === "/files/stats") {
        const workspaceId = url.searchParams.get("workspace_id");
        if (!workspaceId)
          return apiError("MISSING_PARAM", "workspace_id query param required");
        const stats = await getStorageStats(sql, workspaceId);
        return json(stats);
      }

      // DELETE /files/bulk — bulk soft delete
      if (method === "DELETE" && path === "/files/bulk") {
        const BulkDeleteSchema = z.object({ ids: z.array(z.string()).min(1) });
        const parsed = await parseBody(req, BulkDeleteSchema);
        if ("error" in parsed) return parsed.error;
        const count = await bulkSoftDelete(sql, parsed.data.ids);
        return json({ deleted: count });
      }

      // PATCH /files/:id — rename
      if (method === "PATCH" && path.match(/^\/files\/[^/]+$/)) {
        const id = path.split("/")[2];
        const RenameSchema = z.object({ name: z.string().min(1) });
        const parsed = await parseBody(req, RenameSchema);
        if ("error" in parsed) return parsed.error;
        const file = await renameFile(sql, id, parsed.data.name);
        if (!file)
          return apiError(
            "NOT_FOUND",
            "File not found or already deleted",
            undefined,
            404,
          );
        return json(file);
      }

      // POST /files/:id/move — move to folder
      if (method === "POST" && path.match(/^\/files\/[^/]+\/move$/)) {
        const id = path.split("/")[2];
        const MoveSchema = z.object({ folder_id: z.string().nullable() });
        const parsed = await parseBody(req, MoveSchema);
        if ("error" in parsed) return parsed.error;
        const file = await moveFile(sql, id, parsed.data.folder_id);
        if (!file)
          return apiError(
            "NOT_FOUND",
            "File not found or already deleted",
            undefined,
            404,
          );
        return json(file);
      }

      // GET /files/serve/:key* — serve local files
      if (method === "GET" && path.startsWith("/files/serve/")) {
        const key = path.slice("/files/serve/".length);
        try {
          const data = await readFromLocal(key);
          const mimeType = getMimeType(key);
          return new Response(data as any, {
            headers: { "Content-Type": mimeType },
          });
        } catch {
          return apiError("NOT_FOUND", "File not found", undefined, 404);
        }
      }

      return apiError("NOT_FOUND", "Not found", undefined, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[microservice-files]", msg);
      return apiError("INTERNAL_ERROR", msg, undefined, 500);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function apiError(
  code: string,
  message: string,
  fields?: Record<string, string>,
  status = 400,
): Response {
  return json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    status,
  );
}

async function parseBody<T>(
  req: Request,
  schema: z.ZodSchema<T>,
): Promise<{ data: T } | { error: Response }> {
  try {
    const raw = await req.json();
    const result = schema.safeParse(raw);
    if (!result.success) {
      const fields = Object.fromEntries(
        result.error.errors.map((e) => [e.path.join(".") || "body", e.message]),
      );
      return {
        error: apiError("VALIDATION_ERROR", "Invalid request body", fields),
      };
    }
    return { data: result.data };
  } catch {
    return {
      error: apiError("INVALID_JSON", "Request body must be valid JSON"),
    };
  }
}
