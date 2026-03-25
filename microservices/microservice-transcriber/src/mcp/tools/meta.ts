import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig, setConfig, resetConfig } from "../../lib/config.js";

export function registerMetaTools(server: McpServer) {
  // ---------------------------------------------------------------------------
  // get_config / set_config / reset_config
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get_config",
    {
      title: "Get Config",
      description: "Get current transcriber configuration defaults.",
      inputSchema: {},
    },
    async () => {
      const cfg = getConfig();
      return { content: [{ type: "text", text: JSON.stringify(cfg, null, 2) }] };
    }
  );

  server.registerTool(
    "set_config",
    {
      title: "Set Config",
      description: "Update transcriber configuration defaults.",
      inputSchema: {
        defaultProvider: z.enum(["elevenlabs", "openai", "deepgram"]).optional(),
        defaultLanguage: z.string().optional(),
        defaultFormat: z.enum(["txt", "srt", "vtt", "json"]).optional(),
        diarize: z.boolean().optional(),
      },
    },
    async (updates) => {
      const cfg = setConfig(updates);
      return { content: [{ type: "text", text: JSON.stringify(cfg, null, 2) }] };
    }
  );

  server.registerTool(
    "reset_config",
    {
      title: "Reset Config",
      description: "Reset all transcriber configuration to defaults.",
      inputSchema: {},
    },
    async () => {
      const cfg = resetConfig();
      return { content: [{ type: "text", text: JSON.stringify(cfg, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // search_tools / describe_tools
  // ---------------------------------------------------------------------------

  server.registerTool(
    "search_tools",
    {
      title: "Search Tools",
      description: "List tool names, optionally filtered by keyword.",
      inputSchema: { query: z.string().optional() },
    },
    async ({ query }) => {
      const all = [
        "transcribe",
        "batch_transcribe",
        "download_audio",
        "get_video_info",
        "list_transcripts",
        "get_transcript",
        "search_transcripts",
        "retry_transcript",
        "delete_transcript",
        "export_transcript",
        "transcript_stats",
        "check_providers",
        "translate_transcript",
        "summarize_transcript",
        "get_config",
        "set_config",
        "reset_config",
        "list_comments",
        "top_comments",
        "search_comments",
        "comment_stats",
        "proofread_transcript",
        "list_proofread_issues",
        "apply_suggestion",
        "dismiss_issue",
        "proofread_stats",
        "export_annotated",
        "search_tools",
        "describe_tools",
      ];
      const matches = query ? all.filter((n) => n.includes(query.toLowerCase())) : all;
      return { content: [{ type: "text" as const, text: matches.join(", ") }] };
    }
  );

  server.registerTool(
    "describe_tools",
    {
      title: "Describe Tools",
      description: "Get full descriptions for specific tools.",
      inputSchema: { names: z.array(z.string()) },
    },
    async ({ names }) => {
      const descriptions: Record<string, string> = {
        transcribe: "Transcribe a file or URL. Params: source, provider? (elevenlabs|openai), language?, title?, start?, end?",
        get_video_info: "Fetch video metadata without downloading. Params: url",
        list_transcripts: "List transcripts. Params: status?, provider?, source_type?, limit?, offset?",
        get_transcript: "Get a transcript by ID. Params: id",
        search_transcripts: "Full-text search. Params: query",
        retry_transcript: "Retry a failed transcript. Params: id, provider?, diarize?",
        delete_transcript: "Delete a transcript. Params: id",
        export_transcript: "Export as txt/srt/json. Params: id, format?",
        transcript_stats: "Counts by status and provider.",
        check_providers: "Check which API keys are configured.",
        proofread_transcript: "AI spellcheck/proofread. Params: id, types?, confidence_threshold?, provider?",
        list_proofread_issues: "List proofread issues. Params: transcript_id, issue_type?, status?",
        apply_suggestion: "Apply a proofread suggestion. Params: issue_id",
        dismiss_issue: "Dismiss a proofread issue. Params: issue_id",
        proofread_stats: "Proofread stats. Params: transcript_id",
        export_annotated: "Export with inline annotations. Params: transcript_id",
      };
      const result = names.map((n) => `${n}: ${descriptions[n] || "See tool schema"}`).join("\n");
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
