import { Command } from "commander";
import {
  createTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  useTemplate,
} from "../../db/social.js";

export function registerTemplateCommands(program: Command): void {
  const templateCmd = program
    .command("template")
    .description("Post template management");

  templateCmd
    .command("create")
    .description("Create a post template")
    .requiredOption("--name <name>", "Template name")
    .requiredOption("--content <content>", "Template content (use {{var}} for variables)")
    .option("--variables <vars>", "Comma-separated variable names")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const template = createTemplate({
        name: opts.name,
        content: opts.content,
        variables: opts.variables ? opts.variables.split(",").map((v: string) => v.trim()) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(template, null, 2));
      } else {
        console.log(`Created template: ${template.name} (${template.id})`);
      }
    });

  templateCmd
    .command("list")
    .description("List templates")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const templates = listTemplates();

      if (opts.json) {
        console.log(JSON.stringify(templates, null, 2));
      } else {
        if (templates.length === 0) {
          console.log("No templates found.");
          return;
        }
        for (const t of templates) {
          const vars = t.variables.length ? ` (vars: ${t.variables.join(", ")})` : "";
          console.log(`  ${t.name}${vars}`);
        }
        console.log(`\n${templates.length} template(s)`);
      }
    });

  templateCmd
    .command("get")
    .description("Get a template by ID")
    .argument("<id>", "Template ID")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const template = getTemplate(id);
      if (!template) {
        console.error(`Template '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(template, null, 2));
      } else {
        console.log(`Template: ${template.name} (${template.id})`);
        console.log(`  Content: ${template.content}`);
        if (template.variables.length) {
          console.log(`  Variables: ${template.variables.join(", ")}`);
        }
      }
    });

  templateCmd
    .command("use")
    .description("Create a post from a template")
    .argument("<template-id>", "Template ID")
    .requiredOption("--account <id>", "Account ID")
    .option("--values <json>", "JSON object of variable values")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--json", "Output as JSON", false)
    .action((templateId, opts) => {
      const values = opts.values ? JSON.parse(opts.values) : {};
      const tags = opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined;

      const post = useTemplate(templateId, opts.account, values, tags);

      if (opts.json) {
        console.log(JSON.stringify(post, null, 2));
      } else {
        console.log(`Created post from template: ${post.id}`);
        console.log(`  Content: ${post.content.substring(0, 80)}${post.content.length > 80 ? "..." : ""}`);
      }
    });

  templateCmd
    .command("delete")
    .description("Delete a template")
    .argument("<id>", "Template ID")
    .action((id) => {
      const deleted = deleteTemplate(id);
      if (deleted) {
        console.log(`Deleted template ${id}`);
      } else {
        console.error(`Template '${id}' not found.`);
        process.exit(1);
      }
    });
}
