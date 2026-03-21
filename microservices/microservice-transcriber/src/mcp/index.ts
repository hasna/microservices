#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createTranscript,
  getTranscript,
  updateTranscript,
  deleteTranscript,
  listTranscripts,
  searchTranscripts,
  countTranscripts,
  renameSpeakers,
  findBySourceUrl,
  searchWithContext,
  addTags,
  removeTags,
  getTags,
  listAllTags,
  listTranscriptsByTag,
  type TranscriptProvider,
  type TranscriptStatus,
  type TranscriptSourceType,
} from "../db/transcripts.js";
import { prepareAudio, detectSourceType, getVideoInfo, downloadAudio, downloadVideo, createClip, isPlaylistUrl, getPlaylistUrls, fetchComments, type TrimOptions } from "../lib/downloader.js";
import { listComments, getTopComments, searchComments, getCommentStats, importComments } from "../db/comments.js";
import { getConfig, setConfig, resetConfig } from "../lib/config.js";
import { summarizeText, extractHighlights, generateMeetingNotes, getDefaultSummaryProvider } from "../lib/summarizer.js";
import { translateText } from "../lib/translator.js";
import { fetchFeedEpisodes } from "../lib/feeds.js";
import { createAnnotation, listAnnotations, deleteAnnotation } from "../db/annotations.js";
import { wordDiff, diffStats, formatDiff } from "../lib/diff.js";
import { transcribeFile, checkProviders, toSrt, toVtt, toAss, toMarkdown, segmentByChapters, formatWithConfidence } from "../lib/providers.js";
import { proofreadTranscript, listIssues, applySuggestion, dismissIssue, getProofreadStats, exportAnnotated, type IssueType } from "../lib/proofread.js";

const server = new McpServer({
  name: "microservice-transcriber",
  version: "0.0.1",
});

// ---------------------------------------------------------------------------
// transcribe
// ---------------------------------------------------------------------------

