/**
 * Audio downloader — detects source type and extracts audio for transcription.
 * Uses yt-dlp for YouTube, Vimeo, Wistia, and other URL-based sources.
 * Uses ffmpeg for local file trimming.
 */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import type { TranscriptSourceType } from "../db/transcripts.js";

export interface VideoChapter {
  title: string;
  start_time: number;
  end_time: number;
}

export interface DownloadResult {
  filePath: string;
  sourceType: TranscriptSourceType;
  videoTitle: string | null;
  chapters: VideoChapter[];
  cleanup: () => void;
}

export interface TrimOptions {
  start?: number; // seconds
  end?: number;   // seconds
}

/**
 * Detect source type from a URL or file path.
 */
export function detectSourceType(source: string): TranscriptSourceType {
  if (!source.startsWith("http://") && !source.startsWith("https://")) {
    return "file";
  }

  const lower = source.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("vimeo.com")) return "vimeo";
  if (lower.includes("wistia.com") || lower.includes("wi.st") || lower.includes("wistia.net")) return "wistia";
  return "url";
}

/**
 * Download or locate audio from a source (URL or file path).
 * Optionally trims to a time range using --start / --end (seconds).
 *
 * For URLs: yt-dlp --download-sections handles the trim (avoids downloading unused parts).
 * For local files: ffmpeg -ss / -to handles the trim.
 */
export async function prepareAudio(source: string, trim?: TrimOptions): Promise<DownloadResult> {
  const sourceType = detectSourceType(source);

  if (sourceType === "file") {
    if (!existsSync(source)) {
      throw new Error(`File not found: ${source}`);
    }
    if (trim?.start !== undefined || trim?.end !== undefined) {
      const trimmed = await trimLocalFile(source, trim);
      return {
        filePath: trimmed,
        sourceType,
        videoTitle: null,
        chapters: [],
        cleanup: () => {
          try { if (existsSync(trimmed)) unlinkSync(trimmed); } catch {}
        },
      };
    }
    return {
      filePath: source,
      sourceType,
      videoTitle: null,
      chapters: [],
      cleanup: () => {},
    };
  }

  // Remote source — download full audio and fetch metadata in parallel
  const tempId = crypto.randomUUID();
  const outputTemplate = join(tmpdir(), `transcriber-${tempId}.%(ext)s`);

  const [, info] = await Promise.all([
    runYtDlp(source, outputTemplate),
    getVideoInfo(source).catch(() => null),
  ]);

  const downloadedPath = findDownloadedFile(tmpdir(), `transcriber-${tempId}`);
  if (!downloadedPath) {
    throw new Error(`yt-dlp did not produce an output file for: ${source}`);
  }

  // Trim locally with ffmpeg if start/end provided (more reliable than --download-sections)
  if (trim?.start !== undefined || trim?.end !== undefined) {
    const trimmedPath = await trimLocalFile(downloadedPath, trim);
    try { unlinkSync(downloadedPath); } catch {} // clean up full download
    return {
      filePath: trimmedPath,
      sourceType,
      videoTitle: info?.title ?? null,
      chapters: info?.chapters ?? [],
      cleanup: () => {
        try { if (existsSync(trimmedPath)) unlinkSync(trimmedPath); } catch {}
      },
    };
  }

  return {
    filePath: downloadedPath,
    sourceType,
    videoTitle: info?.title ?? null,
    chapters: info?.chapters ?? [],
    cleanup: () => {
      try { if (existsSync(downloadedPath)) unlinkSync(downloadedPath); } catch {}
    },
  };
}

/**
 * Quick title fetch using yt-dlp --print — no download, very fast.
 */
async function fetchVideoTitle(url: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      [ytdlp(), "--print", "%(title)s", "--no-download", url],
      { stdout: "pipe", stderr: "pipe" }
    );
    const [exitCode, stdout] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);
    if (exitCode !== 0) return null;
    const title = stdout.trim();
    return title.length > 0 && title !== "NA" ? title : null;
  } catch {
    return null;
  }
}

/**
 * Resolve yt-dlp binary — prefers homebrew version (usually newer) over pip.
 */
function getYtDlpBinary(): string {
  const home = process.env["HOME"] ?? "";
  const candidates = [`${home}/.local/bin/yt-dlp-nightly`, "/opt/homebrew/bin/yt-dlp", "yt-dlp"];
  for (const bin of candidates) {
    try {
      const proc = Bun.spawnSync([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
      if (proc.exitCode === 0) return bin;
    } catch {}
  }
  return "yt-dlp";
}

let _ytdlpBin: string | null = null;
function ytdlp(): string {
  if (!_ytdlpBin) _ytdlpBin = getYtDlpBinary();
  return _ytdlpBin;
}

async function runYtDlp(url: string, outputTemplate: string): Promise<void> {
  const args = [ytdlp(), "-x", "--audio-format", "mp3", "--audio-quality", "0", "-o", outputTemplate, url];

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`yt-dlp failed (exit ${exitCode}): ${stderr.trim()}`);
  }
}

