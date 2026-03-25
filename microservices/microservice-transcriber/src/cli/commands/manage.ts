import type { Command } from "commander";
import {
  getTranscript,
  updateTranscript,
  deleteTranscript,
  listTranscripts,
  searchTranscripts,
  countTranscripts,
  renameSpeakers,
  addTags,
  removeTags,
  getTags,
  listAllTags,
  listTranscriptsByTag,
  searchWithContext,
  type TranscriptProvider,
  type TranscriptStatus,
  type TranscriptSourceType,
} from "../../db/transcripts.js";
import { checkProviders, formatWithConfidence } from "../../lib/providers.js";
import { listAnnotations, formatTimestamp as fmtAnnoTs } from "../../db/annotations.js";
import { wordDiff, formatDiff, diffStats } from "../../lib/diff.js";

export function registerManageCommands(program: Command): void {
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
  // tag / tags
  // ---------------------------------------------------------------------------

  program
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
}
