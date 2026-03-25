import { Command } from "commander";
import {
  addMember,
  getMember,
  listMembers,
  updateMember,
  removeMember,
} from "../../db/company.js";

export function registerMemberCommands(program: Command): void {
  const memberCmd = program.command("member").description("Member management");

  memberCmd
    .command("add")
    .description("Add a member")
    .requiredOption("--org <id>", "Organization ID")
    .requiredOption("--name <name>", "Member name")
    .option("--team <id>", "Team ID")
    .option("--email <email>", "Email")
    .option("--role <role>", "Role (owner/admin/manager/member/viewer)", "member")
    .option("--title <title>", "Job title")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const member = addMember({
        org_id: opts.org,
        team_id: opts.team,
        name: opts.name,
        email: opts.email,
        role: opts.role,
        title: opts.title,
      });

      if (opts.json) {
        console.log(JSON.stringify(member, null, 2));
      } else {
        console.log(`Added member: ${member.name} (${member.id})`);
      }
    });

  memberCmd
    .command("list")
    .description("List members")
    .option("--org <id>", "Filter by organization")
    .option("--team <id>", "Filter by team")
    .option("--role <role>", "Filter by role")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const members = listMembers({
        org_id: opts.org,
        team_id: opts.team,
        role: opts.role,
      });

      if (opts.json) {
        console.log(JSON.stringify(members, null, 2));
      } else {
        if (members.length === 0) {
          console.log("No members found.");
          return;
        }
        for (const m of members) {
          const email = m.email ? ` <${m.email}>` : "";
          console.log(`  ${m.name}${email} [${m.role}]`);
        }
        console.log(`\n${members.length} member(s)`);
      }
    });

  memberCmd
    .command("get")
    .description("Get a member by ID")
    .argument("<id>", "Member ID")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const member = getMember(id);
      if (!member) {
        console.error(`Member '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(member, null, 2));
      } else {
        console.log(`${member.name}`);
        if (member.email) console.log(`  Email: ${member.email}`);
        console.log(`  Role: ${member.role}`);
        if (member.title) console.log(`  Title: ${member.title}`);
        console.log(`  Status: ${member.status}`);
      }
    });

  memberCmd
    .command("update")
    .description("Update a member")
    .argument("<id>", "Member ID")
    .option("--name <name>", "Name")
    .option("--team <id>", "Team ID")
    .option("--email <email>", "Email")
    .option("--role <role>", "Role")
    .option("--title <title>", "Title")
    .option("--status <status>", "Status")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const input: Record<string, unknown> = {};
      if (opts.name !== undefined) input.name = opts.name;
      if (opts.team !== undefined) input.team_id = opts.team;
      if (opts.email !== undefined) input.email = opts.email;
      if (opts.role !== undefined) input.role = opts.role;
      if (opts.title !== undefined) input.title = opts.title;
      if (opts.status !== undefined) input.status = opts.status;

      const member = updateMember(id, input);
      if (!member) {
        console.error(`Member '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(member, null, 2));
      } else {
        console.log(`Updated: ${member.name}`);
      }
    });

  memberCmd
    .command("remove")
    .description("Remove a member")
    .argument("<id>", "Member ID")
    .action((id) => {
      const removed = removeMember(id);
      if (removed) {
        console.log(`Removed member ${id}`);
      } else {
        console.error(`Member '${id}' not found.`);
        process.exit(1);
      }
    });
}
