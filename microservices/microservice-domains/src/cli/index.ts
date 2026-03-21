#!/usr/bin/env bun

import { Command } from "commander";
import {
  createDomain,
  getDomain,
  listDomains,
  updateDomain,
  deleteDomain,
  searchDomains,
  listExpiring,
  listSslExpiring,
  getDomainStats,
  getByRegistrar,
  createDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  deleteDnsRecord,
  createAlert,
  listAlerts,
  deleteAlert,
  whoisLookup,
  checkDnsPropagation,
  checkSsl,
  exportZoneFile,
  importZoneFile,
  discoverSubdomains,
  validateDns,
  exportPortfolio,
  checkAllDomains,
  getDomainByName,
} from "../db/domains.js";
import { readFileSync, writeFileSync } from "node:fs";

const program = new Command();

program
  .name("microservice-domains")
  .description("Domain portfolio and DNS management microservice")
  .version("0.0.1");

// --- Domains ---

program
  .command("add")
  .description("Add a new domain")
  .requiredOption("--name <name>", "Domain name (e.g. example.com)")
  .option("--registrar <registrar>", "Domain registrar")
  .option("--status <status>", "Status (active/expired/transferring/redemption)", "active")
  .option("--registered-at <date>", "Registration date (ISO)")
  .option("--expires-at <date>", "Expiration date (ISO)")
  .option("--no-auto-renew", "Disable auto-renew")
  .option("--nameservers <ns>", "Comma-separated nameservers")
  .option("--ssl-expires-at <date>", "SSL expiration date (ISO)")
  .option("--ssl-issuer <issuer>", "SSL certificate issuer")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const domain = createDomain({
      name: opts.name,
      registrar: opts.registrar,
      status: opts.status,
      registered_at: opts.registeredAt,
      expires_at: opts.expiresAt,
      auto_renew: opts.autoRenew,
      nameservers: opts.nameservers
        ? opts.nameservers.split(",").map((s: string) => s.trim())
        : undefined,
      ssl_expires_at: opts.sslExpiresAt,
      ssl_issuer: opts.sslIssuer,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(domain, null, 2));
    } else {
      console.log(`Created domain: ${domain.name} (${domain.id})`);
    }
  });

program
  .command("get")
  .description("Get a domain by ID")
  .argument("<id>", "Domain ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const domain = getDomain(id);
    if (!domain) {
      console.error(`Domain '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(domain, null, 2));
    } else {
      console.log(`${domain.name} [${domain.status}]`);
      if (domain.registrar) console.log(`  Registrar: ${domain.registrar}`);
      if (domain.expires_at) console.log(`  Expires: ${domain.expires_at}`);
      if (domain.ssl_expires_at) console.log(`  SSL Expires: ${domain.ssl_expires_at}`);
      if (domain.ssl_issuer) console.log(`  SSL Issuer: ${domain.ssl_issuer}`);
      console.log(`  Auto-renew: ${domain.auto_renew ? "yes" : "no"}`);
      if (domain.nameservers.length) console.log(`  Nameservers: ${domain.nameservers.join(", ")}`);
      if (domain.notes) console.log(`  Notes: ${domain.notes}`);
    }
  });

program
  .command("list")
  .description("List domains")
  .option("--search <query>", "Search by name, registrar, or notes")
  .option("--status <status>", "Filter by status")
  .option("--registrar <registrar>", "Filter by registrar")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const domains = listDomains({
      search: opts.search,
      status: opts.status,
      registrar: opts.registrar,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(domains, null, 2));
    } else {
      if (domains.length === 0) {
        console.log("No domains found.");
        return;
      }
      for (const d of domains) {
        const expires = d.expires_at ? ` (expires ${d.expires_at})` : "";
        console.log(`  ${d.name} [${d.status}]${expires}`);
      }
      console.log(`\n${domains.length} domain(s)`);
    }
  });

program
  .command("update")
  .description("Update a domain")
  .argument("<id>", "Domain ID")
  .option("--name <name>", "Domain name")
  .option("--registrar <registrar>", "Registrar")
  .option("--status <status>", "Status")
  .option("--registered-at <date>", "Registration date")
  .option("--expires-at <date>", "Expiration date")
  .option("--auto-renew <bool>", "Auto-renew (true/false)")
  .option("--nameservers <ns>", "Comma-separated nameservers")
  .option("--ssl-expires-at <date>", "SSL expiration date")
  .option("--ssl-issuer <issuer>", "SSL issuer")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.registrar !== undefined) input.registrar = opts.registrar;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.registeredAt !== undefined) input.registered_at = opts.registeredAt;
    if (opts.expiresAt !== undefined) input.expires_at = opts.expiresAt;
    if (opts.autoRenew !== undefined) input.auto_renew = opts.autoRenew === "true";
    if (opts.nameservers !== undefined)
      input.nameservers = opts.nameservers.split(",").map((s: string) => s.trim());
    if (opts.sslExpiresAt !== undefined) input.ssl_expires_at = opts.sslExpiresAt;
    if (opts.sslIssuer !== undefined) input.ssl_issuer = opts.sslIssuer;
    if (opts.notes !== undefined) input.notes = opts.notes;

    const domain = updateDomain(id, input);
    if (!domain) {
      console.error(`Domain '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(domain, null, 2));
    } else {
      console.log(`Updated: ${domain.name}`);
    }
  });

