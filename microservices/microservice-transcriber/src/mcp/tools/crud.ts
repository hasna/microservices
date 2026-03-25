import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getTranscript,
  updateTranscript,
  deleteTranscript,
  listTranscripts,
  searchTranscripts,
  countTranscripts,
  renameSpeakers,
  searchWithContext,
  addTags,
  removeTags,
  getTags,
  listAllTags,
  type TranscriptProvider,
  type TranscriptStatus,
  type TranscriptSourceType,
} from "../../db/transcripts.js";
import { checkProviders, toSrt, toVtt, toAss, toMarkdown, formatWithConfidence } from "../../lib/providers.js";
import { wordDiff, diffStats, formatDiff } from "../../lib/diff.js";

export function registerCrudTools(server: McpServer) {
  // ---------------------------------------------------------------------------
  // list_transcripts
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_transcripts",
    {
      title: "List Transcripts",
      description: "List transcripts with optional filters.",
      inputSchema: {
        status: z
          .enum(["pending", "processing", "completed", "failed"])
          .optional()
          .describe("Filter by status"),
        provider: z
          .enum(["elevenlabs", "openai", "deepgram"])
          .optional()
          .describe("Filter by provider"),
        source_type: z
          .enum(["file", "youtube", "vimeo", "wistia", "url"])
          .optional()
          .describe("Filter by source type"),
        limit: z.number().optional().describe("Max results (default 50)"),
        offset: z.number().optional().describe("Offset for pagination"),
      },
    },
    async ({ status, provider, source_type, limit, offset }) => {
      const results = listTranscripts({
        status: status as TranscriptStatus | undefined,
        provider: provider as TranscriptProvider | undefined,
        source_type: source_type as TranscriptSourceType | undefined,
        limit,
        offset,
      });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // get_transcript
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get_transcript",
    {
      title: "Get Transcript",
      description: "Get a single transcript by ID, including full text and metadata.",
      inputSchema: {
        id: z.string().describe("Transcript ID"),
      },
    },
    async ({ id }) => {
      const t = getTranscript(id);
      if (!t) {
        return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(t, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // search_transcripts
  // ---------------------------------------------------------------------------

  server.registerTool(
    "search_transcripts",
    {
      title: "Search Transcripts",
      description: "Full-text search across transcript text, titles, and source URLs. Use context param for excerpts with timestamps.",
      inputSchema: {
        query: z.string().describe("Search query"),
        context: z.number().optional().describe("Number of surrounding sentences to include (enables contextual search with timestamps)"),
      },
    },
    async ({ query, context }) => {
      if (context !== undefined) {
        const matches = searchWithContext(query, context);
        return { content: [{ type: "text", text: JSON.stringify(matches, null, 2) }] };
      }
      const results = searchTranscripts(query);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // delete_transcript
  // ---------------------------------------------------------------------------

  server.registerTool(
    "delete_transcript",
    {
      title: "Delete Transcript",
      description: "Delete a transcript by ID.",
      inputSchema: {
        id: z.string().describe("Transcript ID"),
      },
    },
    async ({ id }) => {
      const deleted = deleteTranscript(id);
      if (!deleted) {
        return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify({ id, deleted: true }) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // export_transcript
  // ---------------------------------------------------------------------------

  server.registerTool(
    "export_transcript",
    {
      title: "Export Transcript",
      description: "Export a completed transcript as plain text, SRT subtitles, or JSON.",
      inputSchema: {
        id: z.string().describe("Transcript ID"),
        format: z
          .enum(["txt", "srt", "vtt", "ass", "md", "json"])
          .optional()
          .describe("Export format: txt (default), srt, vtt, ass, json"),
        font_name: z.string().optional().describe("Font name for ASS format (default: Arial)"),
        font_size: z.number().optional().describe("Font size for ASS format (default: 20)"),
        color: z.string().optional().describe("Text color hex for ASS (default: FFFFFF = white)"),
        outline: z.number().optional().describe("Outline size for ASS (default: 2)"),
        shadow: z.number().optional().describe("Shadow size for ASS (default: 1)"),
        show_confidence: z.boolean().optional().describe("Flag low-confidence words with [?word?] markers (ElevenLabs only, txt format)"),
        confidence_threshold: z.number().optional().describe("Confidence threshold 0-1 (default 0.7)"),
      },
    },
    async ({ id, format = "txt", font_name, font_size, color, outline, shadow, show_confidence, confidence_threshold }) => {
      const t = getTranscript(id);
      if (!t) {
        return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
      }

      if (t.status !== "completed" || !t.transcript_text) {
        return {
          content: [{ type: "text", text: `Transcript '${id}' is not completed (status: ${t.status}).` }],
          isError: true,
        };
      }

      let output: string;
      if (format === "json") {
        output = JSON.stringify(t, null, 2);
      } else if (format === "md") {
        output = toMarkdown(t);
      } else if (format === "srt" || format === "vtt" || format === "ass") {
        const words = t.metadata?.words ?? [];
        if (words.length === 0) {
          return {
            content: [{ type: "text", text: `No word-level timestamps available for ${format.toUpperCase()} export.` }],
            isError: true,
          };
        }
        if (format === "vtt") output = toVtt(words);
        else if (format === "ass") output = toAss(words, { fontName: font_name, fontSize: font_size, color, outline, shadow });
        else output = toSrt(words);
      } else {
        if (show_confidence && t.metadata?.words?.length) {
          output = formatWithConfidence(t.metadata.words, confidence_threshold ?? 0.7);
        } else {
          output = t.transcript_text;
        }
      }

      return { content: [{ type: "text", text: output }] };
    }
  );

  // ---------------------------------------------------------------------------
  // transcript_stats
  // ---------------------------------------------------------------------------

  server.registerTool(
    "transcript_stats",
    {
      title: "Transcript Stats",
      description: "Get transcript counts grouped by status and provider.",
      inputSchema: {},
    },
    async () => {
      const counts = countTranscripts();
      return { content: [{ type: "text", text: JSON.stringify(counts, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // check_providers
  // ---------------------------------------------------------------------------

  server.registerTool(
    "check_providers",
    {
      title: "Check Providers",
      description: "Check which transcription providers have API keys configured.",
      inputSchema: {},
    },
    async () => {
      const available = checkProviders();
      return { content: [{ type: "text", text: JSON.stringify(available, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // tag_transcript / list_tags
  // ---------------------------------------------------------------------------

  server.registerTool(
    "tag_transcript",
    {
      title: "Tag Transcript",
      description: "Add or remove tags on a transcript for organization.",
      inputSchema: {
        id: z.string().describe("Transcript ID"),
        add: z.array(z.string()).optional().describe("Tags to add"),
        remove: z.array(z.string()).optional().describe("Tags to remove"),
      },
    },
    async ({ id, add, remove }) => {
      if (add) addTags(id, add);
      if (remove) removeTags(id, remove);
      const tags = getTags(id);
      return { content: [{ type: "text", text: JSON.stringify({ id, tags }, null, 2) }] };
    }
  );

  server.registerTool(
    "list_tags",
    {
      title: "List Tags",
      description: "List all tags with transcript counts.",
      inputSchema: {},
    },
    async () => {
      const tags = listAllTags();
      return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // rename_speakers
  // ---------------------------------------------------------------------------

  server.registerTool(
    "rename_speakers",
    {
      title: "Rename Speakers",
      description: "Rename speaker labels in a diarized transcript. Replaces in text, words, and speaker segments.",
      inputSchema: {
        id: z.string().describe("Transcript ID"),
        mapping: z.record(z.string()).describe('Speaker name mapping, e.g. {"Speaker 1":"Andrej Karpathy","Speaker 2":"Sarah Guo"}'),
      },
    },
    async ({ id, mapping }) => {
      const updated = renameSpeakers(id, mapping);
      if (!updated) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify({ id, renamed: Object.keys(mapping).length }, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // diff_transcripts
  // ---------------------------------------------------------------------------

  server.registerTool(
    "diff_transcripts",
    {
      title: "Diff Transcripts",
      description: "Compare two transcripts word-by-word. Returns similarity percentage and diff entries.",
      inputSchema: {
        id1: z.string().describe("First transcript ID"),
        id2: z.string().describe("Second transcript ID"),
      },
    },
    async ({ id1, id2 }) => {
      const t1 = getTranscript(id1);
      const t2 = getTranscript(id2);
      if (!t1) return { content: [{ type: "text", text: `Transcript '${id1}' not found.` }], isError: true };
      if (!t2) return { content: [{ type: "text", text: `Transcript '${id2}' not found.` }], isError: true };
      if (!t1.transcript_text || !t2.transcript_text) {
        return { content: [{ type: "text", text: "Both transcripts must be completed." }], isError: true };
      }

      const entries = wordDiff(t1.transcript_text, t2.transcript_text);
      const stats = diffStats(entries);
      return { content: [{ type: "text", text: JSON.stringify({ id1, id2, stats, formatted: formatDiff(entries).slice(0, 5000) }, null, 2) }] };
    }
  );
}
