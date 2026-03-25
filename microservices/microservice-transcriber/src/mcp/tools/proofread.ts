import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proofreadTranscript, listIssues, applySuggestion, dismissIssue, getProofreadStats, exportAnnotated, type IssueType } from "../../lib/proofread.js";

export function registerProofreadTools(server: McpServer) {
  // ---------------------------------------------------------------------------
  // proofread_transcript
  // ---------------------------------------------------------------------------

  server.registerTool(
    "proofread_transcript",
    {
      title: "Proofread Transcript",
      description: "Run AI-powered spellcheck/proofread on a transcript. Finds spelling, grammar, punctuation, and clarity issues. Non-destructive: stores issues in DB without modifying transcript text.",
      inputSchema: {
        id: z.string().describe("Transcript ID"),
        types: z.array(z.enum(["spelling", "grammar", "punctuation", "clarity"])).optional().describe("Issue types to check (default: all)"),
        confidence_threshold: z.number().optional().describe("Minimum confidence 0-1 (default: 0.7)"),
        provider: z.enum(["openai", "anthropic"]).optional().describe("AI provider (auto-detected from env)"),
      },
    },
    async ({ id, types, confidence_threshold, provider }) => {
      try {
        const issues = await proofreadTranscript(id, {
          types: types as IssueType[] | undefined,
          confidence_threshold,
          provider: provider as "openai" | "anthropic" | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(issues, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Proofread failed: ${error instanceof Error ? error.message : error}` }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // list_proofread_issues
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_proofread_issues",
    {
      title: "List Proofread Issues",
      description: "List proofread issues for a transcript with optional filters.",
      inputSchema: {
        transcript_id: z.string().describe("Transcript ID"),
        issue_type: z.enum(["spelling", "grammar", "punctuation", "clarity"]).optional().describe("Filter by issue type"),
        status: z.enum(["pending", "applied", "dismissed"]).optional().describe("Filter by status"),
      },
    },
    async ({ transcript_id, issue_type, status }) => {
      const issues = listIssues(transcript_id, {
        issue_type: issue_type as IssueType | undefined,
        status: status as "pending" | "applied" | "dismissed" | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(issues, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // apply_suggestion
  // ---------------------------------------------------------------------------

  server.registerTool(
    "apply_suggestion",
    {
      title: "Apply Proofread Suggestion",
      description: "Apply a proofread suggestion to the transcript text. Replaces the original text with the suggestion and marks the issue as applied.",
      inputSchema: {
        issue_id: z.string().describe("Proofread issue ID"),
      },
    },
    async ({ issue_id }) => {
      const result = applySuggestion(issue_id);
      if (!result) return { content: [{ type: "text", text: `Issue '${issue_id}' not found.` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // dismiss_issue
  // ---------------------------------------------------------------------------

  server.registerTool(
    "dismiss_issue",
    {
      title: "Dismiss Proofread Issue",
      description: "Dismiss a proofread issue without modifying the transcript text.",
      inputSchema: {
        issue_id: z.string().describe("Proofread issue ID"),
      },
    },
    async ({ issue_id }) => {
      const result = dismissIssue(issue_id);
      if (!result) return { content: [{ type: "text", text: `Issue '${issue_id}' not found.` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // proofread_stats
  // ---------------------------------------------------------------------------

  server.registerTool(
    "proofread_stats",
    {
      title: "Proofread Stats",
      description: "Get proofread issue statistics for a transcript: total, by type, pending/applied/dismissed counts.",
      inputSchema: {
        transcript_id: z.string().describe("Transcript ID"),
      },
    },
    async ({ transcript_id }) => {
      const stats = getProofreadStats(transcript_id);
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // export_annotated
  // ---------------------------------------------------------------------------

  server.registerTool(
    "export_annotated",
    {
      title: "Export Annotated Transcript",
      description: "Export transcript text with inline proofread annotations showing pending issues as [TYPE: \"original\" -> \"suggestion\"] markers.",
      inputSchema: {
        transcript_id: z.string().describe("Transcript ID"),
      },
    },
    async ({ transcript_id }) => {
      try {
        const text = exportAnnotated(transcript_id);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Export failed: ${error instanceof Error ? error.message : error}` }], isError: true };
      }
    }
  );
}
