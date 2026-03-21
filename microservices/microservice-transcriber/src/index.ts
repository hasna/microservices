export {
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
  type SearchMatch,
  type Transcript,
  type TranscriptStatus,
  type TranscriptProvider,
  type TranscriptSourceType,
  type TranscriptMetadata,
  type TranscriptWord,
  type TranscriptSegment,
  type TranscriptSpeakerSegment,
  type TranscriptChapterSegment,
  type CreateTranscriptInput,
  type UpdateTranscriptInput,
  type ListTranscriptsOptions,
} from "./db/transcripts.js";

export { getDatabase, closeDatabase } from "./db/database.js";
export { createAnnotation, getAnnotation, listAnnotations, deleteAnnotation, type Annotation } from "./db/annotations.js";
export { prepareAudio, detectSourceType, getVideoInfo, downloadAudio, downloadVideo, createClip, getAudioOutputDir, normalizeFilename, getAudioDuration, splitAudioIntoChunks, isPlaylistUrl, getPlaylistUrls, checkYtDlp, type TrimOptions, type VideoInfo, type VideoChapter, type DownloadResult, type DownloadAudioOptions, type DownloadAudioResult } from "./lib/downloader.js";
export { transcribeFile, checkProviders, estimateCost, toSrt, toVtt, toAss, toMarkdown, segmentByChapters, formatWithConfidence, type AssStyle } from "./lib/providers.js";
export { getConfig, setConfig, resetConfig, CONFIG_DEFAULTS, CONFIG_KEYS, type TranscriberConfig, type ConfigKey } from "./lib/config.js";
export { summarizeText, extractHighlights, generateMeetingNotes, getDefaultSummaryProvider, type SummaryProvider, type Highlight } from "./lib/summarizer.js";
export { translateText } from "./lib/translator.js";
export { wordDiff, formatDiff, diffStats, type DiffEntry } from "./lib/diff.js";
export { fetchFeedEpisodes, type FeedEpisode, type Feed } from "./lib/feeds.js";
export { fireWebhook, type WebhookPayload } from "./lib/webhook.js";
export { pushToNotion } from "./lib/notion.js";
export { startLiveTranscription, type LiveTranscribeOptions } from "./lib/live.js";
