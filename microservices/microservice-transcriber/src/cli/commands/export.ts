import type { Command } from "commander";
import { writeFileSync } from "node:fs";
import { getTranscript } from "../../db/transcripts.js";
import { toSrt, toVtt, toAss, toMarkdown, formatWithConfidence } from "../../lib/providers.js";
import { pushToNotion } from "../../lib/notion.js";

export function registerExportCommands(program: Command): void {
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
}
