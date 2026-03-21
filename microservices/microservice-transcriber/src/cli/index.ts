#!/usr/bin/env bun

import { Command } from "commander";
import { writeFileSync } from "node:fs";
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
  addTags,
  removeTags,
  getTags,
  listAllTags,
  listTranscriptsByTag,
  searchWithContext,
  type TranscriptProvider,
  type TranscriptStatus,
  type TranscriptSourceType,
} from "../db/transcripts.js";
import { prepareAudio, detectSourceType, getVideoInfo, downloadAudio, downloadVideo, createClip, isPlaylistUrl, getPlaylistUrls, fetchComments, type TrimOptions } from "../lib/downloader.js";
import { createComment, listComments, searchComments, getCommentStats, getTopComments, importComments } from "../db/comments.js";
import { transcribeFile, checkProviders, toSrt, toVtt, toAss, toMarkdown, segmentByChapters, formatWithConfidence, estimateCost } from "../lib/providers.js";
import { getConfig, setConfig, resetConfig, CONFIG_DEFAULTS, CONFIG_KEYS, type ConfigKey } from "../lib/config.js";
import { summarizeText, extractHighlights, generateMeetingNotes, getDefaultSummaryProvider } from "../lib/summarizer.js";
import { translateText } from "../lib/translator.js";
import { fetchFeedEpisodes } from "../lib/feeds.js";
import { fireWebhook } from "../lib/webhook.js";
import { createAnnotation, listAnnotations, deleteAnnotation, formatTimestamp as fmtAnnoTs } from "../db/annotations.js";
import { pushToNotion } from "../lib/notion.js";
import { startLiveTranscription } from "../lib/live.js";
import { wordDiff, formatDiff, diffStats } from "../lib/diff.js";
import { proofreadTranscript, listIssues, applySuggestion, dismissIssue, getProofreadStats, exportAnnotated, type IssueType } from "../lib/proofread.js";

const program = new Command();

program
  .name("microservice-transcriber")
  .description("Transcribe audio and video from files and URLs using ElevenLabs or OpenAI")
  .version("0.0.1");

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
// info
// ---------------------------------------------------------------------------