program
  .command("delete")
  .description("Delete a domain")
  .argument("<id>", "Domain ID")
  .action((id) => {
    const deleted = deleteDomain(id);
    if (deleted) {
      console.log(`Deleted domain ${id}`);
    } else {
      console.error(`Domain '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("search")
  .description("Search domains")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchDomains(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No domains matching "${query}".`);
        return;
      }
      for (const d of results) {
        console.log(`  ${d.name} [${d.status}]`);
      }
    }
  });

program
  .command("expiring")
  .description("List domains expiring within N days")
  .option("--days <n>", "Number of days ahead", "30")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const days = parseInt(opts.days);
    const domains = listExpiring(days);

    if (opts.json) {
      console.log(JSON.stringify(domains, null, 2));
    } else {
      if (domains.length === 0) {
        console.log(`No domains expiring within ${days} days.`);
        return;
      }
      console.log(`Domains expiring within ${days} days:`);
      for (const d of domains) {
        console.log(`  ${d.name} — expires ${d.expires_at}`);
      }
    }
  });

program
  .command("ssl")
  .description("List domains with SSL expiring within N days")
  .option("--days <n>", "Number of days ahead", "30")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const days = parseInt(opts.days);
    const domains = listSslExpiring(days);

    if (opts.json) {
      console.log(JSON.stringify(domains, null, 2));
    } else {
      if (domains.length === 0) {
        console.log(`No SSL certificates expiring within ${days} days.`);
        return;
      }
      console.log(`SSL certificates expiring within ${days} days:`);
      for (const d of domains) {
        console.log(`  ${d.name} — SSL expires ${d.ssl_expires_at} (${d.ssl_issuer || "unknown issuer"})`);
      }
    }
  });

program
  .command("stats")
  .description("Show domain portfolio statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getDomainStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log("Domain Portfolio Stats:");
      console.log(`  Total: ${stats.total}`);
      console.log(`  Active: ${stats.active}`);
      console.log(`  Expired: ${stats.expired}`);
      console.log(`  Transferring: ${stats.transferring}`);
      console.log(`  Redemption: ${stats.redemption}`);
      console.log(`  Auto-renew enabled: ${stats.auto_renew_enabled}`);
      console.log(`  Expiring (30 days): ${stats.expiring_30_days}`);
      console.log(`  SSL expiring (30 days): ${stats.ssl_expiring_30_days}`);
    }
  });

// --- WHOIS Lookup ---

