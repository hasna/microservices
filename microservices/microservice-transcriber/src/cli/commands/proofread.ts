import type { Command } from "commander";
import { proofreadTranscript, listIssues, applySuggestion, dismissIssue, getProofreadStats, exportAnnotated, type IssueType } from "../../lib/proofread.js";

export function registerProofreadCommands(program: Command): void {
  // ---------------------------------------------------------------------------
  // proofread
  // ---------------------------------------------------------------------------

  const proofreadCmd = program
    .command("proofread")
    .description("AI-powered spellcheck and proofreading for transcripts");

  proofreadCmd
    .command("run <transcript-id>")
    .description("Run AI proofreading on a transcript (non-destructive)")
    .option("--types <types>", "Comma-separated issue types: spelling,grammar,punctuation,clarity")
    .option("--confidence <n>", "Minimum confidence threshold 0-1 (default 0.7)", parseFloat)
    .option("--provider <provider>", "AI provider: openai or anthropic")
    .option("--json", "Output as JSON")
    .action(async (transcriptId: string, opts) => {
      const types = opts.types ? opts.types.split(",").map((t: string) => t.trim()) as IssueType[] : undefined;
      const confidence = opts.confidence ?? 0.7;

      if (!opts.json) console.log(`Proofreading transcript ${transcriptId}...`);

      try {
        const issues = await proofreadTranscript(transcriptId, { types, confidence_threshold: confidence, provider: opts.provider });

        if (opts.json) {
          console.log(JSON.stringify(issues, null, 2));
        } else {
          console.log(`Found ${issues.length} issue(s):\n`);
          for (const issue of issues) {
            console.log(`  [${issue.issue_type}] "${issue.original_text}" -> "${issue.suggestion ?? "(no suggestion)"}" (${((issue.confidence ?? 0) * 100).toFixed(0)}%)`);
            if (issue.explanation) console.log(`    ${issue.explanation}`);
          }
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  proofreadCmd
    .command("issues <transcript-id>")
    .description("List proofread issues for a transcript")
    .option("--type <type>", "Filter by issue type: spelling, grammar, punctuation, clarity")
    .option("--pending", "Show only pending issues")
    .option("--json", "Output as JSON")
    .action((transcriptId: string, opts) => {
      const filters: { issue_type?: IssueType; status?: "pending" } = {};
      if (opts.type) filters.issue_type = opts.type as IssueType;
      if (opts.pending) filters.status = "pending";

      const issues = listIssues(transcriptId, filters);

      if (opts.json) {
        console.log(JSON.stringify(issues, null, 2));
        return;
      }

      if (issues.length === 0) { console.log("No issues found."); return; }

      for (const issue of issues) {
        const conf = issue.confidence !== null ? ` ${(issue.confidence * 100).toFixed(0)}%` : "";
        console.log(`${issue.id.slice(0, 8)}  [${issue.status.padEnd(9)}] [${issue.issue_type.padEnd(11)}]${conf}  "${issue.original_text}" -> "${issue.suggestion ?? "-"}"`);
      }
    });

  proofreadCmd
    .command("apply <issue-id>")
    .description("Apply a proofread suggestion (modifies transcript text)")
    .option("--json", "Output as JSON")
    .action((issueId: string, opts) => {
      const updated = applySuggestion(issueId);
      if (!updated) { console.error(`Issue '${issueId}' not found.`); process.exit(1); }

      if (opts.json) {
        console.log(JSON.stringify(updated, null, 2));
      } else {
        console.log(`Applied: "${updated.original_text}" -> "${updated.suggestion}"`);
      }
    });

  proofreadCmd
    .command("dismiss <issue-id>")
    .description("Dismiss a proofread issue without changing text")
    .option("--json", "Output as JSON")
    .action((issueId: string, opts) => {
      const updated = dismissIssue(issueId);
      if (!updated) { console.error(`Issue '${issueId}' not found.`); process.exit(1); }

      if (opts.json) {
        console.log(JSON.stringify(updated, null, 2));
      } else {
        console.log(`Dismissed: "${updated.original_text}"`);
      }
    });

  proofreadCmd
    .command("export <transcript-id>")
    .description("Export transcript with inline proofread annotations")
    .action((transcriptId: string) => {
      try {
        const annotated = exportAnnotated(transcriptId);
        console.log(annotated);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  proofreadCmd
    .command("stats <transcript-id>")
    .description("Show proofread issue statistics")
    .option("--json", "Output as JSON")
    .action((transcriptId: string, opts) => {
      const stats = getProofreadStats(transcriptId);

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(`Total issues: ${stats.total}`);
      console.log(`Pending: ${stats.pending} | Applied: ${stats.applied} | Dismissed: ${stats.dismissed}`);
      if (Object.keys(stats.by_type).length > 0) {
        console.log("\nBy type:");
        for (const [type, count] of Object.entries(stats.by_type)) {
          console.log(`  ${type.padEnd(12)} ${count}`);
        }
      }
    });
}
