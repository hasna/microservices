import { Command } from "commander";
import {
  getPost,
  getAccount,
  type Platform,
} from "../../db/social.js";
import {
  generatePost as aiGeneratePost,
  suggestHashtags as aiSuggestHashtags,
  optimizePost as aiOptimizePost,
  generateThread as aiGenerateThread,
  repurposePost as aiRepurposePost,
  type Tone,
} from "../../lib/content-ai.js";

export function registerAiCommands(program: Command): void {
  const aiCmd = program
    .command("ai")
    .description("AI-powered content generation");

  aiCmd
    .command("generate")
    .description("Generate a post using AI")
    .requiredOption("--topic <topic>", "Topic to write about")
    .requiredOption("--platform <platform>", "Target platform (x/linkedin/instagram/threads/bluesky)")
    .option("--tone <tone>", "Tone: professional, casual, witty", "professional")
    .option("--no-hashtags", "Disable hashtags")
    .option("--emoji", "Include emojis", false)
    .option("--language <lang>", "Language", "English")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const result = await aiGeneratePost(opts.topic, opts.platform as Platform, {
          tone: opts.tone as Tone,
          includeHashtags: opts.hashtags,
          includeEmoji: opts.emoji,
          language: opts.language,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log("Generated Post:");
          console.log(`  ${result.content}`);
          if (result.hashtags.length) {
            console.log(`  Hashtags: ${result.hashtags.map((h: string) => "#" + h).join(" ")}`);
          }
          if (result.suggested_media_prompt) {
            console.log(`  Media prompt: ${result.suggested_media_prompt}`);
          }
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  aiCmd
    .command("suggest-hashtags")
    .description("Suggest hashtags for content")
    .requiredOption("--content <text>", "Post content to analyze")
    .requiredOption("--platform <platform>", "Target platform")
    .option("--count <n>", "Number of hashtags", "5")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const hashtags = await aiSuggestHashtags(opts.content, opts.platform as Platform, parseInt(opts.count));

        if (opts.json) {
          console.log(JSON.stringify({ hashtags }, null, 2));
        } else {
          console.log("Suggested Hashtags:");
          for (const h of hashtags) {
            console.log(`  #${h}`);
          }
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  aiCmd
    .command("optimize")
    .description("Optimize a post for better engagement")
    .argument("<post-id>", "Post ID to optimize")
    .option("--json", "Output as JSON", false)
    .action(async (postId, opts) => {
      try {
        const post = getPost(postId);
        if (!post) {
          console.error(`Post '${postId}' not found.`);
          process.exit(1);
        }

        const account = getAccount(post.account_id);
        if (!account) {
          console.error(`Account '${post.account_id}' not found.`);
          process.exit(1);
        }

        const result = await aiOptimizePost(post.content, account.platform);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log("Optimized Post:");
          console.log(`  ${result.optimized_content}`);
          if (result.improvements.length) {
            console.log("\nImprovements:");
            for (const imp of result.improvements) {
              console.log(`  - ${imp}`);
            }
          }
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  aiCmd
    .command("generate-thread")
    .description("Generate a multi-tweet thread using AI")
    .requiredOption("--topic <topic>", "Topic to write about")
    .option("--tweets <n>", "Number of tweets in thread", "5")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const tweets = await aiGenerateThread(opts.topic, parseInt(opts.tweets));

        if (opts.json) {
          console.log(JSON.stringify({ tweets }, null, 2));
        } else {
          console.log("Generated Thread:");
          for (let i = 0; i < tweets.length; i++) {
            console.log(`\n  [${i + 1}/${tweets.length}] ${tweets[i]}`);
          }
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  aiCmd
    .command("repurpose")
    .description("Repurpose a post for a different platform")
    .argument("<post-id>", "Post ID to repurpose")
    .requiredOption("--to <platform>", "Target platform (x/linkedin/instagram/threads/bluesky)")
    .option("--json", "Output as JSON", false)
    .action(async (postId, opts) => {
      try {
        const post = getPost(postId);
        if (!post) {
          console.error(`Post '${postId}' not found.`);
          process.exit(1);
        }

        const account = getAccount(post.account_id);
        if (!account) {
          console.error(`Account '${post.account_id}' not found.`);
          process.exit(1);
        }

        const result = await aiRepurposePost(post.content, account.platform, opts.to as Platform);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Repurposed for ${opts.to}:`);
          console.log(`  ${result.content}`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