program
  .command("whois")
  .description("Run WHOIS lookup for a domain and update DB record")
  .argument("<name>", "Domain name (e.g. example.com)")
  .option("--json", "Output as JSON", false)
  .action((name, opts) => {
    try {
      const result = whoisLookup(name);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`WHOIS for ${result.domain}:`);
        console.log(`  Registrar: ${result.registrar || "unknown"}`);
        console.log(`  Expires: ${result.expires_at || "unknown"}`);
        if (result.nameservers.length > 0) {
          console.log(`  Nameservers: ${result.nameservers.join(", ")}`);
        }
      }
    } catch (error: unknown) {
      console.error(`WHOIS lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// --- SSL Check ---

program
  .command("ssl-check")
  .description("Check SSL certificate for a domain and update DB record")
  .argument("<name>", "Domain name (e.g. example.com)")
  .option("--json", "Output as JSON", false)
  .action((name, opts) => {
    const result = checkSsl(name);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.error) {
        console.error(`SSL check failed: ${result.error}`);
        process.exit(1);
      }
      console.log(`SSL Certificate for ${result.domain}:`);
      console.log(`  Issuer: ${result.issuer || "unknown"}`);
      console.log(`  Expires: ${result.expires_at || "unknown"}`);
      if (result.subject) console.log(`  Subject: ${result.subject}`);
    }
  });

// --- Portfolio Export ---

program
  .command("export")
  .description("Export all domains as CSV or JSON")
  .option("--format <format>", "Export format (csv or json)", "json")
  .option("--output <file>", "Write to file instead of stdout")
  .action((opts) => {
    const format = opts.format === "csv" ? "csv" : "json";
    const output = exportPortfolio(format as "csv" | "json");
    if (opts.output) {
      writeFileSync(opts.output, output, "utf-8");
      console.log(`Exported to ${opts.output}`);
    } else {
      console.log(output);
    }
  });

// --- Bulk Domain Check ---

program
  .command("check-all")
  .description("Run WHOIS + SSL + DNS validation on all domains")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const results = checkAllDomains();
    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log("No domains to check.");
        return;
      }
      for (const r of results) {
        console.log(`\n${r.domain}:`);
        if (r.whois) {
          console.log(`  WHOIS: registrar=${r.whois.registrar || "?"}, expires=${r.whois.expires_at || "?"}`);
          if (r.whois.error) console.log(`    Error: ${r.whois.error}`);
        }
        if (r.ssl) {
          console.log(`  SSL: issuer=${r.ssl.issuer || "?"}, expires=${r.ssl.expires_at || "?"}`);
          if (r.ssl.error) console.log(`    Error: ${r.ssl.error}`);
        }
        if (r.dns_validation) {
          console.log(`  DNS: valid=${r.dns_validation.valid}, issues=${r.dns_validation.issue_count}`);
          for (const e of r.dns_validation.errors) {
            console.log(`    ${e}`);
          }
        }
      }
      console.log(`\nChecked ${results.length} domain(s)`);
    }
  });

// --- DNS Records ---

const dnsCmd = program
  .command("dns")
  .description("DNS record management");

dnsCmd
  .command("list")
  .description("List DNS records for a domain")
  .argument("<domain-id>", "Domain ID")
  .option("--type <type>", "Filter by record type (A/AAAA/CNAME/MX/TXT/NS/SRV)")
  .option("--json", "Output as JSON", false)
  .action((domainId, opts) => {
    const records = listDnsRecords(domainId, opts.type);

    if (opts.json) {
      console.log(JSON.stringify(records, null, 2));
    } else {
      if (records.length === 0) {
        console.log("No DNS records found.");
        return;
      }
      for (const r of records) {
        const priority = r.priority !== null ? ` (priority: ${r.priority})` : "";
        console.log(`  ${r.type}\t${r.name}\t${r.value}\tTTL:${r.ttl}${priority}`);
      }
    }
  });

dnsCmd
  .command("add")
  .description("Add a DNS record")
  .requiredOption("--domain <id>", "Domain ID")
  .requiredOption("--type <type>", "Record type (A/AAAA/CNAME/MX/TXT/NS/SRV)")
  .requiredOption("--name <name>", "Record name")
  .requiredOption("--value <value>", "Record value")
  .option("--ttl <ttl>", "TTL in seconds", "3600")
  .option("--priority <n>", "Priority (for MX/SRV)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const record = createDnsRecord({
      domain_id: opts.domain,
      type: opts.type,
      name: opts.name,
      value: opts.value,
      ttl: parseInt(opts.ttl),
      priority: opts.priority ? parseInt(opts.priority) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(record, null, 2));
    } else {
      console.log(`Created DNS record: ${record.type} ${record.name} -> ${record.value} (${record.id})`);
    }
  });

dnsCmd
  .command("update")
  .description("Update a DNS record")
  .argument("<id>", "Record ID")
  .option("--type <type>", "Record type")
  .option("--name <name>", "Record name")
  .option("--value <value>", "Record value")
  .option("--ttl <ttl>", "TTL in seconds")
  .option("--priority <n>", "Priority")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.type !== undefined) input.type = opts.type;
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.value !== undefined) input.value = opts.value;
    if (opts.ttl !== undefined) input.ttl = parseInt(opts.ttl);
    if (opts.priority !== undefined) input.priority = parseInt(opts.priority);

    const record = updateDnsRecord(id, input);
    if (!record) {
      console.error(`DNS record '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(record, null, 2));
    } else {
      console.log(`Updated DNS record: ${record.type} ${record.name} -> ${record.value}`);
    }
  });