async function trimLocalFile(filePath: string, trim: TrimOptions): Promise<string> {
  const tempId = crypto.randomUUID();
  const ext = filePath.split(".").pop() ?? "mp3";
  const outPath = join(tmpdir(), `transcriber-trim-${tempId}.${ext}`);

  const args = ["ffmpeg", "-y", "-i", filePath];
  if (trim.start !== undefined) args.push("-ss", String(trim.start));
  if (trim.end !== undefined) args.push("-to", String(trim.end));
  args.push("-c", "copy", outPath);

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg trim failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  return outPath;
}

function findDownloadedFile(dir: string, prefix: string): string | null {
  const extensions = ["mp3", "m4a", "ogg", "opus", "wav", "webm", "flac"];
  for (const ext of extensions) {
    const candidate = join(dir, `${prefix}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface VideoInfo {
  title: string | null;
  duration: number | null;       // seconds
  uploader: string | null;
  platform: string | null;
  description: string | null;
  thumbnail: string | null;
  upload_date: string | null;    // YYYYMMDD
  view_count: number | null;
  chapters: Array<{ title: string; start_time: number; end_time: number }>;
  formats: Array<{ format_id: string; ext: string; resolution: string | null }>;
}

/**
 * Fetch video metadata without downloading. Uses yt-dlp --dump-json.
 * Only works for URLs — returns null for local files.
 */
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const proc = Bun.spawn(
    [ytdlp(), "--dump-json", "--no-download", url],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`yt-dlp info failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error(`yt-dlp returned invalid JSON: ${stdout.slice(0, 200)}`);
  }

  const chapters = Array.isArray(raw["chapters"])
    ? (raw["chapters"] as Array<{ title: string; start_time: number; end_time: number }>).map((c) => ({
        title: c.title,
        start_time: c.start_time,
        end_time: c.end_time,
      }))
    : [];

  const formats = Array.isArray(raw["formats"])
    ? (raw["formats"] as Array<{ format_id: string; ext: string; resolution?: string | null }>)
        .slice(-10) // last 10 formats (usually best quality last)
        .map((f) => ({ format_id: f.format_id, ext: f.ext, resolution: f.resolution ?? null }))
    : [];

  return {
    title: (raw["title"] as string) ?? null,
    duration: typeof raw["duration"] === "number" ? raw["duration"] : null,
    uploader: (raw["uploader"] as string) ?? (raw["channel"] as string) ?? null,
    platform: (raw["extractor_key"] as string) ?? (raw["ie_key"] as string) ?? null,
    description: typeof raw["description"] === "string" ? raw["description"].slice(0, 500) : null,
    thumbnail: (raw["thumbnail"] as string) ?? null,
    upload_date: (raw["upload_date"] as string) ?? null,
    view_count: typeof raw["view_count"] === "number" ? raw["view_count"] : null,
    chapters,
    formats,
  };
}

export interface DownloadAudioOptions {
  format?: "mp3" | "m4a" | "wav";
  outputPath?: string; // explicit output file path (overrides auto-naming)
  trim?: TrimOptions;
}

export interface DownloadAudioResult {
  filePath: string;
  sourceType: TranscriptSourceType;
  title: string | null;
  duration: number | null;
}

/**
 * Resolve the base audio output directory:
 * .microservices/microservice-transcriber/audio/ (walks up from cwd, or falls back to home).
 */
export function getAudioOutputDir(): string {
  if (process.env["MICROSERVICES_DIR"]) {
    return join(process.env["MICROSERVICES_DIR"], "microservice-transcriber", "audio");
  }
  let dir = resolve(process.cwd());
  while (true) {
    const msDir = join(dir, ".microservices");
    if (existsSync(msDir)) return join(msDir, "microservice-transcriber", "audio");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(homedir(), ".microservices", "microservice-transcriber", "audio");
}

/**
 * Download video (not just audio) from a URL for clip extraction.
 * Returns path to temp video file.
 */
export async function downloadVideo(url: string): Promise<{ path: string; cleanup: () => void }> {
  const tempId = crypto.randomUUID();
  const outTemplate = join(tmpdir(), `transcriber-vid-${tempId}.%(ext)s`);

  const proc = Bun.spawn(
    [ytdlp(), "-f", "best[ext=mp4]/best", "-o", outTemplate, url],
    { stdout: "pipe", stderr: "pipe" }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`yt-dlp video download failed: ${stderr.trim()}`);
  }

  const extensions = ["mp4", "webm", "mkv", "avi"];
  for (const ext of extensions) {
    const candidate = join(tmpdir(), `transcriber-vid-${tempId}.${ext}`);
    if (existsSync(candidate)) {
      return { path: candidate, cleanup: () => { try { unlinkSync(candidate); } catch {} } };
    }
  }
  throw new Error("yt-dlp did not produce a video file");
}

/**
 * Create a video/audio clip with optional burned-in subtitles using ffmpeg.
 */
export async function createClip(options: {
  videoPath: string;
  start: number;
  end: number;
  subtitlePath?: string; // ASS file path to burn in
  outputPath: string;
}): Promise<void> {
  const args = ["ffmpeg", "-y", "-i", options.videoPath, "-ss", String(options.start), "-to", String(options.end)];

  if (options.subtitlePath) {
    // Burn in subtitles — need to escape path for ffmpeg filter
    const escaped = options.subtitlePath.replace(/[\\:]/g, "\\$&");
    args.push("-vf", `subtitles=${escaped}`);
  }

  args.push("-c:a", "aac", options.outputPath);

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg clip failed: ${stderr.trim().slice(-200)}`);
  }
}

/**
 * Detect whether a URL is a playlist (YouTube, etc.).
 */
export function isPlaylistUrl(url: string): boolean {
  return url.includes("list=") || url.includes("/playlist");
}

/**
 * Extract individual video URLs from a playlist using yt-dlp --flat-playlist.
 */
export async function getPlaylistUrls(url: string): Promise<Array<{ url: string; title: string | null }>> {
  const proc = Bun.spawn(
    [ytdlp(), "--flat-playlist", "--dump-json", "--no-download", url],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ]);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`yt-dlp playlist failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  // Each line is a JSON object for one video
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const entry = JSON.parse(line);
        const videoUrl = entry.url
          ? (entry.url.startsWith("http") ? entry.url : `https://www.youtube.com/watch?v=${entry.id || entry.url}`)
          : `https://www.youtube.com/watch?v=${entry.id}`;
        return { url: videoUrl, title: entry.title ?? null };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ url: string; title: string | null }>;
}

