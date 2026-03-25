import type { Command } from "commander";
import {
  createTranscript,
  getTranscript,
  updateTranscript,
  findBySourceUrl,
  type TranscriptProvider,
} from "../../db/transcripts.js";
import { prepareAudio, detectSourceType, isPlaylistUrl, getPlaylistUrls, fetchComments, type TrimOptions } from "../../lib/downloader.js";
import { importComments } from "../../db/comments.js";
import { transcribeFile, checkProviders, segmentByChapters, estimateCost } from "../../lib/providers.js";
import { getConfig } from "../../lib/config.js";
import { summarizeText } from "../../lib/summarizer.js";
import { startLiveTranscription } from "../../lib/live.js";
import { fireWebhook } from "../../lib/webhook.js";

export function registerTranscribeCommands(program: Command): void {
  // ---------------------------------------------------------------------------
  // transcribe
  // ---------------------------------------------------------------------------

  program
    .command("transcribe <sources...>")
    .description("Transcribe one or more files or URLs (YouTube, Vimeo, Wistia, etc.)")
    .option("--provider <provider>", "Provider: elevenlabs or openai (uses config default)")
    .option("--language <lang>", "Language code (e.g. en, fr, de). Auto-detected if omitted.")
    .option("--title <title>", "Title (only used when transcribing a single source)")
    .option("--start <seconds>", "Start time in seconds (trim audio before transcribing)", parseFloat)
    .option("--end <seconds>", "End time in seconds (trim audio before transcribing)", parseFloat)
    .option("--diarize", "Identify different speakers (ElevenLabs only)")
    .option("--vocab <words>", "Custom vocabulary hints (comma-separated, e.g. 'Karpathy,MicroGPT,SABR')")
    .option("--summarize", "Auto-summarize after transcription using AI")
    .option("--comments", "Also fetch and store YouTube/Vimeo comments")
    .option("--force", "Re-transcribe even if URL was already transcribed")
    .option("--json", "Output as JSON")
    .action(async (rawSources: string[], opts) => {
      let sources = rawSources;
      const cfg = getConfig();
      const provider = (opts.provider ?? cfg.defaultProvider) as TranscriptProvider;
      const language = opts.language ?? (cfg.defaultLanguage !== "en" ? cfg.defaultLanguage : undefined);
      const diarize = opts.diarize ?? cfg.diarize;
      const available = checkProviders();

      if (provider === "elevenlabs" && !available.elevenlabs) {
        console.error("Error: ELEVENLABS_API_KEY is not set.");
        process.exit(1);
      }
      if (provider === "openai" && !available.openai) {
        console.error("Error: OPENAI_API_KEY is not set.");
        process.exit(1);
      }

      if (diarize && provider !== "elevenlabs") {
        console.error("Warning: --diarize is only supported with ElevenLabs. Ignoring.");
      }

      const trim: TrimOptions | undefined =
        opts.start !== undefined || opts.end !== undefined
          ? { start: opts.start, end: opts.end }
          : undefined;

      // Expand playlist URLs into individual video URLs
      const expandedSources: string[] = [];
      for (const src of sources) {
        if (isPlaylistUrl(src)) {
          if (!opts.json) console.log(`Expanding playlist ${src}...`);
          try {
            const videos = await getPlaylistUrls(src);
            if (!opts.json) console.log(`  Found ${videos.length} video(s)`);
            expandedSources.push(...videos.map((v) => v.url));
          } catch (e) {
            console.error(`Failed to expand playlist: ${e instanceof Error ? e.message : e}`);
            expandedSources.push(src); // fallback: try as single video
          }
        } else {
          expandedSources.push(src);
        }
      }
      sources = expandedSources;

      const isBatch = sources.length > 1;
      const results: Array<{ source: string; id: string; success: boolean; error?: string }> = [];

      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        if (!opts.json && isBatch) {
          console.log(`\n[${i + 1}/${sources.length}] Transcribing ${source}...`);
        }

        // Duplicate detection
        if (!opts.force) {
          const existing = findBySourceUrl(source);
          if (existing) {
            if (!opts.json) {
              console.log(`  Already transcribed: ${existing.id.slice(0, 8)} "${existing.title ?? source}". Use --force to re-transcribe.`);
            }
            results.push({ source, id: existing.id, success: true });
            continue;
          }
        }

        const sourceType = detectSourceType(source);
        const record = createTranscript({
          source_url: source,
          source_type: sourceType,
          provider,
          language,
          title: !isBatch ? opts.title : undefined,
        });

        if (!opts.json && !isBatch) {
          const trimStr = trim ? ` [${trim.start ?? 0}s → ${trim.end ?? "end"}]` : "";
          console.log(`Transcribing ${source} [${sourceType}]${trimStr} with ${provider}...`);
        }

        updateTranscript(record.id, { status: "processing" });

        let audio: Awaited<ReturnType<typeof prepareAudio>> | null = null;
        try {
          audio = await prepareAudio(source, trim);

          if (!isBatch && !opts.title && audio.videoTitle) {
            updateTranscript(record.id, { title: audio.videoTitle });
          } else if (isBatch && audio.videoTitle) {
            updateTranscript(record.id, { title: audio.videoTitle });
          }

          const vocabList = [
            ...(cfg.vocab ?? []),
            ...(opts.vocab ? opts.vocab.split(",").map((v: string) => v.trim()) : []),
          ].filter(Boolean);

          const result = await transcribeFile(audio.filePath, {
            provider,
            language,
            diarize: diarize && provider === "elevenlabs",
            vocab: vocabList.length > 0 ? vocabList : undefined,
          });

          const chapterSegments = audio.chapters.length > 0 && result.metadata.words
            ? segmentByChapters(result.metadata.words, audio.chapters)
            : undefined;

          const cost = result.duration_seconds ? estimateCost(provider, result.duration_seconds) : undefined;

          const updated = updateTranscript(record.id, {
            status: "completed",
            transcript_text: result.text,
            duration_seconds: result.duration_seconds ?? undefined,
            word_count: result.text.split(/\s+/).filter(Boolean).length,
            metadata: {
              ...result.metadata,
              ...(trim ? { trim_start: trim.start, trim_end: trim.end } : {}),
              ...(chapterSegments ? { chapters: chapterSegments } : {}),
              ...(cost !== undefined ? { cost_usd: cost } : {}),
            },
          });

          // Auto-summarize if requested
          if (opts.summarize && result.text) {
            try {
              if (!opts.json) process.stdout.write("  Summarizing...");
              const summary = await summarizeText(result.text);
              updateTranscript(record.id, {
                metadata: { ...updated?.metadata, summary },
              });
              if (!opts.json) console.log(" done.");
            } catch (e) {
              if (!opts.json) console.error(`  Warning: summarize failed — ${e instanceof Error ? e.message : e}`);
            }
          }

          // Fire webhook
          fireWebhook({
            event: "transcription.completed", id: record.id, title: getTranscript(record.id)?.title ?? null,
            status: "completed", source_url: source, provider, duration_seconds: result.duration_seconds,
            word_count: result.text.split(/\s+/).filter(Boolean).length, timestamp: new Date().toISOString(),
          });

          // Fetch comments if requested
          if (opts.comments && (sourceType === "youtube" || sourceType === "vimeo")) {
            try {
              if (!opts.json) process.stdout.write("  Fetching comments...");
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
                importComments(record.id, mapped);
                if (!opts.json) console.log(` ${rawComments.length} comment(s) imported.`);
              } else {
                if (!opts.json) console.log(" no comments found.");
              }
            } catch (e) {
              if (!opts.json) console.error(`  Warning: comment fetch failed — ${e instanceof Error ? e.message : e}`);
            }
          }

          results.push({ source, id: record.id, success: true });

          if (opts.json && !isBatch) {
            console.log(JSON.stringify(getTranscript(record.id), null, 2));
          } else if (!opts.json && !isBatch) {
            console.log(`\nTranscript ID: ${record.id}`);
            console.log(`Duration: ${result.duration_seconds ? `${result.duration_seconds.toFixed(1)}s` : "unknown"}`);
            console.log(`Language: ${result.language}`);
            console.log(`\n--- Transcript ---\n`);
            console.log(result.text);
          } else if (!opts.json) {
            console.log(`  ✓ ${record.id.slice(0, 8)} — ${audio.videoTitle ?? source.slice(0, 60)}`);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          updateTranscript(record.id, { status: "failed", error_message: msg });
          fireWebhook({
            event: "transcription.failed", id: record.id, title: null,
            status: "failed", source_url: source, provider, duration_seconds: null,
            word_count: null, timestamp: new Date().toISOString(),
          });
          results.push({ source, id: record.id, success: false, error: msg });
          if (!opts.json) console.error(`  ✗ ${msg}`);
        } finally {
          audio?.cleanup();
        }
      }

      if (isBatch) {
        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        if (opts.json) {
          console.log(JSON.stringify({ results, summary: { succeeded, failed, total: sources.length } }, null, 2));
        } else {
          console.log(`\nDone: ${succeeded} completed, ${failed} failed.`);
        }
        if (failed > 0) process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // live
  // ---------------------------------------------------------------------------

  program
    .command("live")
    .description("Transcribe from microphone in real-time (stop with Ctrl+C)")
    .option("--provider <provider>", "Provider (uses config default)")
    .option("--language <lang>", "Language code")
    .option("--chunk-duration <seconds>", "Seconds per chunk (default: 30)", parseInt)
    .option("--title <title>", "Title for the saved transcript")
    .action(async (opts) => {
      const cfg = getConfig();
      const provider = (opts.provider ?? cfg.defaultProvider) as TranscriptProvider;
      const available = checkProviders();

      if (provider === "elevenlabs" && !available.elevenlabs) { console.error("ELEVENLABS_API_KEY not set."); process.exit(1); }
      if (provider === "openai" && !available.openai) { console.error("OPENAI_API_KEY not set."); process.exit(1); }
      if (provider === "deepgram" && !available.deepgram) { console.error("DEEPGRAM_API_KEY not set."); process.exit(1); }

      console.log(`Live transcription with ${provider}. Press Ctrl+C to stop.\n`);

      const session = startLiveTranscription({
        provider,
        language: opts.language,
        chunkDurationSec: opts.chunkDuration ?? 30,
        onChunk: (text, idx) => {
          console.log(`[chunk ${idx + 1}] ${text}`);
        },
        onError: (err, idx) => {
          console.error(`[chunk ${idx + 1}] Error: ${err.message}`);
        },
      });

      // Handle Ctrl+C
      process.on("SIGINT", async () => {
        console.log("\nStopping...");
        const result = await session.stop();

        if (result.fullText) {
          // Save to DB
          const record = createTranscript({
            source_url: "live:microphone",
            source_type: "file",
            provider,
            language: opts.language,
            title: opts.title ?? `Live recording ${new Date().toISOString().slice(0, 16)}`,
          });
          updateTranscript(record.id, {
            status: "completed",
            transcript_text: result.fullText,
            word_count: result.fullText.split(/\s+/).filter(Boolean).length,
          });
          console.log(`\nSaved transcript: ${record.id}`);
          console.log(`${result.chunks.length} chunk(s), ${result.fullText.split(/\s+/).length} words`);
        }
        process.exit(0);
      });
    });

  // ---------------------------------------------------------------------------
  // retry
  // ---------------------------------------------------------------------------

  program
    .command("retry <id>")
    .description("Retry a failed or pending transcription (re-uses original source URL)")
    .option("--provider <provider>", "Override provider: elevenlabs or openai")
    .option("--diarize", "Identify different speakers (ElevenLabs only)")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts) => {
      const t = getTranscript(id);
      if (!t) {
        console.error(`Transcript '${id}' not found.`);
        process.exit(1);
      }

      if (!t.source_url) {
        console.error(`Transcript '${id}' has no source URL to retry from.`);
        process.exit(1);
      }

      const provider = (opts.provider as TranscriptProvider | undefined) ?? t.provider;
      const providers = checkProviders();

      if (provider === "elevenlabs" && !providers.elevenlabs) {
        console.error("Error: ELEVENLABS_API_KEY is not set.");
        process.exit(1);
      }
      if (provider === "openai" && !providers.openai) {
        console.error("Error: OPENAI_API_KEY is not set.");
        process.exit(1);
      }

      if (!opts.json) {
        console.log(`Retrying transcript ${id} [${t.source_url}] with ${provider}...`);
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
          diarize: opts.diarize && provider === "elevenlabs",
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

        if (opts.json) {
          console.log(JSON.stringify(updated, null, 2));
        } else {
          console.log(`\nRetry successful. Transcript ID: ${id}`);
          console.log(result.text);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        updateTranscript(id, { status: "failed", error_message: msg });
        console.error(`Error: ${msg}`);
        process.exit(1);
      } finally {
        audio?.cleanup();
      }
    });
}