dnsCmd
  .command("remove")
  .description("Remove a DNS record")
  .argument("<id>", "Record ID")
  .action((id) => {
    const deleted = deleteDnsRecord(id);
    if (deleted) {
      console.log(`Deleted DNS record ${id}`);
    } else {
      console.error(`DNS record '${id}' not found.`);
      process.exit(1);
    }
  });

// --- DNS Propagation Check ---

dnsCmd
  .command("check-propagation")
  .description("Check DNS propagation across multiple servers")
  .argument("<domain>", "Domain name to check")
  .option("--record <type>", "Record type (A/AAAA/CNAME/MX/TXT/NS)", "A")
  .option("--json", "Output as JSON", false)
  .action((domain, opts) => {
    const result = checkDnsPropagation(domain, opts.record);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`DNS Propagation for ${result.domain} (${result.record_type}):`);
      console.log(`  Consistent: ${result.consistent ? "yes" : "NO"}`);
      for (const s of result.servers) {
        const values = s.values.length > 0 ? s.values.join(", ") : "(empty)";
        const status = s.status === "error" ? ` [ERROR: ${s.error}]` : "";
        console.log(`  ${s.name} (${s.server}): ${values}${status}`);
      }
    }
  });

// --- Zone File Export ---

dnsCmd
  .command("export")
  .description("Export DNS records as BIND zone file")
  .argument("<domain-id>", "Domain ID")
  .option("--format <format>", "Export format (zone)", "zone")
  .option("--output <file>", "Write to file instead of stdout")
  .action((domainId, opts) => {
    const zone = exportZoneFile(domainId);
    if (!zone) {
      console.error(`Domain '${domainId}' not found.`);
      process.exit(1);
    }
    if (opts.output) {
      writeFileSync(opts.output, zone, "utf-8");
      console.log(`Exported zone file to ${opts.output}`);
    } else {
      console.log(zone);
    }
  });

// --- Zone File Import ---

