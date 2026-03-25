import type { Command } from "commander";
import { createAnnotation, listAnnotations, deleteAnnotation, formatTimestamp as fmtAnnoTs } from "../../db/annotations.js";
import { listComments, searchComments, getCommentStats } from "../../db/comments.js";

export function registerAnnotateCommands(program: Command): void {
  // ---------------------------------------------------------------------------
  // annotate
  // ---------------------------------------------------------------------------

  const annoCmd = program
    .command("annotate")
    .description("Manage timestamped annotations/bookmarks on transcripts");

  annoCmd
    .command("add <transcript-id>")
    .description("Add an annotation at a timestamp")
    .requiredOption("--at <seconds>", "Timestamp in seconds", parseFloat)
    .requiredOption("--note <text>", "Annotation note")
    .option("--json", "Output as JSON")
    .action((transcriptId: string, opts) => {
      const anno = createAnnotation(transcriptId, opts.at, opts.note);
      if (opts.json) { console.log(JSON.stringify(anno, null, 2)); }
      else { console.log(`Added annotation at ${fmtAnnoTs(opts.at)}: ${opts.note} (${anno.id.slice(0, 8)})`); }
    });

  annoCmd
    .command("list <transcript-id>")
    .description("List all annotations for a transcript")
    .option("--json", "Output as JSON")
    .action((transcriptId: string, opts) => {
      const annos = listAnnotations(transcriptId);
      if (opts.json) { console.log(JSON.stringify(annos, null, 2)); return; }
      if (annos.length === 0) { console.log("No annotations."); return; }
      for (const a of annos) {
        console.log(`  [${fmtAnnoTs(a.timestamp_sec)}] ${a.note} (${a.id.slice(0, 8)})`);
      }
    });

  annoCmd
    .command("remove <id>")
    .description("Delete an annotation by ID")
    .action((id: string) => {
      if (deleteAnnotation(id)) console.log(`Deleted annotation ${id}.`);
      else { console.error("Annotation not found."); process.exit(1); }
    });

  // ---------------------------------------------------------------------------
  // comments
  // ---------------------------------------------------------------------------

  const commentsCmd = program
    .command("comments")
    .description("Manage video comments extracted from YouTube/Vimeo");

  commentsCmd
    .command("list <transcript-id>")
    .description("List comments for a transcript")
    .option("--top", "Sort by most liked")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action((transcriptId: string, opts) => {
      const comments = listComments(transcriptId, {
        limit: parseInt(opts.limit),
        top: opts.top,
      });

      if (opts.json) {
        console.log(JSON.stringify(comments, null, 2));
        return;
      }

      if (comments.length === 0) {
        console.log("No comments found.");
        return;
      }

      for (const c of comments) {
        const likesStr = c.likes > 0 ? ` [${c.likes} likes]` : "";
        const replyStr = c.is_reply ? " (reply)" : "";
        console.log(`${c.author ?? "Anonymous"}${replyStr}${likesStr}`);
        console.log(`  ${c.comment_text.slice(0, 200)}${c.comment_text.length > 200 ? "..." : ""}`);
        console.log();
      }
    });

  commentsCmd
    .command("search <query>")
    .description("Search comment text across all transcripts")
    .option("--json", "Output as JSON")
    .action((query: string, opts) => {
      const results = searchComments(query);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`No comments matching '${query}'.`);
        return;
      }

      console.log(`Found ${results.length} comment(s):\n`);
      for (const c of results) {
        const likesStr = c.likes > 0 ? ` [${c.likes} likes]` : "";
        console.log(`${c.author ?? "Anonymous"}${likesStr} (transcript: ${c.transcript_id.slice(0, 8)})`);
        console.log(`  ${c.comment_text.slice(0, 200)}${c.comment_text.length > 200 ? "..." : ""}`);
        console.log();
      }
    });

  commentsCmd
    .command("stats <transcript-id>")
    .description("Show comment statistics for a transcript")
    .option("--json", "Output as JSON")
    .action((transcriptId: string, opts) => {
      const stats = getCommentStats(transcriptId);

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(`Total comments:  ${stats.total}`);
      console.log(`Replies:         ${stats.replies}`);
      console.log(`Unique authors:  ${stats.unique_authors}`);
      console.log(`Avg likes:       ${stats.avg_likes}`);
      if (stats.top_commenter) {
        console.log(`Top commenter:   ${stats.top_commenter}`);
      }
    });
}
