/**
 * Notion export — pushes a transcript to a Notion page as blocks.
 * Uses the Notion API directly (no SDK dependency needed).
 * Requires NOTION_API_KEY and a target page/database ID.
 */

import type { Transcript } from "../db/transcripts.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function getNotionHeaders(): Record<string, string> {
  const key = process.env["NOTION_API_KEY"];
  if (!key) throw new Error("NOTION_API_KEY is not set. Create an integration at https://www.notion.so/my-integrations");
  return {
    Authorization: `Bearer ${key}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/**
 * Create a new Notion page under a parent page with the transcript content.
 */
export async function pushToNotion(
  transcript: Transcript,
  parentPageId: string
): Promise<{ pageId: string; url: string }> {
  const blocks = buildNotionBlocks(transcript);

  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: getNotionHeaders(),
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ text: { content: transcript.title ?? "Transcript" } }],
        },
      },
      children: blocks.slice(0, 100), // Notion limit: 100 blocks per request
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { id: string; url: string };

  // Append remaining blocks if >100
  if (blocks.length > 100) {
    for (let i = 100; i < blocks.length; i += 100) {
      await fetch(`${NOTION_API}/blocks/${data.id}/children`, {
        method: "PATCH",
        headers: getNotionHeaders(),
        body: JSON.stringify({ children: blocks.slice(i, i + 100) }),
      });
    }
  }

  return { pageId: data.id, url: data.url };
}

function buildNotionBlocks(t: Transcript): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];

  // Metadata callout
  const meta = [
    t.provider && `Provider: ${t.provider}`,
    t.duration_seconds && `Duration: ${Math.floor(t.duration_seconds / 60)}m ${Math.floor(t.duration_seconds % 60)}s`,
    t.word_count && `Words: ${t.word_count}`,
    t.source_url && `Source: ${t.source_url}`,
  ].filter(Boolean).join(" | ");

  if (meta) {
    blocks.push({
      object: "block",
      type: "callout",
      callout: {
        icon: { emoji: "🎙️" },
        rich_text: [{ type: "text", text: { content: meta } }],
      },
    });
  }

  // Summary
  if (t.metadata?.summary) {
    blocks.push(heading("Summary", 2));
    blocks.push(paragraph(t.metadata.summary));
  }

  // Chapters or plain text
  if (t.metadata?.chapters && t.metadata.chapters.length > 0) {
    for (const ch of t.metadata.chapters) {
      blocks.push(heading(ch.title, 2));
      // Split long text into 2000-char chunks (Notion block text limit)
      for (const chunk of splitText(ch.text, 2000)) {
        blocks.push(paragraph(chunk));
      }
    }
  } else if (t.transcript_text) {
    blocks.push(heading("Transcript", 2));
    for (const chunk of splitText(t.transcript_text, 2000)) {
      blocks.push(paragraph(chunk));
    }
  }

  return blocks;
}

function heading(text: string, level: 2 | 3): Record<string, unknown> {
  const key = `heading_${level}`;
  return { object: "block", type: key, [key]: { rich_text: [{ type: "text", text: { content: text } }] } };
}

function paragraph(text: string): Record<string, unknown> {
  return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text } }] } };
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}
