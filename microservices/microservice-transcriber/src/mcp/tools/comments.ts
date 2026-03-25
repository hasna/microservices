import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findBySourceUrl } from "../../db/transcripts.js";
import { listComments, getTopComments, searchComments, getCommentStats } from "../../db/comments.js";
import { getConfig, setConfig } from "../../lib/config.js";
import { fetchFeedEpisodes } from "../../lib/feeds.js";

export function registerCommentsTools(server: McpServer) {
  // ---------------------------------------------------------------------------
  // check_feeds
  // ---------------------------------------------------------------------------

  server.registerTool(
    "check_feeds",
    {
      title: "Check Podcast Feeds",
      description: "Check all registered RSS feeds for new episodes. Returns new episode URLs. Use with batch_transcribe to transcribe them.",
      inputSchema: {},
    },
    async () => {
      const cfg = getConfig();
      if (cfg.feeds.length === 0) return { content: [{ type: "text", text: "No feeds configured." }] };

      const allNew: Array<{ feed: string; episodes: Array<{ url: string; title: string | null }> }> = [];
      for (const feed of cfg.feeds) {
        try {
          const { episodes } = await fetchFeedEpisodes(feed.url);
          const newEps = episodes.filter((ep) => !findBySourceUrl(ep.url));
          if (newEps.length > 0) allNew.push({ feed: feed.title ?? feed.url, episodes: newEps.map((e) => ({ url: e.url, title: e.title })) });
          feed.lastChecked = new Date().toISOString();
        } catch {}
      }
      setConfig({ feeds: cfg.feeds });
      return { content: [{ type: "text", text: JSON.stringify(allNew, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // list_comments
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_comments",
    {
      title: "List Comments",
      description: "List comments for a transcript, optionally sorted by likes.",
      inputSchema: {
        transcript_id: z.string().describe("Transcript ID"),
        top: z.boolean().optional().describe("Sort by most liked"),
        limit: z.number().optional().describe("Max results (default 50)"),
        offset: z.number().optional().describe("Offset for pagination"),
      },
    },
    async ({ transcript_id, top, limit, offset }) => {
      const comments = listComments(transcript_id, { top, limit, offset });
      return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // top_comments
  // ---------------------------------------------------------------------------

  server.registerTool(
    "top_comments",
    {
      title: "Top Comments",
      description: "Get the most liked comments for a transcript.",
      inputSchema: {
        transcript_id: z.string().describe("Transcript ID"),
        limit: z.number().optional().describe("Number of top comments (default 10)"),
      },
    },
    async ({ transcript_id, limit }) => {
      const comments = getTopComments(transcript_id, limit);
      return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // search_comments
  // ---------------------------------------------------------------------------

  server.registerTool(
    "search_comments",
    {
      title: "Search Comments",
      description: "Search comment text across all transcripts using LIKE matching.",
      inputSchema: {
        query: z.string().describe("Search query"),
      },
    },
    async ({ query }) => {
      const results = searchComments(query);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // comment_stats
  // ---------------------------------------------------------------------------

  server.registerTool(
    "comment_stats",
    {
      title: "Comment Stats",
      description: "Get comment statistics for a transcript: total, replies, unique authors, avg likes, top commenter.",
      inputSchema: {
        transcript_id: z.string().describe("Transcript ID"),
      },
    },
    async ({ transcript_id }) => {
      const stats = getCommentStats(transcript_id);
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    }
  );
}
