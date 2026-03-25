import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTranscript,
  getTranscript,
  updateTranscript,
} from "../../db/transcripts.js";
import { summarizeText, extractHighlights, generateMeetingNotes, getDefaultSummaryProvider } from "../../lib/summarizer.js";
import { translateText } from "../../lib/translator.js";

export function registerAiTools(server: McpServer) {
  // ---------------------------------------------------------------------------
  // translate_transcript
  // ---------------------------------------------------------------------------

  server.registerTool(
    "translate_transcript",
    {
      title: "Translate Transcript",
      description: "Translate a completed transcript to another language. Creates a new linked transcript record with source_transcript_id pointing to the original.",
      inputSchema: {
        id: z.string().describe("Source transcript ID"),
        to: z.string().describe("Target language code or name (e.g. 'fr', 'de', 'Spanish')"),
        provider: z.enum(["openai", "anthropic"]).optional().describe("AI provider (auto-detected from env)"),
      },
    },
    async ({ id, to, provider }) => {
      const t = getTranscript(id);
      if (!t) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
      if (t.status !== "completed" || !t.transcript_text) {
        return { content: [{ type: "text", text: `Transcript '${id}' is not completed.` }], isError: true };
      }

      const resolved = provider ?? getDefaultSummaryProvider();
      if (!resolved) {
        return { content: [{ type: "text", text: "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY." }], isError: true };
      }

      try {
        const translatedText = await translateText(t.transcript_text, to, resolved);

        const newRecord = createTranscript({
          source_url: t.source_url ?? `translated:${id}`,
          source_type: "translated",
          provider: t.provider,
          language: to,
          title: t.title ? `${t.title} [${to}]` : null,
          source_transcript_id: id,
        });

        updateTranscript(newRecord.id, {
          status: "completed",
          transcript_text: translatedText,
          word_count: translatedText.split(/\s+/).filter(Boolean).length,
          metadata: { model: resolved },
        });

        return { content: [{ type: "text", text: JSON.stringify(getTranscript(newRecord.id), null, 2) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Translation failed: ${msg}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // summarize_transcript
  // ---------------------------------------------------------------------------

  server.registerTool(
    "summarize_transcript",
    {
      title: "Summarize Transcript",
      description: "Generate a 3-5 sentence AI summary of a completed transcript. Stores summary in metadata.summary. Uses OpenAI gpt-4o-mini or Anthropic claude-haiku.",
      inputSchema: {
        id: z.string().describe("Transcript ID"),
        provider: z.enum(["openai", "anthropic"]).optional().describe("AI provider (auto-detected from env if omitted)"),
      },
    },
    async ({ id, provider }) => {
      const t = getTranscript(id);
      if (!t) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
      if (t.status !== "completed" || !t.transcript_text) {
        return { content: [{ type: "text", text: `Transcript '${id}' is not completed.` }], isError: true };
      }

      const resolved = provider ?? getDefaultSummaryProvider();
      if (!resolved) {
        return { content: [{ type: "text", text: "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY." }], isError: true };
      }

      try {
        const summary = await summarizeText(t.transcript_text, resolved);
        updateTranscript(id, { metadata: { ...t.metadata, summary } });
        return { content: [{ type: "text", text: JSON.stringify({ id, summary }, null, 2) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Summarization failed: ${msg}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // meeting_notes
  // ---------------------------------------------------------------------------

  server.registerTool(
    "meeting_notes",
    {
      title: "Generate Meeting Notes",
      description: "Restructure a transcript into formatted meeting notes: attendees, agenda, key decisions, action items, summary.",
      inputSchema: {
        id: z.string().describe("Transcript ID"),
        provider: z.enum(["openai", "anthropic"]).optional(),
      },
    },
    async ({ id, provider }) => {
      const t = getTranscript(id);
      if (!t) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
      if (t.status !== "completed" || !t.transcript_text) {
        return { content: [{ type: "text", text: `Transcript '${id}' is not completed.` }], isError: true };
      }
      const resolved = provider ?? getDefaultSummaryProvider();
      if (!resolved) return { content: [{ type: "text", text: "No AI provider configured." }], isError: true };
      try {
        const notes = await generateMeetingNotes(t.transcript_text, resolved);
        updateTranscript(id, { metadata: { ...t.metadata, meeting_notes: notes } });
        return { content: [{ type: "text", text: notes }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Failed: ${error instanceof Error ? error.message : error}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // highlights_transcript
  // ---------------------------------------------------------------------------

  server.registerTool(
    "highlights_transcript",
    {
      title: "Extract Highlights",
      description: "Extract 5-10 key moments/quotes from a completed transcript using AI.",
      inputSchema: {
        id: z.string().describe("Transcript ID"),
        provider: z.enum(["openai", "anthropic"]).optional(),
      },
    },
    async ({ id, provider }) => {
      const t = getTranscript(id);
      if (!t) return { content: [{ type: "text", text: `Transcript '${id}' not found.` }], isError: true };
      if (t.status !== "completed" || !t.transcript_text) {
        return { content: [{ type: "text", text: `Transcript '${id}' is not completed.` }], isError: true };
      }

      const resolved = provider ?? getDefaultSummaryProvider();
      if (!resolved) return { content: [{ type: "text", text: "No AI provider configured." }], isError: true };

      try {
        const highlights = await extractHighlights(t.transcript_text, resolved);
        updateTranscript(id, { metadata: { ...t.metadata, highlights } });
        return { content: [{ type: "text", text: JSON.stringify({ id, highlights }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Highlights extraction failed: ${error instanceof Error ? error.message : error}` }], isError: true };
      }
    }
  );
}