/**
 * Generate a 6-character random alphanumeric suffix for collision avoidance.
 */
function nanoSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => chars[b % chars.length])
    .join("");
}

/**
 * Normalize a title into a safe, lowercase, hyphenated filename stem.
 *
 * Rules:
 *  - Lowercase
 *  - & → "and"
 *  - Spaces and underscores → hyphens
 *  - Strip everything except alphanumeric, hyphens, dots
 *  - Collapse consecutive hyphens
 *  - Strip leading/trailing hyphens
 *  - Max 80 chars
 *  - Append 6-char nanoid suffix for collision avoidance
 *
 * Examples:
 *  "My Awesome Video! (2024)"  → "my-awesome-video-2024-a3k9mz"
 *  "C++ Tutorial: Part 1/3"   → "c-tutorial-part-1-3-b7xq2p"
 *  "Cats & Dogs Forever"       → "cats-and-dogs-forever-m4nk8r"
 */
export function normalizeFilename(title: string): string {
  let s = title.toLowerCase();
  s = s.replace(/&/g, "and");               // & → and
  s = s.replace(/[/_:,;|.]+/g, "-");       // separators → hyphens (/, :, _, ., etc.)
  s = s.replace(/[_\s]+/g, "-");            // spaces/underscores → hyphens
  s = s.replace(/[^a-z0-9-]/g, "");        // strip everything else (!, ?, +, (, ), etc.)
  s = s.replace(/-{2,}/g, "-");            // collapse multiple hyphens
  s = s.replace(/^-+|-+$/g, "");           // strip leading/trailing hyphens
  s = s.slice(0, 80);                       // max 80 chars
  s = s.replace(/-+$/, "");                // clean trailing hyphens after slice
  const suffix = nanoSuffix();
  return s.length > 0 ? `${s}-${suffix}` : suffix;
}

/**
 * Download audio from a URL and save to the audio library.
 * Does NOT transcribe — just extracts audio.
 */
