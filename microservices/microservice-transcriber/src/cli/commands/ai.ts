import type { Command } from "commander";
import { getTranscript, updateTranscript, createTranscript } from "../../db/transcripts.js";
import { summarizeText, extractHighlights, generateMeetingNotes, getDefaultSummaryProvider } from "../../lib/summarizer.js";
import { translateText } from "../../lib/translator.js";

export function registerAiCommands(program: Command): void {
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
        updateTranscript(id, {
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
}