server.registerTool(
  "transcribe",
  {
    title: "Transcribe Audio or Video",
    description:
      "Transcribe a local audio/video file or a URL (YouTube, Vimeo, Wistia, or any media URL). Uses ElevenLabs by default, or OpenAI Whisper.",
    inputSchema: {
      source: z.string().describe("File path or URL to transcribe"),
      provider: z
        .enum(["elevenlabs", "openai", "deepgram"])
        .optional()
        .describe("Transcription provider (default: elevenlabs)"),
      language: z
        .string()
        .optional()
        .describe("Language code e.g. 'en', 'fr'. Auto-detected if omitted."),
      title: z.string().optional().describe("Optional title for the transcript"),
      start: z.number().optional().describe("Start time in seconds — trim audio before transcribing"),
      end: z.number().optional().describe("End time in seconds — trim audio before transcribing"),
      diarize: z.boolean().optional().describe("Identify different speakers — ElevenLabs only"),
      vocab: z.array(z.string()).optional().describe("Custom vocabulary hints for accuracy (e.g. ['Karpathy', 'MicroGPT'])"),
      force: z.boolean().optional().describe("Re-transcribe even if URL already exists in DB"),
      comments: z.boolean().optional().describe("Also fetch and store YouTube/Vimeo comments"),
    },
  },
  async ({ source, provider = "elevenlabs", language, title, start, end, diarize, vocab, force, comments: fetchCommentsFlag }) => {
    // Duplicate detection
    if (!force) {
      const existing = findBySourceUrl(source);
      if (existing) {
        return { content: [{ type: "text", text: JSON.stringify({ duplicate: true, existing_id: existing.id, title: existing.title, message: "Already transcribed. Use force=true to re-transcribe." }, null, 2) }] };
      }
    }

    const providers = checkProviders();

    if (provider === "elevenlabs" && !providers.elevenlabs) {
      return { content: [{ type: "text", text: "ELEVENLABS_API_KEY is not set." }], isError: true };
    }
    if (provider === "openai" && !providers.openai) {
      return { content: [{ type: "text", text: "OPENAI_API_KEY is not set." }], isError: true };
    }

    const trim: TrimOptions | undefined =
      start !== undefined || end !== undefined ? { start, end } : undefined;

    const sourceType = detectSourceType(source);
    const record = createTranscript({
      source_url: source,
      source_type: sourceType,
      provider: provider as TranscriptProvider,
      language,
      title,
    });

    updateTranscript(record.id, { status: "processing" });

    let audio: Awaited<ReturnType<typeof prepareAudio>> | null = null;
    try {
      audio = await prepareAudio(source, trim);

      // Auto-title from video metadata if title not provided
      if (!title && audio.videoTitle) {
        updateTranscript(record.id, { title: audio.videoTitle });
      }

      const result = await transcribeFile(audio.filePath, {
        provider: provider as TranscriptProvider,
        language,
        diarize: diarize && provider === "elevenlabs",
        vocab: vocab && vocab.length > 0 ? vocab : undefined,
      });

      const chapterSegments = audio.chapters.length > 0 && result.metadata.words
        ? segmentByChapters(result.metadata.words, audio.chapters)
        : undefined;

      const updated = updateTranscript(record.id, {
        status: "completed",
        transcript_text: result.text,
        duration_seconds: result.duration_seconds ?? undefined,
        word_count: result.text.split(/\s+/).filter(Boolean).length,
        metadata: {
          ...result.metadata,
          ...(trim ? { trim_start: trim.start, trim_end: trim.end } : {}),
          ...(chapterSegments ? { chapters: chapterSegments } : {}),
        },
      });

      // Fetch comments if requested
      let commentCount = 0;
      if (fetchCommentsFlag && (sourceType === "youtube" || sourceType === "vimeo")) {
        try {
          const rawComments = await fetchComments(source);
          if (rawComments.length > 0) {
            const mapped = rawComments.map((c) => ({
              platform: sourceType,
              author: c.author,
              author_handle: c.author_id,
              comment_text: c.text,
              likes: c.like_count,
              reply_count: 0,
              is_reply: c.parent !== null,
              parent_comment_id: c.parent,
              published_at: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : null,
            }));
            commentCount = importComments(record.id, mapped);
          }
        } catch {
          // Comment fetch is best-effort — don't fail the transcription
        }
      }

      const finalResult = { ...getTranscript(record.id), comments_imported: commentCount };
      return {
        content: [{ type: "text", text: JSON.stringify(finalResult, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      updateTranscript(record.id, { status: "failed", error_message: msg });
      return { content: [{ type: "text", text: `Transcription failed: ${msg}` }], isError: true };
    } finally {
      audio?.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// download_audio
// ---------------------------------------------------------------------------

server.registerTool(
  "download_audio",
  {
    title: "Download Audio",
    description: "Download audio from a URL (YouTube, Vimeo, Wistia, etc.) without transcribing. Saves to the audio library organized by platform.",
    inputSchema: {
      url: z.string().describe("Video/audio URL"),
      format: z.enum(["mp3", "m4a", "wav"]).optional().describe("Audio format (default: mp3)"),
      output_path: z.string().optional().describe("Override output file path"),
      start: z.number().optional().describe("Start time in seconds"),
      end: z.number().optional().describe("End time in seconds"),
    },
  },
  async ({ url, format, output_path, start, end }) => {
    try {
      const trim = start !== undefined || end !== undefined ? { start, end } : undefined;
      const result = await downloadAudio(url, { format: format as "mp3" | "m4a" | "wav" | undefined, outputPath: output_path, trim });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Download failed: ${msg}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// batch_transcribe
// ---------------------------------------------------------------------------

server.registerTool(
  "batch_transcribe",
  {
    title: "Batch Transcribe",
    description: "Transcribe multiple sources sequentially. Each gets its own transcript record. Failures don't stop remaining items.",
    inputSchema: {
      sources: z.array(z.string()).describe("Array of file paths or URLs to transcribe"),
      provider: z.enum(["elevenlabs", "openai", "deepgram"]).optional().describe("Provider (default: elevenlabs)"),
      language: z.string().optional(),
      diarize: z.boolean().optional(),
      start: z.number().optional().describe("Start trim in seconds (applied to all sources)"),
      end: z.number().optional().describe("End trim in seconds (applied to all sources)"),
    },
  },
  async ({ sources, provider = "elevenlabs", language, diarize, start, end }) => {
    const available = checkProviders();
    if (provider === "elevenlabs" && !available.elevenlabs) {
      return { content: [{ type: "text", text: "ELEVENLABS_API_KEY is not set." }], isError: true };
    }
    if (provider === "openai" && !available.openai) {
      return { content: [{ type: "text", text: "OPENAI_API_KEY is not set." }], isError: true };
    }

    // Expand playlist URLs
    const expanded: string[] = [];
    for (const src of sources) {
      if (isPlaylistUrl(src)) {
        try {
          const videos = await getPlaylistUrls(src);
          expanded.push(...videos.map((v) => v.url));
        } catch { expanded.push(src); }
      } else {
        expanded.push(src);
      }
    }

    const trim = start !== undefined || end !== undefined ? { start, end } : undefined;
    const results: Array<{ source: string; id: string; success: boolean; error?: string }> = [];

    for (const source of expanded) {
      const sourceType = detectSourceType(source);
      const record = createTranscript({
        source_url: source,
        source_type: sourceType,
        provider: provider as TranscriptProvider,
        language,
      });

      updateTranscript(record.id, { status: "processing" });

      let audio: Awaited<ReturnType<typeof prepareAudio>> | null = null;
      try {
        audio = await prepareAudio(source, trim);
        if (audio.videoTitle) updateTranscript(record.id, { title: audio.videoTitle });

        const result = await transcribeFile(audio.filePath, {
          provider: provider as TranscriptProvider,
          language,
          diarize: diarize && provider === "elevenlabs",
        });

        const chapterSegments = audio.chapters.length > 0 && result.metadata.words
          ? segmentByChapters(result.metadata.words, audio.chapters)
          : undefined;

        updateTranscript(record.id, {
          status: "completed",
          transcript_text: result.text,
          duration_seconds: result.duration_seconds ?? undefined,
          word_count: result.text.split(/\s+/).filter(Boolean).length,
          metadata: {
            ...result.metadata,
            ...(trim ? { trim_start: trim.start, trim_end: trim.end } : {}),
            ...(chapterSegments ? { chapters: chapterSegments } : {}),
          },
        });

        results.push({ source, id: record.id, success: true });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        updateTranscript(record.id, { status: "failed", error_message: msg });
        results.push({ source, id: record.id, success: false, error: msg });
      } finally {
        audio?.cleanup();
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return {
      content: [{ type: "text", text: JSON.stringify({ results, summary: { succeeded, failed, total: expanded.length } }, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// get_video_info
// ---------------------------------------------------------------------------

server.registerTool(
  "get_video_info",
  {
    title: "Get Video Info",
    description:
      "Fetch video metadata (title, duration, uploader, chapters, formats) from a URL without downloading or transcribing. Works with YouTube, Vimeo, Wistia, and any yt-dlp supported URL.",
    inputSchema: {
      url: z.string().describe("Video URL"),
    },
  },
  async ({ url }) => {
    try {
      const info = await getVideoInfo(url);
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Failed to fetch video info: ${msg}` }], isError: true };
    }
  }
);

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
// retry_transcript
// ---------------------------------------------------------------------------

server.registerTool(
  "retry_transcript",
  {
    title: "Retry Transcript",
    description: "Retry a failed or pending transcription using its original source URL. Optionally switch providers.",
    inputSchema: {
      id: z.string().describe("Transcript ID to retry"),
      provider: z
        .enum(["elevenlabs", "openai", "deepgram"])
        .optional()
        .describe("Override provider (defaults to original)"),
      diarize: z.boolean().optional().describe("Identify speakers — ElevenLabs only"),
    },
  },
  async ({ id, provider: providerOverride, diarize }) => {
    const t = getTranscript(id);
    if (!t) {
      return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
    }
    if (!t.source_url) {
      return { content: [{ type: "text", text: `Transcript '${id}' has no source URL to retry from.` }], isError: true };
    }

    const provider = (providerOverride ?? t.provider) as TranscriptProvider;
    const available = checkProviders();
    if (provider === "elevenlabs" && !available.elevenlabs) {
      return { content: [{ type: "text", text: "ELEVENLABS_API_KEY is not set." }], isError: true };
    }
    if (provider === "openai" && !available.openai) {
      return { content: [{ type: "text", text: "OPENAI_API_KEY is not set." }], isError: true };
    }

    updateTranscript(id, { status: "processing", error_message: null });

    let audio: Awaited<ReturnType<typeof prepareAudio>> | null = null;
    try {
      const trim = t.metadata?.trim_start !== undefined || t.metadata?.trim_end !== undefined
        ? { start: t.metadata.trim_start, end: t.metadata.trim_end }
        : undefined;

      audio = await prepareAudio(t.source_url, trim);
      const result = await transcribeFile(audio.filePath, {
        provider,
        language: t.language,
        diarize: diarize && provider === "elevenlabs",
      });

      const updated = updateTranscript(id, {
        status: "completed",
        transcript_text: result.text,
        duration_seconds: result.duration_seconds ?? undefined,
        word_count: result.text.split(/\s+/).filter(Boolean).length,
        metadata: {
          ...result.metadata,
          ...(trim ? { trim_start: trim.start, trim_end: trim.end } : {}),
        },
      });

      return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      updateTranscript(id, { status: "failed", error_message: msg });
      return { content: [{ type: "text", text: `Retry failed: ${msg}` }], isError: true };
    } finally {
      audio?.cleanup();
    }
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
// translate_transcript
// ---------------------------------------------------------------------------

server.registerTool(
  "translate_transcript",
  {
    title: "Translate Transcript",
    description: "Translate a completed transcript to another language. Creates a new linked transcript record with source_transcript_id pointing to the original.",
    inputSchema: {
      id: z.string().describe("Source transcript ID"),
      to: z.string().describe("Target language code or name (e.g. 'fr', 'de', 'Spanish')"),
      provider: z.enum(["openai", "anthropic"]).optional().describe("AI provider (auto-detected from env)"),
    },
  },
  async ({ id, to, provider }) => {
    const t = getTranscript(id);
    if (!t) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
    if (t.status !== "completed" || !t.transcript_text) {
      return { content: [{ type: "text", text: `Transcript '${id}' is not completed.` }], isError: true };
    }

    const resolved = provider ?? getDefaultSummaryProvider();
    if (!resolved) {
      return { content: [{ type: "text", text: "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY." }], isError: true };
    }

    try {
      const translatedText = await translateText(t.transcript_text, to, resolved);

      const newRecord = createTranscript({
        source_url: t.source_url ?? `translated:${id}`,
        source_type: "translated",
        provider: t.provider,
        language: to,
        title: t.title ? `${t.title} [${to}]` : null,
        source_transcript_id: id,
      });

      updateTranscript(newRecord.id, {
        status: "completed",
        transcript_text: translatedText,
        word_count: translatedText.split(/\s+/).filter(Boolean).length,
        metadata: { model: resolved },
      });

      return { content: [{ type: "text", text: JSON.stringify(getTranscript(newRecord.id), null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Translation failed: ${msg}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// summarize_transcript
// ---------------------------------------------------------------------------

server.registerTool(
  "summarize_transcript",
  {
    title: "Summarize Transcript",
    description: "Generate a 3-5 sentence AI summary of a completed transcript. Stores summary in metadata.summary. Uses OpenAI gpt-4o-mini or Anthropic claude-haiku.",
    inputSchema: {
      id: z.string().describe("Transcript ID"),
      provider: z.enum(["openai", "anthropic"]).optional().describe("AI provider (auto-detected from env if omitted)"),
    },
  },
  async ({ id, provider }) => {
    const t = getTranscript(id);
    if (!t) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
    if (t.status !== "completed" || !t.transcript_text) {
      return { content: [{ type: "text", text: `Transcript '${id}' is not completed.` }], isError: true };
    }

    const resolved = provider ?? getDefaultSummaryProvider();
    if (!resolved) {
      return { content: [{ type: "text", text: "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY." }], isError: true };
    }

    try {
      const summary = await summarizeText(t.transcript_text, resolved);
      updateTranscript(id, { metadata: { ...t.metadata, summary } });
      return { content: [{ type: "text", text: JSON.stringify({ id, summary }, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Summarization failed: ${msg}` }], isError: true };
    }
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

// ---------------------------------------------------------------------------
// create_clip
// ---------------------------------------------------------------------------

server.registerTool(
  "create_clip",
  {
    title: "Create Clip",
    description: "Extract a video clip with burned-in subtitles from a transcribed URL source.",
    inputSchema: {
      id: z.string().describe("Transcript ID"),
      start: z.number().describe("Start time in seconds"),
      end: z.number().describe("End time in seconds"),
      output_path: z.string().optional().describe("Output file path"),
      subtitles: z.boolean().optional().describe("Burn in subtitles (default: true)"),
    },
  },
  async ({ id, start, end, output_path, subtitles = true }) => {
    const t = getTranscript(id);
    if (!t) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
    if (!t.source_url || t.source_type === "file") {
      return { content: [{ type: "text", text: "Clip extraction requires a URL source." }], isError: true };
    }

    const outputPath = output_path ?? `/tmp/clip-${id.slice(0, 8)}.mp4`;
    let video: Awaited<ReturnType<typeof downloadVideo>> | null = null;
    let subsFile: string | null = null;

    try {
      video = await downloadVideo(t.source_url);

      if (subtitles && t.metadata?.words?.length) {
        const rangeWords = t.metadata.words.filter((w) => w.start >= start && w.end <= end);
        if (rangeWords.length > 0) {
          const offsetWords = rangeWords.map((w) => ({ ...w, start: w.start - start, end: w.end - start }));
          const assContent = toAss(offsetWords);
          subsFile = `/tmp/transcriber-clip-subs-${crypto.randomUUID()}.ass`;
          const { writeFileSync } = await import("node:fs");
          writeFileSync(subsFile, assContent, "utf8");
        }
      }

      await createClip({ videoPath: video.path, start, end, subtitlePath: subsFile ?? undefined, outputPath });
      return { content: [{ type: "text", text: JSON.stringify({ id, outputPath, start, end }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Clip failed: ${error instanceof Error ? error.message : error}` }], isError: true };
    } finally {
      video?.cleanup();
      if (subsFile) { try { const { unlinkSync } = await import("node:fs"); unlinkSync(subsFile); } catch {} }
    }
  }
);

// ---------------------------------------------------------------------------
// meeting_notes
// ---------------------------------------------------------------------------

server.registerTool(
  "meeting_notes",
  {
    title: "Generate Meeting Notes",
    description: "Restructure a transcript into formatted meeting notes: attendees, agenda, key decisions, action items, summary.",
    inputSchema: {
      id: z.string().describe("Transcript ID"),
      provider: z.enum(["openai", "anthropic"]).optional(),
    },
  },
  async ({ id, provider }) => {
    const t = getTranscript(id);
    if (!t) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
    if (t.status !== "completed" || !t.transcript_text) {
      return { content: [{ type: "text", text: `Transcript '${id}' is not completed.` }], isError: true };
    }
    const resolved = provider ?? getDefaultSummaryProvider();
    if (!resolved) return { content: [{ type: "text", text: "No AI provider configured." }], isError: true };
    try {
      const notes = await generateMeetingNotes(t.transcript_text, resolved);
      updateTranscript(id, { metadata: { ...t.metadata, meeting_notes: notes } });
      return { content: [{ type: "text", text: notes }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed: ${error instanceof Error ? error.message : error}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// highlights_transcript
// ---------------------------------------------------------------------------

server.registerTool(
  "highlights_transcript",
  {
    title: "Extract Highlights",
    description: "Extract 5-10 key moments/quotes from a completed transcript using AI.",
    inputSchema: {
      id: z.string().describe("Transcript ID"),
      provider: z.enum(["openai", "anthropic"]).optional(),
    },
  },
  async ({ id, provider }) => {
    const t = getTranscript(id);
    if (!t) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
    if (t.status !== "completed" || !t.transcript_text) {
      return { content: [{ type: "text", text: `Transcript '${id}' is not completed.` }], isError: true };
    }

    const resolved = provider ?? getDefaultSummaryProvider();
    if (!resolved) return { content: [{ type: "text", text: "No AI provider configured." }], isError: true };

    try {
      const highlights = await extractHighlights(t.transcript_text, resolved);
      updateTranscript(id, { metadata: { ...t.metadata, highlights } });
      return { content: [{ type: "text", text: JSON.stringify({ id, highlights }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Highlights extraction failed: ${error instanceof Error ? error.message : error}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// annotations
// ---------------------------------------------------------------------------

server.registerTool(
  "add_annotation",
  {
    title: "Add Annotation",
    description: "Add a timestamped annotation/bookmark to a transcript.",
    inputSchema: {
      transcript_id: z.string(), timestamp_sec: z.number(), note: z.string(),
    },
  },
  async ({ transcript_id, timestamp_sec, note }) => {
    const anno = createAnnotation(transcript_id, timestamp_sec, note);
    return { content: [{ type: "text", text: JSON.stringify(anno, null, 2) }] };
  }
);

server.registerTool(
  "list_annotations",
  {
    title: "List Annotations",
    description: "List all annotations for a transcript.",
    inputSchema: { transcript_id: z.string() },
  },
  async ({ transcript_id }) => {
    return { content: [{ type: "text", text: JSON.stringify(listAnnotations(transcript_id), null, 2) }] };
  }
);

server.registerTool(
  "delete_annotation",
  {
    title: "Delete Annotation",
    description: "Delete an annotation by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const ok = deleteAnnotation(id);
    if (!ok) return { content: [{ type: "text", text: "Annotation not found." }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted: true }) }] };
  }
);

// ---------------------------------------------------------------------------
// check_feeds
// ---------------------------------------------------------------------------

server.registerTool(
  "check_feeds",
  {
    title: "Check Podcast Feeds",
    description: "Check all registered RSS feeds for new episodes. Returns new episode URLs. Use with batch_transcribe to transcribe them.",
    inputSchema: {},
  },
  async () => {
    const cfg = getConfig();
    if (cfg.feeds.length === 0) return { content: [{ type: "text", text: "No feeds configured." }] };

    const allNew: Array<{ feed: string; episodes: Array<{ url: string; title: string | null }> }> = [];
    for (const feed of cfg.feeds) {
      try {
        const { episodes } = await fetchFeedEpisodes(feed.url);
        const newEps = episodes.filter((ep) => !findBySourceUrl(ep.url));
        if (newEps.length > 0) allNew.push({ feed: feed.title ?? feed.url, episodes: newEps.map((e) => ({ url: e.url, title: e.title })) });
        feed.lastChecked = new Date().toISOString();
      } catch {}
    }
    setConfig({ feeds: cfg.feeds });
    return { content: [{ type: "text", text: JSON.stringify(allNew, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// list_comments
// ---------------------------------------------------------------------------

server.registerTool(
  "list_comments",
  {
    title: "List Comments",
    description: "List comments for a transcript, optionally sorted by likes.",
    inputSchema: {
      transcript_id: z.string().describe("Transcript ID"),
      top: z.boolean().optional().describe("Sort by most liked"),
      limit: z.number().optional().describe("Max results (default 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
  },
  async ({ transcript_id, top, limit, offset }) => {
    const comments = listComments(transcript_id, { top, limit, offset });
    return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// top_comments
// ---------------------------------------------------------------------------

server.registerTool(
  "top_comments",
  {
    title: "Top Comments",
    description: "Get the most liked comments for a transcript.",
    inputSchema: {
      transcript_id: z.string().describe("Transcript ID"),
      limit: z.number().optional().describe("Number of top comments (default 10)"),
    },
  },
  async ({ transcript_id, limit }) => {
    const comments = getTopComments(transcript_id, limit);
    return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// search_comments
// ---------------------------------------------------------------------------

server.registerTool(
  "search_comments",
  {
    title: "Search Comments",
    description: "Search comment text across all transcripts using LIKE matching.",
    inputSchema: {
      query: z.string().describe("Search query"),
    },
  },
  async ({ query }) => {
    const results = searchComments(query);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// comment_stats
// ---------------------------------------------------------------------------

server.registerTool(
  "comment_stats",
  {
    title: "Comment Stats",
    description: "Get comment statistics for a transcript: total, replies, unique authors, avg likes, top commenter.",
    inputSchema: {
      transcript_id: z.string().describe("Transcript ID"),
    },
  },
  async ({ transcript_id }) => {
    const stats = getCommentStats(transcript_id);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// get_config / set_config
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
// proofread_transcript
// ---------------------------------------------------------------------------

server.registerTool(
  "proofread_transcript",
  {
    title: "Proofread Transcript",
    description: "Run AI-powered spellcheck/proofread on a transcript. Finds spelling, grammar, punctuation, and clarity issues. Non-destructive: stores issues in DB without modifying transcript text.",
    inputSchema: {
      id: z.string().describe("Transcript ID"),
      types: z.array(z.enum(["spelling", "grammar", "punctuation", "clarity"])).optional().describe("Issue types to check (default: all)"),
      confidence_threshold: z.number().optional().describe("Minimum confidence 0-1 (default: 0.7)"),
      provider: z.enum(["openai", "anthropic"]).optional().describe("AI provider (auto-detected from env)"),
    },
  },
  async ({ id, types, confidence_threshold, provider }) => {
    try {
      const issues = await proofreadTranscript(id, {
        types: types as IssueType[] | undefined,
        confidence_threshold,
        provider: provider as "openai" | "anthropic" | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(issues, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Proofread failed: ${error instanceof Error ? error.message : error}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// list_proofread_issues
// ---------------------------------------------------------------------------

server.registerTool(
  "list_proofread_issues",
  {
    title: "List Proofread Issues",
    description: "List proofread issues for a transcript with optional filters.",
    inputSchema: {
      transcript_id: z.string().describe("Transcript ID"),
      issue_type: z.enum(["spelling", "grammar", "punctuation", "clarity"]).optional().describe("Filter by issue type"),
      status: z.enum(["pending", "applied", "dismissed"]).optional().describe("Filter by status"),
    },
  },
  async ({ transcript_id, issue_type, status }) => {
    const issues = listIssues(transcript_id, {
      issue_type: issue_type as IssueType | undefined,
      status: status as "pending" | "applied" | "dismissed" | undefined,
    });
    return { content: [{ type: "text", text: JSON.stringify(issues, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// apply_suggestion
// ---------------------------------------------------------------------------

server.registerTool(
  "apply_suggestion",
  {
    title: "Apply Proofread Suggestion",
    description: "Apply a proofread suggestion to the transcript text. Replaces the original text with the suggestion and marks the issue as applied.",
    inputSchema: {
      issue_id: z.string().describe("Proofread issue ID"),
    },
  },
  async ({ issue_id }) => {
    const result = applySuggestion(issue_id);
    if (!result) return { content: [{ type: "text", text: `Issue '${issue_id}' not found.` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// dismiss_issue
// ---------------------------------------------------------------------------

server.registerTool(
  "dismiss_issue",
  {
    title: "Dismiss Proofread Issue",
    description: "Dismiss a proofread issue without modifying the transcript text.",
    inputSchema: {
      issue_id: z.string().describe("Proofread issue ID"),
    },
  },
  async ({ issue_id }) => {
    const result = dismissIssue(issue_id);
    if (!result) return { content: [{ type: "text", text: `Issue '${issue_id}' not found.` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// proofread_stats
// ---------------------------------------------------------------------------

server.registerTool(
  "proofread_stats",
  {
    title: "Proofread Stats",
    description: "Get proofread issue statistics for a transcript: total, by type, pending/applied/dismissed counts.",
    inputSchema: {
      transcript_id: z.string().describe("Transcript ID"),
    },
  },
  async ({ transcript_id }) => {
    const stats = getProofreadStats(transcript_id);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// export_annotated
// ---------------------------------------------------------------------------

server.registerTool(
  "export_annotated",
  {
    title: "Export Annotated Transcript",
    description: "Export transcript text with inline proofread annotations showing pending issues as [TYPE: \"original\" -> \"suggestion\"] markers.",
    inputSchema: {
      transcript_id: z.string().describe("Transcript ID"),
    },
  },
  async ({ transcript_id }) => {
    try {
      const text = exportAnnotated(transcript_id);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Export failed: ${error instanceof Error ? error.message : error}` }], isError: true };
    }
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

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Transcriber MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