program
  .command("info <url>")
  .description("Fetch video metadata (title, duration, chapters) without downloading or transcribing")
  .option("--json", "Output as JSON")
  .action(async (url: string, opts) => {
    try {
      const info = await getVideoInfo(url);

      if (opts.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      console.log(`Title:       ${info.title ?? "(unknown)"}`);
      console.log(`Platform:    ${info.platform ?? "(unknown)"}`);
      console.log(`Uploader:    ${info.uploader ?? "(unknown)"}`);
      if (info.duration !== null) {
        const m = Math.floor(info.duration / 60);
        const s = Math.floor(info.duration % 60);
        console.log(`Duration:    ${m}m ${s}s (${info.duration}s)`);
      }
      if (info.upload_date) {
        const d = info.upload_date;
        console.log(`Uploaded:    ${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
      }
      if (info.view_count !== null) {
        console.log(`Views:       ${info.view_count.toLocaleString()}`);
      }
      if (info.description) {
        console.log(`Description: ${info.description.slice(0, 120)}${info.description.length > 120 ? "…" : ""}`);
      }
      if (info.chapters.length > 0) {
        console.log(`\nChapters (${info.chapters.length}):`);
        for (const ch of info.chapters) {
          const m = Math.floor(ch.start_time / 60);
          const s = Math.floor(ch.start_time % 60);
          console.log(`  ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}  ${ch.title}`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

program
  .command("download <url>")
  .description("Download audio from a URL without transcribing")
  .option("--format <fmt>", "Audio format: mp3 (default), m4a, wav", "mp3")
  .option("--output <path>", "Output file path (overrides auto-naming)")
  .option("--start <seconds>", "Start time in seconds", parseFloat)
  .option("--end <seconds>", "End time in seconds", parseFloat)
  .option("--json", "Output as JSON")
  .action(async (url: string, opts) => {
    if (!opts.json) console.log(`Downloading audio from ${url}...`);

    try {
      const trim = opts.start !== undefined || opts.end !== undefined
        ? { start: opts.start, end: opts.end }
        : undefined;

      const result = await downloadAudio(url, {
        format: opts.format,
        outputPath: opts.output,
        trim,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Saved: ${result.filePath}`);
        if (result.title) console.log(`Title: ${result.title}`);
        if (result.duration) {
          const m = Math.floor(result.duration / 60);
          const s = Math.floor(result.duration % 60);
          console.log(`Duration: ${m}m ${s}s`);
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

program
  .command("list")
  .description("List transcripts")
  .option("--status <status>", "Filter by status: pending, processing, completed, failed")
  .option("--provider <provider>", "Filter by provider: elevenlabs, openai")
  .option("--source-type <type>", "Filter by source type: file, youtube, vimeo, wistia, url")
  .option("--tag <tag>", "Filter by tag")
  .option("--limit <n>", "Max results", "20")
  .option("--offset <n>", "Offset", "0")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const transcripts = opts.tag
      ? listTranscriptsByTag(opts.tag, parseInt(opts.limit))
      : listTranscripts({
          status: opts.status as TranscriptStatus | undefined,
          provider: opts.provider as TranscriptProvider | undefined,
          source_type: opts.sourceType as TranscriptSourceType | undefined,
          limit: parseInt(opts.limit),
          offset: parseInt(opts.offset),
        });

    if (opts.json) {
      console.log(JSON.stringify(transcripts, null, 2));
      return;
    }

    if (transcripts.length === 0) {
      console.log("No transcripts found.");
      return;
    }

    for (const t of transcripts) {
      const title = t.title || t.source_url?.slice(0, 60) || "(no source)";
      const duration = t.duration_seconds ? ` [${t.duration_seconds.toFixed(0)}s]` : "";
      const words = t.word_count ? ` ${t.word_count}w` : "";
      console.log(`${t.id.slice(0, 8)}  ${t.status.padEnd(12)} ${t.provider.padEnd(11)} ${t.source_type.padEnd(8)}${duration}${words}  ${title}`);
    }
  });

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

program
  .command("get <id>")
  .description("Get a transcript by ID")
  .option("--show-confidence", "Flag low-confidence words with [?word?] markers (ElevenLabs only)")
  .option("--confidence-threshold <n>", "Confidence threshold 0-1 (default 0.7)", parseFloat)
  .option("--json", "Output as JSON")
  .action((id: string, opts) => {
    const t = getTranscript(id);
    if (!t) {
      console.error(`Transcript '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(t, null, 2));
      return;
    }

    console.log(`ID:       ${t.id}`);
    console.log(`Title:    ${t.title ?? "(none)"}`);
    console.log(`Source:   ${t.source_url ?? "(none)"} [${t.source_type}]`);
    console.log(`Provider: ${t.provider}`);
    console.log(`Language: ${t.language}`);
    console.log(`Status:   ${t.status}`);
    if (t.duration_seconds) console.log(`Duration: ${t.duration_seconds.toFixed(1)}s`);
    if (t.word_count) console.log(`Words:    ${t.word_count}`);
    console.log(`Created:  ${t.created_at}`);
    if (t.metadata?.cost_usd) console.log(`Cost:     $${t.metadata.cost_usd.toFixed(4)}`);
    const annos = listAnnotations(id);
    if (annos.length > 0) {
      console.log(`\n--- Annotations (${annos.length}) ---\n`);
      for (const a of annos) console.log(`  [${fmtAnnoTs(a.timestamp_sec)}] ${a.note}`);
    }
    if (t.error_message) console.log(`Error:    ${t.error_message}`);
    if (t.metadata?.summary) {
      console.log(`\n--- Summary ---\n`);
      console.log(t.metadata.summary);
    }
    if (t.metadata?.highlights && t.metadata.highlights.length > 0) {
      console.log(`\n--- Highlights (${t.metadata.highlights.length}) ---\n`);
      for (const h of t.metadata.highlights) {
        console.log(`  "${h.quote}"${h.speaker ? ` (${h.speaker})` : ""}`);
      }
    }
    if (t.metadata?.chapters && t.metadata.chapters.length > 0) {
      console.log(`\n--- Chapters (${t.metadata.chapters.length}) ---\n`);
      for (const ch of t.metadata.chapters) {
        const m = Math.floor(ch.start_time / 60);
        const s = Math.floor(ch.start_time % 60);
        console.log(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}  ${ch.title}`);
        console.log(`  ${ch.text.slice(0, 120)}${ch.text.length > 120 ? "…" : ""}`);
      }
    } else if (t.transcript_text) {
      console.log(`\n--- Transcript ---\n`);
      if (opts.showConfidence && t.metadata?.words?.length) {
        console.log(formatWithConfidence(t.metadata.words, opts.confidenceThreshold ?? 0.7));
      } else {
        console.log(t.transcript_text);
      }
    }
  });

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

program
  .command("search <query>")
  .description("Search transcript text, titles, and source URLs")
  .option("--context <n>", "Show N sentences of context around each match", parseInt)
  .option("--json", "Output as JSON")
  .action((query: string, opts) => {
    if (opts.context !== undefined) {
      // Contextual search with excerpts + timestamps
      const matches = searchWithContext(query, opts.context);
      if (opts.json) { console.log(JSON.stringify(matches, null, 2)); return; }
      if (matches.length === 0) { console.log(`No transcripts matching '${query}'.`); return; }
      console.log(`Found ${matches.length} match(es):\n`);
      for (const m of matches) {
        const ts = m.timestamp ? ` ${m.timestamp}` : "";
        console.log(`${m.transcript_id.slice(0, 8)}${ts}  ${m.title ?? "(untitled)"}`);
        console.log(`  ${m.excerpt}\n`);
      }
      return;
    }

    const results = searchTranscripts(query);
    if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
    if (results.length === 0) { console.log(`No transcripts matching '${query}'.`); return; }
    console.log(`Found ${results.length} transcript(s):\n`);
    for (const t of results) {
      const title = t.title || t.source_url?.slice(0, 60) || "(no source)";
      console.log(`${t.id.slice(0, 8)}  ${title}`);
    }
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

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

program
  .command("delete <id>")
  .description("Delete a transcript")
  .option("--json", "Output as JSON")
  .action((id: string, opts) => {
    const deleted = deleteTranscript(id);
    if (!deleted) {
      console.error(`Transcript '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify({ id, deleted: true }));
    } else {
      console.log(`Deleted transcript ${id}.`);
    }
  });

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

program
  .command("export <id>")
  .description("Export a transcript in txt, srt, vtt, ass, md, or json format")
  .option("--format <fmt>", "Format: txt (default), srt, vtt, ass, md, json", "txt")
  .option("--output <file>", "Write to file instead of stdout")
  .option("--font <name>", "Font name for ASS format", "Arial")
  .option("--font-size <n>", "Font size for ASS format", "20")
  .option("--color <hex>", "Text color hex for ASS format (default: FFFFFF)")
  .option("--outline <n>", "Outline size for ASS format", "2")
  .option("--shadow <n>", "Shadow size for ASS format", "1")
  .option("--show-confidence", "Flag low-confidence words in txt output (ElevenLabs only)")
  .option("--confidence-threshold <n>", "Confidence threshold 0-1 (default 0.7)", parseFloat)
  .option("--to <service>", "Push to external service: notion")
  .option("--page <id>", "Notion parent page ID (required with --to notion)")
  .action(async (id: string, opts) => {
    // Handle Notion export
    if (opts.to === "notion") {
      if (!opts.page) { console.error("--page <notion-page-id> is required for Notion export."); process.exit(1); }
      const t = getTranscript(id);
      if (!t) { console.error(`Transcript '${id}' not found.`); process.exit(1); }
      if (t.status !== "completed") { console.error(`Transcript not completed.`); process.exit(1); }
      try {
        console.log("Pushing to Notion...");
        const result = await pushToNotion(t, opts.page);
        console.log(`Created Notion page: ${result.url}`);
      } catch (e) { console.error(`Error: ${e instanceof Error ? e.message : e}`); process.exit(1); }
      return;
    }
    const t = getTranscript(id);
    if (!t) {
      console.error(`Transcript '${id}' not found.`);
      process.exit(1);
    }

    if (t.status !== "completed" || !t.transcript_text) {
      console.error(`Transcript '${id}' is not completed (status: ${t.status}).`);
      process.exit(1);
    }

    let output: string;

    if (opts.format === "json") {
      output = JSON.stringify(t, null, 2);
    } else if (opts.format === "md") {
      output = toMarkdown(t);
    } else if (opts.format === "srt" || opts.format === "vtt" || opts.format === "ass") {
      const words = t.metadata?.words ?? [];
      if (words.length === 0) {
        console.error(`No word-level timestamps available for ${opts.format.toUpperCase()} export.`);
        process.exit(1);
      }
      if (opts.format === "vtt") output = toVtt(words);
      else if (opts.format === "ass") output = toAss(words, {
        fontName: opts.font,
        fontSize: parseInt(opts.fontSize ?? "20"),
        color: opts.color,
        outline: parseInt(opts.outline ?? "2"),
        shadow: parseInt(opts.shadow ?? "1"),
      });
      else output = toSrt(words);
    } else {
      // txt format — optionally apply confidence markers
      if (opts.showConfidence && t.metadata?.words?.length) {
        output = formatWithConfidence(t.metadata.words, opts.confidenceThreshold ?? 0.7);
      } else {
        output = t.transcript_text;
      }
    }

    if (opts.output) {
      writeFileSync(opts.output, output, "utf8");
      console.log(`Exported to ${opts.output}`);
    } else {
      console.log(output);
    }
  });

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------

program
  .command("providers")
  .description("Check which transcription providers are configured")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const available = checkProviders();

    if (opts.json) {
      console.log(JSON.stringify(available, null, 2));
      return;
    }

    console.log(`elevenlabs  ${available.elevenlabs ? "✓ configured (ELEVENLABS_API_KEY)" : "✗ ELEVENLABS_API_KEY not set"}`);
    console.log(`openai      ${available.openai ? "✓ configured (OPENAI_API_KEY)" : "✗ OPENAI_API_KEY not set"}`);
    console.log(`deepgram    ${available.deepgram ? "✓ configured (DEEPGRAM_API_KEY)" : "✗ DEEPGRAM_API_KEY not set"}`);
  });

// ---------------------------------------------------------------------------
// tag
// ---------------------------------------------------------------------------

const tagCmd = program
  .command("tag <id>")
  .description("Manage tags on a transcript")
  .option("--add <tags>", "Add comma-separated tags")
  .option("--remove <tags>", "Remove comma-separated tags")
  .option("--json", "Output as JSON")
  .action((id: string, opts) => {
    if (opts.add) {
      const tags = addTags(id, opts.add.split(",").map((t: string) => t.trim()));
      if (opts.json) { console.log(JSON.stringify({ id, tags })); }
      else { console.log(`Tags: ${tags.join(", ")}`); }
    } else if (opts.remove) {
      const tags = removeTags(id, opts.remove.split(",").map((t: string) => t.trim()));
      if (opts.json) { console.log(JSON.stringify({ id, tags })); }
      else { console.log(`Tags: ${tags.join(", ") || "(none)"}`); }
    } else {
      const tags = getTags(id);
      if (opts.json) { console.log(JSON.stringify({ id, tags })); }
      else { console.log(`Tags: ${tags.join(", ") || "(none)"}`); }
    }
  });

program
  .command("tags")
  .description("List all tags with counts")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const tags = listAllTags();
    if (opts.json) { console.log(JSON.stringify(tags, null, 2)); return; }
    if (tags.length === 0) { console.log("No tags."); return; }
    for (const t of tags) console.log(`  ${t.tag.padEnd(20)} ${t.count}`);
  });

// ---------------------------------------------------------------------------
// rename-speaker
// ---------------------------------------------------------------------------

program
  .command("rename-speaker <id>")
  .description("Rename speaker labels (e.g. 'Speaker 1' → 'Andrej Karpathy')")
  .option("--from <name>", "Original speaker label (e.g. 'Speaker 1')")
  .option("--to <name>", "New speaker name")
  .option("--map <json>", 'Bulk rename JSON: \'{"Speaker 1":"Name","Speaker 2":"Name"}\'')
  .option("--json", "Output as JSON")
  .action((id: string, opts) => {
    let mapping: Record<string, string> = {};

    if (opts.map) {
      try { mapping = JSON.parse(opts.map); } catch {
        console.error("Invalid JSON for --map"); process.exit(1);
      }
    } else if (opts.from && opts.to) {
      mapping[opts.from] = opts.to;
    } else {
      console.error("Provide --from/--to or --map"); process.exit(1);
    }

    const updated = renameSpeakers(id, mapping);
    if (!updated) { console.error(`Transcript '${id}' not found.`); process.exit(1); }

    if (opts.json) {
      console.log(JSON.stringify(updated, null, 2));
    } else {
      console.log(`Renamed ${Object.keys(mapping).length} speaker(s) in ${id}.`);
      for (const [from, to] of Object.entries(mapping)) {
        console.log(`  ${from} → ${to}`);
      }
    }
  });

// ---------------------------------------------------------------------------
// translate
// ---------------------------------------------------------------------------

program
  .command("translate <id>")
  .description("Translate a completed transcript to another language, creating a new linked record")
  .requiredOption("--to <lang>", "Target language code or name (e.g. fr, de, Spanish)")
  .option("--provider <provider>", "AI provider: openai or anthropic (auto-detected from env)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts) => {
    const t = getTranscript(id);
    if (!t) { console.error(`Transcript '${id}' not found.`); process.exit(1); }
    if (t.status !== "completed" || !t.transcript_text) {
      console.error(`Transcript '${id}' is not completed.`); process.exit(1);
    }

    const provider = opts.provider ?? getDefaultSummaryProvider();
    if (!provider) {
      console.error("No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
      process.exit(1);
    }

    if (!opts.json) console.log(`Translating to ${opts.to} with ${provider}...`);

    try {
      const translatedText = await translateText(t.transcript_text, opts.to, opts.provider);

      // Create a new transcript record linked to the original
      const newRecord = createTranscript({
        source_url: t.source_url ?? `translated:${id}`,
        source_type: "translated",
        provider: t.provider,
        language: opts.to,
        title: t.title ? `${t.title} [${opts.to}]` : null,
        source_transcript_id: id,
      });

      updateTranscript(newRecord.id, {
        status: "completed",
        transcript_text: translatedText,
        word_count: translatedText.split(/\s+/).filter(Boolean).length,
        metadata: { model: provider },
      });

      const result = getTranscript(newRecord.id)!;

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\nTranslation ID: ${newRecord.id} (source: ${id})`);
        console.log(`\n--- Translation (${opts.to}) ---\n`);
        console.log(translatedText);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

program
  .command("summarize <id>")
  .description("Summarize a completed transcript using AI (OpenAI or Anthropic)")
  .option("--provider <provider>", "Provider: openai or anthropic (auto-detected from env)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts) => {
    const t = getTranscript(id);
    if (!t) { console.error(`Transcript '${id}' not found.`); process.exit(1); }
    if (t.status !== "completed" || !t.transcript_text) {
      console.error(`Transcript '${id}' is not completed.`); process.exit(1);
    }

    const provider = opts.provider ?? getDefaultSummaryProvider();
    if (!provider) {
      console.error("No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
      process.exit(1);
    }

    if (!opts.json) console.log(`Summarizing with ${provider}...`);

    try {
      const summary = await summarizeText(t.transcript_text, opts.provider);
      const updated = updateTranscript(id, {
        metadata: { ...t.metadata, summary },
      });

      if (opts.json) {
        console.log(JSON.stringify({ id, summary }, null, 2));
      } else {
        console.log(`\n--- Summary ---\n`);
        console.log(summary);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

program
  .command("diff <id1> <id2>")
  .description("Compare two transcripts word-by-word")
  .option("--json", "Output as JSON")
  .action((id1: string, id2: string, opts) => {
    const t1 = getTranscript(id1);
    const t2 = getTranscript(id2);
    if (!t1) { console.error(`Transcript '${id1}' not found.`); process.exit(1); }
    if (!t2) { console.error(`Transcript '${id2}' not found.`); process.exit(1); }
    if (!t1.transcript_text || !t2.transcript_text) {
      console.error("Both transcripts must be completed."); process.exit(1);
    }

    const entries = wordDiff(t1.transcript_text, t2.transcript_text);
    const stats = diffStats(entries);

    if (opts.json) {
      console.log(JSON.stringify({ id1, id2, stats, diff: entries }, null, 2));
      return;
    }

    console.log(`Comparing:`);
    console.log(`  A: ${t1.title ?? id1} (${t1.provider})`);
    console.log(`  B: ${t2.title ?? id2} (${t2.provider})`);
    console.log(`\nSimilarity: ${stats.similarity}%`);
    console.log(`Equal: ${stats.equal} words | Added: ${stats.added} | Removed: ${stats.removed}\n`);
    console.log(formatDiff(entries));
  });

// ---------------------------------------------------------------------------
// clip
// ---------------------------------------------------------------------------

program
  .command("clip <id>")
  .description("Extract a video/audio clip with optional burned-in subtitles")
  .requiredOption("--start <seconds>", "Start time in seconds", parseFloat)
  .requiredOption("--end <seconds>", "End time in seconds", parseFloat)
  .option("--output <path>", "Output file path (default: clip-{id}.mp4)")
  .option("--no-subtitles", "Don't burn in subtitles")
  .action(async (id: string, opts) => {
    const t = getTranscript(id);
    if (!t) { console.error(`Transcript '${id}' not found.`); process.exit(1); }
    if (!t.source_url || t.source_type === "file") {
      console.error("Clip extraction requires a URL source."); process.exit(1);
    }

    const outputPath = opts.output ?? `clip-${id.slice(0, 8)}.mp4`;
    console.log(`Downloading video from ${t.source_url}...`);

    let video: Awaited<ReturnType<typeof downloadVideo>> | null = null;
    let subsFile: string | null = null;
    try {
      video = await downloadVideo(t.source_url);

      // Generate ASS subtitles for the time range
      if (opts.subtitles !== false && t.metadata?.words?.length) {
        const rangeWords = t.metadata.words.filter((w) => w.start >= opts.start && w.end <= opts.end);
        if (rangeWords.length > 0) {
          const { toAss } = await import("../lib/providers.js");
          // Offset words to start from 0 for the clip
          const offsetWords = rangeWords.map((w) => ({ ...w, start: w.start - opts.start, end: w.end - opts.start }));
          const assContent = toAss(offsetWords);
          subsFile = `/tmp/transcriber-clip-subs-${crypto.randomUUID()}.ass`;
          const { writeFileSync } = await import("node:fs");
          writeFileSync(subsFile, assContent, "utf8");
        }
      }

      console.log(`Creating clip [${opts.start}s → ${opts.end}s]...`);
      await createClip({
        videoPath: video.path,
        start: opts.start,
        end: opts.end,
        subtitlePath: subsFile ?? undefined,
        outputPath,
      });

      console.log(`Saved: ${outputPath}`);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    } finally {
      video?.cleanup();
      if (subsFile) { try { const { unlinkSync } = await import("node:fs"); unlinkSync(subsFile); } catch {} }
    }
  });

// ---------------------------------------------------------------------------
// meeting-notes
// ---------------------------------------------------------------------------

program
  .command("meeting-notes <id>")
  .description("Generate structured meeting notes from a transcript using AI")
  .option("--provider <provider>", "AI provider: openai or anthropic")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts) => {
    const t = getTranscript(id);
    if (!t) { console.error(`Transcript '${id}' not found.`); process.exit(1); }
    if (t.status !== "completed" || !t.transcript_text) {
      console.error(`Transcript '${id}' is not completed.`); process.exit(1);
    }

    const provider = opts.provider ?? getDefaultSummaryProvider();
    if (!provider) { console.error("No AI provider. Set OPENAI_API_KEY or ANTHROPIC_API_KEY."); process.exit(1); }

    if (!opts.json) console.log(`Generating meeting notes with ${provider}...`);

    try {
      const notes = await generateMeetingNotes(t.transcript_text, opts.provider);
      updateTranscript(id, { metadata: { ...t.metadata, meeting_notes: notes } });

      if (opts.json) {
        console.log(JSON.stringify({ id, meeting_notes: notes }, null, 2));
      } else {
        console.log(`\n${notes}`);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// highlights
// ---------------------------------------------------------------------------

program
  .command("highlights <id>")
  .description("Extract 5-10 key moments/quotes from a transcript using AI")
  .option("--provider <provider>", "AI provider: openai or anthropic")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts) => {
    const t = getTranscript(id);
    if (!t) { console.error(`Transcript '${id}' not found.`); process.exit(1); }
    if (t.status !== "completed" || !t.transcript_text) {
      console.error(`Transcript '${id}' is not completed.`); process.exit(1);
    }

    const provider = opts.provider ?? getDefaultSummaryProvider();
    if (!provider) { console.error("No AI provider. Set OPENAI_API_KEY or ANTHROPIC_API_KEY."); process.exit(1); }

    if (!opts.json) console.log(`Extracting highlights with ${provider}...`);

    try {
      const highlights = await extractHighlights(t.transcript_text, opts.provider);
      updateTranscript(id, { metadata: { ...t.metadata, highlights } });

      if (opts.json) {
        console.log(JSON.stringify({ id, highlights }, null, 2));
      } else {
        console.log(`\n--- ${highlights.length} Key Moments ---\n`);
        for (let i = 0; i < highlights.length; i++) {
          const h = highlights[i];
          const speaker = h.speaker ? ` (${h.speaker})` : "";
          console.log(`${i + 1}. "${h.quote}"${speaker}`);
          console.log(`   ${h.context}\n`);
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

program
  .command("stats")
  .description("Show transcript counts by status, provider, and costs")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const counts = countTranscripts();

    // Calculate total cost across all transcripts
    const allTranscripts = listTranscripts({ limit: 10000 });
    const totalCost = allTranscripts.reduce((sum, t) => sum + (t.metadata?.cost_usd ?? 0), 0);
    const costByProvider: Record<string, number> = {};
    for (const t of allTranscripts) {
      if (t.metadata?.cost_usd) {
        costByProvider[t.provider] = (costByProvider[t.provider] ?? 0) + t.metadata.cost_usd;
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({ ...counts, total_cost_usd: totalCost, cost_by_provider: costByProvider }, null, 2));
      return;
    }

    console.log(`Total: ${counts.total}`);
    console.log("\nBy status:");
    for (const [status, n] of Object.entries(counts.by_status)) {
      console.log(`  ${status.padEnd(12)} ${n}`);
    }
    console.log("\nBy provider:");
    for (const [provider, n] of Object.entries(counts.by_provider)) {
      const cost = costByProvider[provider];
      const costStr = cost ? ` ($${cost.toFixed(4)})` : "";
      console.log(`  ${provider.padEnd(12)} ${n}${costStr}`);
    }
    if (totalCost > 0) {
      console.log(`\nTotal cost: $${totalCost.toFixed(4)}`);
    }
  });

// ---------------------------------------------------------------------------
// annotate
// ---------------------------------------------------------------------------

const annoCmd = program
  .command("annotate")
  .description("Manage timestamped annotations/bookmarks on transcripts");

annoCmd
  .command("add <transcript-id>")
  .description("Add an annotation at a timestamp")
  .requiredOption("--at <seconds>", "Timestamp in seconds", parseFloat)
  .requiredOption("--note <text>", "Annotation note")
  .option("--json", "Output as JSON")
  .action((transcriptId: string, opts) => {
    const anno = createAnnotation(transcriptId, opts.at, opts.note);
    if (opts.json) { console.log(JSON.stringify(anno, null, 2)); }
    else { console.log(`Added annotation at ${fmtAnnoTs(opts.at)}: ${opts.note} (${anno.id.slice(0, 8)})`); }
  });

annoCmd
  .command("list <transcript-id>")
  .description("List all annotations for a transcript")
  .option("--json", "Output as JSON")
  .action((transcriptId: string, opts) => {
    const annos = listAnnotations(transcriptId);
    if (opts.json) { console.log(JSON.stringify(annos, null, 2)); return; }
    if (annos.length === 0) { console.log("No annotations."); return; }
    for (const a of annos) {
      console.log(`  [${fmtAnnoTs(a.timestamp_sec)}] ${a.note} (${a.id.slice(0, 8)})`);
    }
  });

annoCmd
  .command("remove <id>")
  .description("Delete an annotation by ID")
  .action((id: string) => {
    if (deleteAnnotation(id)) console.log(`Deleted annotation ${id}.`);
    else { console.error("Annotation not found."); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

const commentsCmd = program
  .command("comments")
  .description("Manage video comments extracted from YouTube/Vimeo");

commentsCmd
  .command("list <transcript-id>")
  .description("List comments for a transcript")
  .option("--top", "Sort by most liked")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Output as JSON")
  .action((transcriptId: string, opts) => {
    const comments = listComments(transcriptId, {
      limit: parseInt(opts.limit),
      top: opts.top,
    });

    if (opts.json) {
      console.log(JSON.stringify(comments, null, 2));
      return;
    }

    if (comments.length === 0) {
      console.log("No comments found.");
      return;
    }

    for (const c of comments) {
      const likesStr = c.likes > 0 ? ` [${c.likes} likes]` : "";
      const replyStr = c.is_reply ? " (reply)" : "";
      console.log(`${c.author ?? "Anonymous"}${replyStr}${likesStr}`);
      console.log(`  ${c.comment_text.slice(0, 200)}${c.comment_text.length > 200 ? "..." : ""}`);
      console.log();
    }
  });

commentsCmd
  .command("search <query>")
  .description("Search comment text across all transcripts")
  .option("--json", "Output as JSON")
  .action((query: string, opts) => {
    const results = searchComments(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(`No comments matching '${query}'.`);
      return;
    }

    console.log(`Found ${results.length} comment(s):\n`);
    for (const c of results) {
      const likesStr = c.likes > 0 ? ` [${c.likes} likes]` : "";
      console.log(`${c.author ?? "Anonymous"}${likesStr} (transcript: ${c.transcript_id.slice(0, 8)})`);
      console.log(`  ${c.comment_text.slice(0, 200)}${c.comment_text.length > 200 ? "..." : ""}`);
      console.log();
    }
  });

commentsCmd
  .command("stats <transcript-id>")
  .description("Show comment statistics for a transcript")
  .option("--json", "Output as JSON")
  .action((transcriptId: string, opts) => {
    const stats = getCommentStats(transcriptId);

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    console.log(`Total comments:  ${stats.total}`);
    console.log(`Replies:         ${stats.replies}`);
    console.log(`Unique authors:  ${stats.unique_authors}`);
    console.log(`Avg likes:       ${stats.avg_likes}`);
    if (stats.top_commenter) {
      console.log(`Top commenter:   ${stats.top_commenter}`);
    }
  });

// ---------------------------------------------------------------------------
// watch-feed
// ---------------------------------------------------------------------------

const feedCmd = program
  .command("feed")
  .description("Manage podcast RSS feeds for auto-transcription");

feedCmd
  .command("add <url>")
  .description("Add a podcast RSS feed to watch")
  .action(async (url: string) => {
    try {
      const { feedTitle } = await fetchFeedEpisodes(url);
      const cfg = getConfig();
      if (cfg.feeds.some((f) => f.url === url)) {
        console.log(`Feed already added: ${feedTitle ?? url}`);
        return;
      }
      cfg.feeds.push({ url, title: feedTitle, lastChecked: null });
      setConfig({ feeds: cfg.feeds });
      console.log(`Added feed: ${feedTitle ?? url}`);
    } catch (e) {
      console.error(`Failed to add feed: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }
  });

feedCmd
  .command("list")
  .description("List watched feeds")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const cfg = getConfig();
    if (opts.json) { console.log(JSON.stringify(cfg.feeds, null, 2)); return; }
    if (cfg.feeds.length === 0) { console.log("No feeds."); return; }
    for (const f of cfg.feeds) {
      const checked = f.lastChecked ? ` (last checked: ${f.lastChecked})` : " (never checked)";
      console.log(`  ${f.title ?? f.url}${checked}`);
      console.log(`    ${f.url}`);
    }
  });

feedCmd
  .command("check")
  .description("Check all feeds for new episodes and transcribe them")
  .option("--provider <provider>", "Provider override")
  .option("--dry-run", "List new episodes without transcribing")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const cfg = getConfig();
    if (cfg.feeds.length === 0) { console.log("No feeds to check."); return; }

    const provider = (opts.provider ?? cfg.defaultProvider) as TranscriptProvider;
    let totalNew = 0;

    for (const feed of cfg.feeds) {
      console.log(`Checking ${feed.title ?? feed.url}...`);
      try {
        const { episodes } = await fetchFeedEpisodes(feed.url);
        const newEpisodes = episodes.filter((ep) => !findBySourceUrl(ep.url));

        if (newEpisodes.length === 0) {
          console.log("  No new episodes.");
        } else {
          console.log(`  ${newEpisodes.length} new episode(s)`);
          totalNew += newEpisodes.length;

          if (!opts.dryRun) {
            for (const ep of newEpisodes) {
              console.log(`  Transcribing: ${ep.title ?? ep.url}`);
              const record = createTranscript({
                source_url: ep.url,
                source_type: "url",
                provider,
                title: ep.title,
              });
              updateTranscript(record.id, { status: "processing" });
              let audio: Awaited<ReturnType<typeof prepareAudio>> | null = null;
              try {
                audio = await prepareAudio(ep.url);
                const result = await transcribeFile(audio.filePath, { provider });
                updateTranscript(record.id, {
                  status: "completed",
                  transcript_text: result.text,
                  duration_seconds: result.duration_seconds ?? undefined,
                  word_count: result.text.split(/\s+/).filter(Boolean).length,
                  metadata: result.metadata,
                });
                console.log(`    ✓ ${record.id.slice(0, 8)}`);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                updateTranscript(record.id, { status: "failed", error_message: msg });
                console.error(`    ✗ ${msg}`);
              } finally {
                audio?.cleanup();
              }
            }
          }
        }

        // Update lastChecked
        feed.lastChecked = new Date().toISOString();
      } catch (e) {
        console.error(`  Error: ${e instanceof Error ? e.message : e}`);
      }
    }

    setConfig({ feeds: cfg.feeds });
    console.log(`\nDone. ${totalNew} new episode(s) found.`);
  });

feedCmd
  .command("remove <url>")
  .description("Remove a feed")
  .action((url: string) => {
    const cfg = getConfig();
    cfg.feeds = cfg.feeds.filter((f) => f.url !== url);
    setConfig({ feeds: cfg.feeds });
    console.log(`Removed feed: ${url}`);
  });

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

const configCmd = program
  .command("config")
  .description("View or change persistent configuration defaults");

configCmd
  .command("view")
  .description("Show current config")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const cfg = getConfig();
    if (opts.json) {
      console.log(JSON.stringify(cfg, null, 2));
      return;
    }
    console.log(`defaultProvider  ${cfg.defaultProvider}`);
    console.log(`defaultLanguage  ${cfg.defaultLanguage}`);
    console.log(`defaultFormat    ${cfg.defaultFormat}`);
    console.log(`diarize          ${cfg.diarize}`);
    console.log(`vocab            ${cfg.vocab?.length ? cfg.vocab.join(", ") : "(none)"}`);
  });

configCmd
  .command("set <key> <value>")
  .description(`Set a config value. Keys: ${CONFIG_KEYS.join(", ")}`)
  .action((key: string, value: string) => {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      console.error(`Unknown config key: '${key}'. Valid keys: ${CONFIG_KEYS.join(", ")}`);
      process.exit(1);
    }

    const k = key as ConfigKey;
    let parsed: unknown = value;
    if (k === "diarize") parsed = value === "true";
    if (k === "vocab") parsed = value.split(",").map((v: string) => v.trim()).filter(Boolean);

    const updated = setConfig({ [k]: parsed } as Partial<typeof CONFIG_DEFAULTS>);
    console.log(`Set ${key} = ${updated[k]}`);
  });

configCmd
  .command("reset")
  .description("Reset all config to defaults")
  .action(() => {
    resetConfig();
    console.log("Config reset to defaults.");
  });

// ---------------------------------------------------------------------------
// proofread
// ---------------------------------------------------------------------------

const proofreadCmd = program
  .command("proofread")
  .description("AI-powered spellcheck and proofreading for transcripts");

proofreadCmd
  .command("run <transcript-id>")
  .description("Run AI proofreading on a transcript (non-destructive)")
  .option("--types <types>", "Comma-separated issue types: spelling,grammar,punctuation,clarity")
  .option("--confidence <n>", "Minimum confidence threshold 0-1 (default 0.7)", parseFloat)
  .option("--provider <provider>", "AI provider: openai or anthropic")
  .option("--json", "Output as JSON")
  .action(async (transcriptId: string, opts) => {
    const types = opts.types ? opts.types.split(",").map((t: string) => t.trim()) as IssueType[] : undefined;
    const confidence = opts.confidence ?? 0.7;

    if (!opts.json) console.log(`Proofreading transcript ${transcriptId}...`);

    try {
      const issues = await proofreadTranscript(transcriptId, { types, confidence_threshold: confidence, provider: opts.provider });

      if (opts.json) {
        console.log(JSON.stringify(issues, null, 2));
      } else {
        console.log(`Found ${issues.length} issue(s):\n`);
        for (const issue of issues) {
          console.log(`  [${issue.issue_type}] "${issue.original_text}" -> "${issue.suggestion ?? "(no suggestion)"}" (${((issue.confidence ?? 0) * 100).toFixed(0)}%)`);
          if (issue.explanation) console.log(`    ${issue.explanation}`);
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

proofreadCmd
  .command("issues <transcript-id>")
  .description("List proofread issues for a transcript")
  .option("--type <type>", "Filter by issue type: spelling, grammar, punctuation, clarity")
  .option("--pending", "Show only pending issues")
  .option("--json", "Output as JSON")
  .action((transcriptId: string, opts) => {
    const filters: { issue_type?: IssueType; status?: "pending" } = {};
    if (opts.type) filters.issue_type = opts.type as IssueType;
    if (opts.pending) filters.status = "pending";

    const issues = listIssues(transcriptId, filters);

    if (opts.json) {
      console.log(JSON.stringify(issues, null, 2));
      return;
    }

    if (issues.length === 0) { console.log("No issues found."); return; }

    for (const issue of issues) {
      const conf = issue.confidence !== null ? ` ${(issue.confidence * 100).toFixed(0)}%` : "";
      console.log(`${issue.id.slice(0, 8)}  [${issue.status.padEnd(9)}] [${issue.issue_type.padEnd(11)}]${conf}  "${issue.original_text}" -> "${issue.suggestion ?? "-"}"`);
    }
  });

proofreadCmd
  .command("apply <issue-id>")
  .description("Apply a proofread suggestion (modifies transcript text)")
  .option("--json", "Output as JSON")
  .action((issueId: string, opts) => {
    const updated = applySuggestion(issueId);
    if (!updated) { console.error(`Issue '${issueId}' not found.`); process.exit(1); }

    if (opts.json) {
      console.log(JSON.stringify(updated, null, 2));
    } else {
      console.log(`Applied: "${updated.original_text}" -> "${updated.suggestion}"`);
    }
  });

proofreadCmd
  .command("dismiss <issue-id>")
  .description("Dismiss a proofread issue without changing text")
  .option("--json", "Output as JSON")
  .action((issueId: string, opts) => {
    const updated = dismissIssue(issueId);
    if (!updated) { console.error(`Issue '${issueId}' not found.`); process.exit(1); }

    if (opts.json) {
      console.log(JSON.stringify(updated, null, 2));
    } else {
      console.log(`Dismissed: "${updated.original_text}"`);
    }
  });

proofreadCmd
  .command("export <transcript-id>")
  .description("Export transcript with inline proofread annotations")
  .action((transcriptId: string) => {
    try {
      const annotated = exportAnnotated(transcriptId);
      console.log(annotated);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

proofreadCmd
  .command("stats <transcript-id>")
  .description("Show proofread issue statistics")
  .option("--json", "Output as JSON")
  .action((transcriptId: string, opts) => {
    const stats = getProofreadStats(transcriptId);

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    console.log(`Total issues: ${stats.total}`);
    console.log(`Pending: ${stats.pending} | Applied: ${stats.applied} | Dismissed: ${stats.dismissed}`);
    if (Object.keys(stats.by_type).length > 0) {
      console.log("\nBy type:");
      for (const [type, count] of Object.entries(stats.by_type)) {
        console.log(`  ${type.padEnd(12)} ${count}`);
      }
    }
  });

program.parse();
