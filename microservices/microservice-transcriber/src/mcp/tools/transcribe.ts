import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTranscript,
  getTranscript,
  updateTranscript,
  findBySourceUrl,
  type TranscriptProvider,
} from "../../db/transcripts.js";
import {
  prepareAudio,
  detectSourceType,
  isPlaylistUrl,
  getPlaylistUrls,
  fetchComments,
  type TrimOptions,
} from "../../lib/downloader.js";
import { importComments } from "../../db/comments.js";
import { transcribeFile, checkProviders, segmentByChapters } from "../../lib/providers.js";

export function registerTranscribeTools(server: McpServer) {
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
}