dnsCmd
  .command("import")
  .description("Import DNS records from a BIND zone file")
  .argument("<domain-id>", "Domain ID")
  .requiredOption("--file <path>", "Path to zone file")
  .option("--json", "Output as JSON", false)
  .action((domainId, opts) => {
    let content: string;
    try {
      content = readFileSync(opts.file, "utf-8");
    } catch {
      console.error(`Could not read file: ${opts.file}`);
      process.exit(1);
    }

    const result = importZoneFile(domainId, content);
    if (!result) {
      console.error(`Domain '${domainId}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Imported ${result.imported} record(s), skipped ${result.skipped}`);
      if (result.errors.length > 0) {
        console.log("Errors:");
        for (const e of result.errors) {
          console.log(`  - ${e}`);
        }
      }
    }
  });

// --- Subdomain Discovery ---

dnsCmd
  .command("discover-subdomains")
  .description("Discover subdomains via certificate transparency logs (crt.sh)")
  .argument("<domain>", "Domain name")
  .option("--json", "Output as JSON", false)
  .action(async (domain, opts) => {
    const result = await discoverSubdomains(domain);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.error) {
        console.error(`Discovery failed: ${result.error}`);
        process.exit(1);
      }
      if (result.subdomains.length === 0) {
        console.log(`No subdomains found for ${domain}.`);
        return;
      }
      console.log(`Subdomains for ${domain} (source: ${result.source}):`);
      for (const s of result.subdomains) {
        console.log(`  ${s}`);
      }
      console.log(`\n${result.subdomains.length} subdomain(s) found`);
    }
  });

// --- DNS Validation ---

dnsCmd
  .command("validate")
  .description("Validate DNS records for common issues")
  .argument("<domain-id>", "Domain ID")
  .option("--json", "Output as JSON", false)
  .action((domainId, opts) => {
    const result = validateDns(domainId);
    if (!result) {
      console.error(`Domain '${domainId}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`DNS Validation for ${result.domain_name}:`);
      console.log(`  Valid: ${result.valid ? "yes" : "NO"}`);
      if (result.issues.length === 0) {
        console.log("  No issues found.");
      } else {
        for (const issue of result.issues) {
          const prefix = issue.type === "error" ? "ERROR" : "WARN";
          console.log(`  [${prefix}] ${issue.message}`);
        }
      }
    }
  });

// --- Alerts ---

const alertCmd = program
  .command("alert")
  .description("Alert management");

alertCmd
  .command("set")
  .description("Set an alert for a domain")
  .requiredOption("--domain <id>", "Domain ID")
  .requiredOption("--type <type>", "Alert type (expiry/ssl_expiry/dns_change)")
  .option("--days-before <n>", "Trigger N days before")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const alert = createAlert({
      domain_id: opts.domain,
      type: opts.type,
      trigger_days_before: opts.daysBefore ? parseInt(opts.daysBefore) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(alert, null, 2));
    } else {
      const daysBefore = alert.trigger_days_before ? ` (${alert.trigger_days_before} days before)` : "";
      console.log(`Created alert: ${alert.type}${daysBefore} for domain ${alert.domain_id} (${alert.id})`);
    }
  });

alertCmd
  .command("list")
  .description("List alerts for a domain")
  .argument("<domain-id>", "Domain ID")
  .option("--json", "Output as JSON", false)
  .action((domainId, opts) => {
    const alerts = listAlerts(domainId);

    if (opts.json) {
      console.log(JSON.stringify(alerts, null, 2));
    } else {
      if (alerts.length === 0) {
        console.log("No alerts set.");
        return;
      }
      for (const a of alerts) {
        const daysBefore = a.trigger_days_before ? ` (${a.trigger_days_before} days before)` : "";
        const sent = a.sent_at ? ` — sent ${a.sent_at}` : "";
        console.log(`  ${a.type}${daysBefore}${sent}`);
      }
    }
  });

alertCmd
  .command("remove")
  .description("Remove an alert")
  .argument("<id>", "Alert ID")
  .action((id) => {
    const deleted = deleteAlert(id);
    if (deleted) {
      console.log(`Deleted alert ${id}`);
    } else {
      console.error(`Alert '${id}' not found.`);
      process.exit(1);
    }
  });

program.parse(process.argv);
