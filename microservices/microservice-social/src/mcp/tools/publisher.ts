import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
} from "../../lib/scheduler.js";
import {
  validateMedia,
  getSupportedFormats,
  uploadMedia,
} from "../../lib/media.js";

const PlatformEnum = z.enum(["x", "linkedin", "instagram", "threads", "bluesky"]);

export function registerPublisherTools(server: McpServer) {
  server.registerTool(
    "check_providers",
    {
      title: "Check Providers",
      description: "Check which platform API providers have env vars configured (X, Meta).",
      inputSchema: {},
    },
    async () => {
      const { checkProviders } = await import("../../lib/publisher.js");
      const providers = checkProviders();
      return { content: [{ type: "text", text: JSON.stringify(providers, null, 2) }] };
    }
  );

  server.registerTool(
    "sync_post_metrics",
    {
      title: "Sync Post Metrics",
      description: "Fetch engagement metrics from the platform API and update the post in DB.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        const { syncPostMetrics } = await import("../../lib/publisher.js");
        const post = await syncPostMetrics(id);
        return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "start_scheduler",
    {
      title: "Start Scheduler",
      description: "Start the auto-publish scheduler that checks for due posts at a regular interval.",
      inputSchema: {
        interval_ms: z.number().optional(),
      },
    },
    async ({ interval_ms }) => {
      try {
        startScheduler(interval_ms || 60000);
        const status = getSchedulerStatus();
        return { content: [{ type: "text", text: JSON.stringify({ message: "Scheduler started", ...status }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "stop_scheduler",
    {
      title: "Stop Scheduler",
      description: "Stop the auto-publish scheduler.",
      inputSchema: {},
    },
    async () => {
      stopScheduler();
      const status = getSchedulerStatus();
      return { content: [{ type: "text", text: JSON.stringify({ message: "Scheduler stopped", ...status }, null, 2) }] };
    }
  );

  server.registerTool(
    "scheduler_status",
    {
      title: "Scheduler Status",
      description: "Get the current status of the auto-publish scheduler.",
      inputSchema: {},
    },
    async () => {
      const status = getSchedulerStatus();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    }
  );

  server.registerTool(
    "upload_media",
    {
      title: "Upload Media",
      description: "Upload a media file to a social media platform.",
      inputSchema: {
        file_path: z.string(),
        platform: PlatformEnum,
        page_id: z.string().optional(),
      },
    },
    async ({ file_path, platform, page_id }) => {
      try {
        const validation = validateMedia(file_path, platform);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: JSON.stringify({ valid: false, errors: validation.errors }, null, 2) }],
            isError: true,
          };
        }

        const result = await uploadMedia(file_path, platform, page_id);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "validate_media",
    {
      title: "Validate Media",
      description: "Validate a media file for a specific platform without uploading.",
      inputSchema: {
        file_path: z.string(),
        platform: PlatformEnum,
      },
    },
    async ({ file_path, platform }) => {
      const result = validateMedia(file_path, platform);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "get_supported_formats",
    {
      title: "Get Supported Formats",
      description: "Get supported media formats for a platform.",
      inputSchema: {
        platform: PlatformEnum,
      },
    },
    async ({ platform }) => {
      const formats = getSupportedFormats(platform);
      return { content: [{ type: "text", text: JSON.stringify({ platform, formats }, null, 2) }] };
    }
  );

  server.registerTool(
    "sync_all_metrics",
    {
      title: "Sync All Metrics",
      description: "Sync engagement metrics for all published posts from the last 7 days via platform APIs.",
      inputSchema: {},
    },
    async () => {
      try {
        const { syncAllMetrics } = await import("../../lib/metrics-sync.js");
        const report = await syncAllMetrics();
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "sync_account_metrics",
    {
      title: "Sync Account Metrics",
      description: "Pull follower count and profile data from platform API for a specific account.",
      inputSchema: {
        account_id: z.string(),
      },
    },
    async ({ account_id }) => {
      try {
        const { syncAccountMetrics } = await import("../../lib/metrics-sync.js");
        const account = await syncAccountMetrics(account_id);
        if (!account) {
          return { content: [{ type: "text", text: `Account '${account_id}' not found.` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "metrics_sync_status",
    {
      title: "Metrics Sync Status",
      description: "Get the current status of the metrics sync worker, including sync report.",
      inputSchema: {},
    },
    async () => {
      const { getMetricsSyncStatus, getSyncReport } = await import("../../lib/metrics-sync.js");
      const status = getMetricsSyncStatus();
      const report = getSyncReport();
      return { content: [{ type: "text", text: JSON.stringify({ status, report }, null, 2) }] };
    }
  );
}
