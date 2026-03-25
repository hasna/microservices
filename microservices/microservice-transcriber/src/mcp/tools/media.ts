import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTranscript } from "../../db/transcripts.js";
import {
  downloadAudio,
  downloadVideo,
  getVideoInfo,
  createClip,
} from "../../lib/downloader.js";
import { toAss } from "../../lib/providers.js";

export function registerMediaTools(server: McpServer) {
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
}
