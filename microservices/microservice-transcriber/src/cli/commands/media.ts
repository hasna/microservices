import type { Command } from "commander";
import { getTranscript } from "../../db/transcripts.js";
import { getVideoInfo, downloadAudio, downloadVideo, createClip } from "../../lib/downloader.js";
import { toAss } from "../../lib/providers.js";
import { writeFileSync, unlinkSync } from "node:fs";

export function registerMediaCommands(program: Command): void {
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
            // Offset words to start from 0 for the clip
            const offsetWords = rangeWords.map((w) => ({ ...w, start: w.start - opts.start, end: w.end - opts.start }));
            const assContent = toAss(offsetWords);
            subsFile = `/tmp/transcriber-clip-subs-${crypto.randomUUID()}.ass`;
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
        if (subsFile) { try { unlinkSync(subsFile); } catch {} }
      }
    });
}
