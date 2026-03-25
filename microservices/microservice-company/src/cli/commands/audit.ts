import { Command } from "commander";
import {
  logAction,
  searchAudit,
  getAuditStats,
  type AuditAction,
} from "../../lib/audit.js";

export function registerAuditCommands(program: Command): void {
  const auditCmd = program.command("audit").description("Audit log management");

  auditCmd
    .command("search")
    .description("Search audit log entries")
    .option("--org <id>", "Filter by organization")
    .option("--actor <actor>", "Filter by actor")
    .option("--service <service>", "Filter by service")
    .option("--action <action>", "Filter by action")
    .option("--entity-type <type>", "Filter by entity type")
    .option("--entity-id <id>", "Filter by entity ID")
    .option("--from <date>", "From date (ISO)")
    .option("--to <date>", "To date (ISO)")
    .option("--limit <n>", "Limit results")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const results = searchAudit({
        org_id: opts.org,
        actor: opts.actor,
        service: opts.service,
        action: opts.action as AuditAction | undefined,
        entity_type: opts.entityType,
        entity_id: opts.entityId,
        from: opts.from,
        to: opts.to,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log("No audit entries found.");
          return;
        }
        for (const e of results) {
          const svc = e.service ? ` [${e.service}]` : "";
          const entity = e.entity_type ? ` ${e.entity_type}:${e.entity_id}` : "";
          console.log(`  ${e.timestamp} ${e.actor} ${e.action}${svc}${entity}`);
        }
        console.log(`\n${results.length} entry/entries`);
      }
    });

  auditCmd
    .command("log")
    .description("Log an audit action")
    .requiredOption("--actor <actor>", "Actor name")
    .requiredOption("--action <action>", "Action (create/update/delete/execute/login/approve)")
    .option("--org <id>", "Organization ID")
    .option("--service <service>", "Service name")
    .option("--entity-type <type>", "Entity type")
    .option("--entity-id <id>", "Entity ID")
    .option("--details <json>", "Details JSON")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const entry = logAction({
        org_id: opts.org,
        actor: opts.actor,
        action: opts.action as AuditAction,
        service: opts.service,
        entity_type: opts.entityType,
        entity_id: opts.entityId,
        details: opts.details ? JSON.parse(opts.details) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        console.log(`Logged: ${entry.actor} ${entry.action} (${entry.id})`);
      }
    });

  auditCmd
    .command("stats")
    .description("Show audit statistics")
    .option("--org <id>", "Organization ID")
    .option("--from <date>", "From date (ISO)")
    .option("--to <date>", "To date (ISO)")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const stats = getAuditStats(opts.org, opts.from, opts.to);

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`Total entries: ${stats.total}`);
        console.log("\nBy actor:");
        for (const [actor, count] of Object.entries(stats.by_actor)) {
          console.log(`  ${actor}: ${count}`);
        }
        console.log("\nBy service:");
        for (const [service, count] of Object.entries(stats.by_service)) {
          console.log(`  ${service}: ${count}`);
        }
        console.log("\nBy action:");
        for (const [action, count] of Object.entries(stats.by_action)) {
          console.log(`  ${action}: ${count}`);
        }
      }
    });
}
