import { Command } from "commander";
import {
  createAccount,
  listAccounts,
  deleteAccount,
  getCalendar,
  type Platform,
} from "../../db/social.js";

export function registerAccountCommands(program: Command): void {
  const accountCmd = program
    .command("account")
    .description("Account management");

  accountCmd
    .command("add")
    .description("Add a social media account")
    .requiredOption("--platform <platform>", "Platform (x/linkedin/instagram/threads/bluesky)")
    .requiredOption("--handle <handle>", "Account handle")
    .option("--display-name <name>", "Display name")
    .option("--connected", "Mark as connected", false)
    .option("--token-env <var>", "Environment variable for access token")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const account = createAccount({
        platform: opts.platform as Platform,
        handle: opts.handle,
        display_name: opts.displayName,
        connected: opts.connected,
        access_token_env: opts.tokenEnv,
      });

      if (opts.json) {
        console.log(JSON.stringify(account, null, 2));
      } else {
        console.log(`Added account: @${account.handle} on ${account.platform} (${account.id})`);
      }
    });

  accountCmd
    .command("list")
    .description("List accounts")
    .option("--platform <platform>", "Filter by platform")
    .option("--connected", "Show only connected accounts")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const accounts = listAccounts({
        platform: opts.platform as Platform | undefined,
        connected: opts.connected ? true : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(accounts, null, 2));
      } else {
        if (accounts.length === 0) {
          console.log("No accounts found.");
          return;
        }
        for (const a of accounts) {
          const connected = a.connected ? " (connected)" : "";
          const name = a.display_name ? ` - ${a.display_name}` : "";
          console.log(`  [${a.platform}] @${a.handle}${name}${connected}`);
        }
        console.log(`\n${accounts.length} account(s)`);
      }
    });

  accountCmd
    .command("remove")
    .description("Remove an account")
    .argument("<id>", "Account ID")
    .action((id) => {
      const deleted = deleteAccount(id);
      if (deleted) {
        console.log(`Removed account ${id}`);
      } else {
        console.error(`Account '${id}' not found.`);
        process.exit(1);
      }
    });

  // Calendar command registered under accounts module (related to account/post scheduling)
  program
    .command("calendar")
    .description("View scheduled posts by date")
    .option("--start <date>", "Start date (YYYY-MM-DD)")
    .option("--end <date>", "End date (YYYY-MM-DD)")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const calendar = getCalendar(opts.start, opts.end);

      if (opts.json) {
        console.log(JSON.stringify(calendar, null, 2));
      } else {
        const dates = Object.keys(calendar).sort();
        if (dates.length === 0) {
          console.log("No scheduled posts.");
          return;
        }
        for (const date of dates) {
          console.log(`\n${date}:`);
          for (const post of calendar[date]) {
            const preview = post.content.substring(0, 50) + (post.content.length > 50 ? "..." : "");
            console.log(`  ${post.scheduled_at} — ${preview}`);
          }
        }
      }
    });
}