export async function downloadAudio(
  url: string,
  options: DownloadAudioOptions = {}
): Promise<DownloadAudioResult> {
  const sourceType = detectSourceType(url);
  if (sourceType === "file") {
    throw new Error("Use a URL for download. Local files don't need downloading.");
  }

  const format = options.format ?? "mp3";

  // Fetch title and duration in parallel before downloading
  const info = await getVideoInfo(url).catch(() => null);
  const title = info?.title ?? null;
  const duration = info?.duration ?? null;

  // Determine output path
  let outPath: string;
  if (options.outputPath) {
    outPath = options.outputPath;
    mkdirSync(dirname(outPath), { recursive: true });
  } else {
    const platform = sourceType; // already lowercase alphanum (file/youtube/vimeo/etc.)
    const fileName = title ? normalizeFilename(title) : nanoSuffix();
    const audioDir = join(getAudioOutputDir(), platform);
    mkdirSync(audioDir, { recursive: true });
    outPath = join(audioDir, `${fileName}.${format}`);
  }

  const args = [ytdlp(), "-x", "--audio-format", format, "--audio-quality", "0", "-o", outPath, url];

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`yt-dlp failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  // yt-dlp may adjust extension; find actual file
  let actualPath = existsSync(outPath) ? outPath : findDownloadedFile(dirname(outPath), outPath.replace(/\.[^.]+$/, "").split("/").pop()!) ?? outPath;

  // Trim locally after download (more reliable than --download-sections)
  if (options.trim?.start !== undefined || options.trim?.end !== undefined) {
    const trimmedPath = await trimLocalFile(actualPath, options.trim);
    try { unlinkSync(actualPath); } catch {}
    actualPath = trimmedPath;
  }

  return { filePath: actualPath, sourceType, title, duration };
}

/**
 * Get audio file duration in seconds using ffprobe.
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ]);
  if (exitCode !== 0) throw new Error("ffprobe failed to get audio duration");
  const duration = parseFloat(stdout.trim());
  return isNaN(duration) ? 0 : duration;
}

/**
 * Split an audio file into chunks of `chunkDurationSec` seconds.
 * Returns array of temp file paths + their start offsets.
 */
export async function splitAudioIntoChunks(
  filePath: string,
  chunkDurationSec = 600 // 10 minutes default
): Promise<Array<{ path: string; startOffset: number }>> {
  const totalDuration = await getAudioDuration(filePath);
  if (totalDuration <= chunkDurationSec) {
    return [{ path: filePath, startOffset: 0 }];
  }

  const chunks: Array<{ path: string; startOffset: number }> = [];
  const ext = filePath.split(".").pop() ?? "mp3";
  let offset = 0;

  while (offset < totalDuration) {
    const chunkId = crypto.randomUUID();
    const chunkPath = join(tmpdir(), `transcriber-chunk-${chunkId}.${ext}`);
    const args = [
      "ffmpeg", "-y", "-i", filePath,
      "-ss", String(offset),
      "-t", String(chunkDurationSec),
      "-c", "copy", chunkPath,
    ];

    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`ffmpeg chunk split failed at ${offset}s: ${stderr.trim()}`);
    }

    chunks.push({ path: chunkPath, startOffset: offset });
    offset += chunkDurationSec;
  }

  return chunks;
}

/**
 * Raw comment from yt-dlp .info.json comments array.
 */
export interface RawComment {
  author: string | null;
  author_id: string | null;
  text: string;
  like_count: number;
  timestamp: number | null;
  parent: string | null; // "root" for top-level, comment id for replies
  id: string;
}

/**
 * Fetch comments for a video URL using yt-dlp --write-comments.
 * Downloads only the .info.json (no media) and parses the comments array.
 */
export async function fetchComments(url: string): Promise<RawComment[]> {
  const tempId = crypto.randomUUID();
  const outputTemplate = join(tmpdir(), `comments-${tempId}`);

  const proc = Bun.spawn(
    [ytdlp(), "--write-comments", "--skip-download", "--no-write-thumbnail", "-o", outputTemplate, url],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [exitCode, , stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`yt-dlp comment fetch failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  // yt-dlp writes <output>.info.json
  const infoPath = `${outputTemplate}.info.json`;
  const { readFileSync, unlinkSync: unlinkFile, existsSync: fileExists } = await import("node:fs");

  if (!fileExists(infoPath)) {
    throw new Error("yt-dlp did not produce an info.json file for comments");
  }

  try {
    const raw = JSON.parse(readFileSync(infoPath, "utf8"));
    const comments: RawComment[] = [];

    if (Array.isArray(raw.comments)) {
      for (const c of raw.comments) {
        comments.push({
          author: c.author ?? null,
          author_id: c.author_id ?? null,
          text: typeof c.text === "string" ? c.text : String(c.text ?? ""),
          like_count: typeof c.like_count === "number" ? c.like_count : 0,
          timestamp: typeof c.timestamp === "number" ? c.timestamp : null,
          parent: c.parent === "root" ? null : (c.parent ?? null),
          id: c.id ?? crypto.randomUUID(),
        });
      }
    }

    return comments;
  } finally {
    try { unlinkFile(infoPath); } catch {}
  }
}

/**
 * Check whether yt-dlp is available on the system.
 */
export async function checkYtDlp(): Promise<boolean> {
  try {
    const proc = Bun.spawn([ytdlp(), "--version"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}
