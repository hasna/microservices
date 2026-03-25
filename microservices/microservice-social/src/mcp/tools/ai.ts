import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const PlatformEnum = z.enum(["x", "linkedin", "instagram", "threads", "bluesky"]);
const ToneEnum = z.enum(["professional", "casual", "witty"]);

export function registerAiTools(server: McpServer) {
  server.registerTool(
    "generate_post",
    {
      title: "Generate Post with AI",
      description: "Generate a social media post using AI. Provide a topic and platform; get back content, hashtags, and a suggested media prompt.",
      inputSchema: {
        topic: z.string(),
        platform: PlatformEnum,
        tone: ToneEnum.optional(),
        includeHashtags: z.boolean().optional(),
        includeEmoji: z.boolean().optional(),
        language: z.string().optional(),
      },
    },
    async ({ topic, platform, ...options }) => {
      try {
        const { generatePost } = await import("../../lib/content-ai.js");
        const result = await generatePost(topic, platform, options);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "suggest_hashtags",
    {
      title: "Suggest Hashtags",
      description: "Analyze post content and suggest relevant hashtags using AI.",
      inputSchema: {
        content: z.string(),
        platform: PlatformEnum,
        count: z.number().optional(),
      },
    },
    async ({ content, platform, count }) => {
      try {
        const { suggestHashtags } = await import("../../lib/content-ai.js");
        const hashtags = await suggestHashtags(content, platform, count || 5);
        return { content: [{ type: "text", text: JSON.stringify({ hashtags }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "optimize_post",
    {
      title: "Optimize Post",
      description: "Rewrite a post for better engagement using AI. Returns optimized content and a list of improvements.",
      inputSchema: {
        content: z.string(),
        platform: PlatformEnum,
      },
    },
    async ({ content, platform }) => {
      try {
        const { optimizePost } = await import("../../lib/content-ai.js");
        const result = await optimizePost(content, platform);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "generate_thread",
    {
      title: "Generate Thread",
      description: "Generate a multi-tweet thread using AI. Each tweet stays within 280 chars.",
      inputSchema: {
        topic: z.string(),
        tweet_count: z.number().optional(),
      },
    },
    async ({ topic, tweet_count }) => {
      try {
        const { generateThread } = await import("../../lib/content-ai.js");
        const tweets = await generateThread(topic, tweet_count || 5);
        return { content: [{ type: "text", text: JSON.stringify({ tweets, count: tweets.length }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "repurpose_post",
    {
      title: "Repurpose Post",
      description: "Adapt a post from one platform's style to another using AI (e.g., X to LinkedIn).",
      inputSchema: {
        content: z.string(),
        source_platform: PlatformEnum,
        target_platform: PlatformEnum,
      },
    },
    async ({ content, source_platform, target_platform }) => {
      try {
        const { repurposePost } = await import("../../lib/content-ai.js");
        const result = await repurposePost(content, source_platform, target_platform);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "sync_followers",
    {
      title: "Sync Followers",
      description: "Sync followers from the platform API for an account. Returns sync results including new and unfollowed counts.",
      inputSchema: {
        account_id: z.string(),
      },
    },
    async ({ account_id }) => {
      try {
        const { syncFollowers } = await import("../../lib/audience.js");
        const result = syncFollowers(account_id);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "audience_insights",
    {
      title: "Audience Insights",
      description: "Get audience insights for an account: total followers, growth rates, new/lost followers, and top followers.",
      inputSchema: {
        account_id: z.string(),
      },
    },
    async ({ account_id }) => {
      try {
        const { getAudienceInsights } = await import("../../lib/audience.js");
        const insights = getAudienceInsights(account_id);
        return { content: [{ type: "text", text: JSON.stringify(insights, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "follower_growth",
    {
      title: "Follower Growth Chart",
      description: "Get follower growth data points over a number of days for charting.",
      inputSchema: {
        account_id: z.string(),
        days: z.number().optional(),
      },
    },
    async ({ account_id, days }) => {
      try {
        const { getFollowerGrowthChart } = await import("../../lib/audience.js");
        const chart = getFollowerGrowthChart(account_id, days || 30);
        return { content: [{ type: "text", text: JSON.stringify(chart, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "top_followers",
    {
      title: "Top Followers",
      description: "Get top followers for an account, sorted by their follower count (most influential first).",
      inputSchema: {
        account_id: z.string(),
        limit: z.number().optional(),
      },
    },
    async ({ account_id, limit }) => {
      try {
        const { getTopFollowers } = await import("../../lib/audience.js");
        const followers = getTopFollowers(account_id, limit || 10);
        return { content: [{ type: "text", text: JSON.stringify({ followers, count: followers.length }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "analyze_sentiment",
    {
      title: "Analyze Sentiment",
      description: "Analyze the sentiment of a text using AI. Returns sentiment label (positive/neutral/negative), score (0-1), and emotional keywords.",
      inputSchema: {
        text: z.string().describe("The text to analyze for sentiment"),
      },
    },
    async ({ text }) => {
      try {
        const { analyzeSentiment } = await import("../../lib/sentiment.js");
        const result = await analyzeSentiment(text);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "sentiment_report",
    {
      title: "Sentiment Report",
      description: "Get an aggregated sentiment report for an account's mentions. Shows positive/neutral/negative percentages, trending keywords, and most positive/negative mentions.",
      inputSchema: {
        account_id: z.string(),
        days: z.number().optional().describe("Number of days to look back (default: all time)"),
      },
    },
    async ({ account_id, days }) => {
      try {
        const { getSentimentReport } = await import("../../lib/sentiment.js");
        const report = getSentimentReport(account_id, days);
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "auto_analyze_mention",
    {
      title: "Auto-Analyze Mention Sentiment",
      description: "Analyze a mention's content for sentiment and store the result in the mention record. Returns the sentiment analysis result.",
      inputSchema: {
        mention_id: z.string(),
      },
    },
    async ({ mention_id }) => {
      try {
        const { autoAnalyzeMention } = await import("../../lib/sentiment.js");
        const result = await autoAnalyzeMention(mention_id);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );
}
