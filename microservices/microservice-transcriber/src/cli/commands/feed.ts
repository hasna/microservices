import type { Command } from "commander";
import { createTranscript, updateTranscript, findBySourceUrl, type TranscriptProvider } from "../../db/transcripts.js";
import { prepareAudio } from "../../lib/downloader.js";
import { transcribeFile } from "../../lib/providers.js";
import { getConfig, setConfig } from "../../lib/config.js";
import { fetchFeedEpisodes } from "../../lib/feeds.js";

export function registerFeedCommands(program: Command): void {
  // ---------------------------------------------------------------------------
  // feed
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
}
