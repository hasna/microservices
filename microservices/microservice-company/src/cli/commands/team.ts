import { Command } from "commander";
import {
  createTeam,
  getTeam,
  listTeams,
  updateTeam,
  deleteTeam,
  getTeamTree,
} from "../../db/company.js";

export function registerTeamCommands(program: Command): void {
  const teamCmd = program.command("team").description("Team management");

  teamCmd
    .command("create")
    .description("Create a team")
    .requiredOption("--org <id>", "Organization ID")
    .requiredOption("--name <name>", "Team name")
    .option("--parent <id>", "Parent team ID")
    .option("--department <dept>", "Department")
    .option("--cost-center <cc>", "Cost center")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const team = createTeam({
        org_id: opts.org,
        name: opts.name,
        parent_id: opts.parent,
        department: opts.department,
        cost_center: opts.costCenter,
      });

      if (opts.json) {
        console.log(JSON.stringify(team, null, 2));
      } else {
        console.log(`Created team: ${team.name} (${team.id})`);
      }
    });

  teamCmd
    .command("list")
    .description("List teams")
    .option("--org <id>", "Filter by organization")
    .option("--department <dept>", "Filter by department")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const teams = listTeams({
        org_id: opts.org,
        department: opts.department,
      });

      if (opts.json) {
        console.log(JSON.stringify(teams, null, 2));
      } else {
        if (teams.length === 0) {
          console.log("No teams found.");
          return;
        }
        for (const t of teams) {
          const dept = t.department ? ` (${t.department})` : "";
          console.log(`  ${t.name}${dept} — ${t.id}`);
        }
        console.log(`\n${teams.length} team(s)`);
      }
    });

  teamCmd
    .command("get")
    .description("Get a team by ID")
    .argument("<id>", "Team ID")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const team = getTeam(id);
      if (!team) {
        console.error(`Team '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(team, null, 2));
      } else {
        console.log(`${team.name}`);
        if (team.department) console.log(`  Department: ${team.department}`);
        if (team.cost_center) console.log(`  Cost Center: ${team.cost_center}`);
        if (team.parent_id) console.log(`  Parent: ${team.parent_id}`);
      }
    });

  teamCmd
    .command("update")
    .description("Update a team")
    .argument("<id>", "Team ID")
    .option("--name <name>", "Name")
    .option("--parent <id>", "Parent team ID")
    .option("--department <dept>", "Department")
    .option("--cost-center <cc>", "Cost center")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const input: Record<string, unknown> = {};
      if (opts.name !== undefined) input.name = opts.name;
      if (opts.parent !== undefined) input.parent_id = opts.parent;
      if (opts.department !== undefined) input.department = opts.department;
      if (opts.costCenter !== undefined) input.cost_center = opts.costCenter;

      const team = updateTeam(id, input);
      if (!team) {
        console.error(`Team '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(team, null, 2));
      } else {
        console.log(`Updated: ${team.name}`);
      }
    });

  teamCmd
    .command("delete")
    .description("Delete a team")
    .argument("<id>", "Team ID")
    .action((id) => {
      const deleted = deleteTeam(id);
      if (deleted) {
        console.log(`Deleted team ${id}`);
      } else {
        console.error(`Team '${id}' not found.`);
        process.exit(1);
      }
    });

  teamCmd
    .command("tree")
    .description("Show team hierarchy")
    .requiredOption("--org <id>", "Organization ID")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const tree = getTeamTree(opts.org);

      if (opts.json) {
        console.log(JSON.stringify(tree, null, 2));
      } else {
        function printTree(nodes: typeof tree, indent = 0) {
          for (const node of nodes) {
            const prefix = "  ".repeat(indent);
            const dept = node.department ? ` (${node.department})` : "";
            console.log(`${prefix}${node.name}${dept}`);
            printTree(node.children, indent + 1);
          }
        }
        if (tree.length === 0) {
          console.log("No teams found.");
        } else {
          printTree(tree);
        }
      }
    });
}
