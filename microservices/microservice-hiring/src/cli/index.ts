#!/usr/bin/env bun

import { Command } from "commander";
import { readFileSync } from "node:fs";
import {
  createJob,
  getJob,
  listJobs,
  closeJob,
  createApplicant,
  getApplicant,
  listApplicants,
  advanceApplicant,
  rejectApplicant,
  searchApplicants,
  getPipeline,
  getHiringStats,
  createInterview,
  listInterviews,
  addInterviewFeedback,
  bulkImportApplicants,
  generateOffer,
  getHiringForecast,
  submitStructuredFeedback,
  bulkReject,
  getReferralStats,
  saveJobAsTemplate,
  createJobFromTemplate,
  listJobTemplates,
} from "../db/hiring.js";
import { scoreApplicant, rankApplicants } from "../lib/scoring.js";

const program = new Command();

program
  .name("microservice-hiring")
  .description("Applicant tracking and recruitment microservice")
  .version("0.0.1");

// --- Jobs ---

const jobCmd = program
  .command("job")
  .description("Job management");

jobCmd
  .command("create")
  .description("Create a new job posting")
  .requiredOption("--title <title>", "Job title")
  .option("--department <dept>", "Department")
  .option("--location <loc>", "Location")
  .option("--type <type>", "Job type (full-time/part-time/contract)", "full-time")
  .option("--description <desc>", "Job description")
  .option("--requirements <reqs>", "Comma-separated requirements")
  .option("--salary-range <range>", "Salary range")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const job = createJob({
      title: opts.title,
      department: opts.department,
      location: opts.location,
      type: opts.type,
      description: opts.description,
      requirements: opts.requirements
        ? opts.requirements.split(",").map((r: string) => r.trim())
        : undefined,
      salary_range: opts.salaryRange,
    });

    if (opts.json) {
      console.log(JSON.stringify(job, null, 2));
    } else {
      console.log(`Created job: ${job.title} (${job.id})`);
    }
  });

jobCmd
  .command("list")
  .description("List jobs")
  .option("--status <status>", "Filter by status (open/closed/paused)")
  .option("--department <dept>", "Filter by department")
  .option("--type <type>", "Filter by type")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const jobs = listJobs({
      status: opts.status,
      department: opts.department,
      type: opts.type,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(jobs, null, 2));
    } else {
      if (jobs.length === 0) {
        console.log("No jobs found.");
        return;
      }
      for (const j of jobs) {
        const dept = j.department ? ` [${j.department}]` : "";
        console.log(`  ${j.title}${dept} — ${j.status} (${j.id})`);
      }
      console.log(`\n${jobs.length} job(s)`);
    }
  });

jobCmd
  .command("get")
  .description("Get a job by ID")
  .argument("<id>", "Job ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const job = getJob(id);
    if (!job) {
      console.error(`Job '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(job, null, 2));
    } else {
      console.log(`${job.title}`);
      console.log(`  Status: ${job.status}`);
      console.log(`  Type: ${job.type}`);
      if (job.department) console.log(`  Department: ${job.department}`);
      if (job.location) console.log(`  Location: ${job.location}`);
      if (job.salary_range) console.log(`  Salary: ${job.salary_range}`);
      if (job.description) console.log(`  Description: ${job.description}`);
      if (job.requirements.length) console.log(`  Requirements: ${job.requirements.join(", ")}`);
    }
  });

jobCmd
  .command("close")
  .description("Close a job posting")
  .argument("<id>", "Job ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const job = closeJob(id);
    if (!job) {
      console.error(`Job '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(job, null, 2));
    } else {
      console.log(`Closed job: ${job.title}`);
    }
  });

// --- Applicants ---

const applicantCmd = program
  .command("applicant")
  .description("Applicant management");

applicantCmd
  .command("add")
  .description("Add a new applicant")
  .requiredOption("--name <name>", "Applicant name")
  .requiredOption("--job <id>", "Job ID")
  .option("--email <email>", "Email address")
  .option("--phone <phone>", "Phone number")
  .option("--resume <url>", "Resume URL")
  .option("--source <source>", "Source (linkedin, referral, etc.)")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const applicant = createApplicant({
      name: opts.name,
      job_id: opts.job,
      email: opts.email,
      phone: opts.phone,
      resume_url: opts.resume,
      source: opts.source,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(applicant, null, 2));
    } else {
      console.log(`Added applicant: ${applicant.name} (${applicant.id})`);
    }
  });

applicantCmd
  .command("list")
  .description("List applicants")
  .option("--job <id>", "Filter by job ID")
  .option("--status <status>", "Filter by status")
  .option("--source <source>", "Filter by source")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const applicants = listApplicants({
      job_id: opts.job,
      status: opts.status,
      source: opts.source,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(applicants, null, 2));
    } else {
      if (applicants.length === 0) {
        console.log("No applicants found.");
        return;
      }
      for (const a of applicants) {
        const email = a.email ? ` <${a.email}>` : "";
        console.log(`  ${a.name}${email} — ${a.status} (${a.id})`);
      }
      console.log(`\n${applicants.length} applicant(s)`);
    }
  });

applicantCmd
  .command("get")
  .description("Get an applicant by ID")
  .argument("<id>", "Applicant ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const applicant = getApplicant(id);
    if (!applicant) {
      console.error(`Applicant '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(applicant, null, 2));
    } else {
      console.log(`${applicant.name}`);
      console.log(`  Status: ${applicant.status}`);
      if (applicant.email) console.log(`  Email: ${applicant.email}`);
      if (applicant.phone) console.log(`  Phone: ${applicant.phone}`);
      if (applicant.source) console.log(`  Source: ${applicant.source}`);
      if (applicant.rating) console.log(`  Rating: ${applicant.rating}`);
      if (applicant.notes) console.log(`  Notes: ${applicant.notes}`);
    }
  });

applicantCmd
  .command("advance")
  .description("Advance an applicant to a new status")
  .argument("<id>", "Applicant ID")
  .requiredOption("--status <status>", "New status (screening/interviewing/offered/hired)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const applicant = advanceApplicant(id, opts.status);
    if (!applicant) {
      console.error(`Applicant '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(applicant, null, 2));
    } else {
      console.log(`Advanced ${applicant.name} to ${applicant.status}`);
    }
  });

applicantCmd
  .command("reject")
  .description("Reject an applicant")
  .argument("<id>", "Applicant ID")
  .option("--reason <reason>", "Rejection reason")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const applicant = rejectApplicant(id, opts.reason);
    if (!applicant) {
      console.error(`Applicant '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(applicant, null, 2));
    } else {
      console.log(`Rejected ${applicant.name}`);
    }
  });

applicantCmd
  .command("search")
  .description("Search applicants")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchApplicants(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No applicants matching "${query}".`);
        return;
      }
      for (const a of results) {
        console.log(`  ${a.name} ${a.email ? `<${a.email}>` : ""} — ${a.status}`);
      }
    }
  });

// --- Bulk Import ---

applicantCmd
  .command("bulk-import")
  .description("Bulk import applicants from a CSV file")
  .requiredOption("--file <path>", "Path to CSV file (name,email,phone,job_id,source,resume_url)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const csvData = readFileSync(opts.file, "utf-8");
    const result = bulkImportApplicants(csvData);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Imported: ${result.imported}`);
      console.log(`Skipped: ${result.skipped}`);
      if (result.errors.length > 0) {
        console.log("Errors:");
        for (const e of result.errors) {
          console.log(`  - ${e}`);
        }
      }
    }
  });

// --- AI Scoring ---

applicantCmd
  .command("score")
  .description("AI-score an applicant against job requirements")
  .argument("<id>", "Applicant ID")
  .option("--json", "Output as JSON", false)
  .action(async (id, opts) => {
    try {
      const score = await scoreApplicant(id);

      if (opts.json) {
        console.log(JSON.stringify(score, null, 2));
      } else {
        console.log(`Match: ${score.match_pct}%`);
        console.log(`Recommendation: ${score.recommendation}`);
        if (score.strengths.length) console.log(`Strengths: ${score.strengths.join(", ")}`);
        if (score.gaps.length) console.log(`Gaps: ${score.gaps.join(", ")}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// --- AI Bulk Ranking ---

applicantCmd
  .command("rank")
  .description("AI-rank all applicants for a job by fit score")
  .requiredOption("--job <id>", "Job ID")
  .option("--json", "Output as JSON", false)
  .action(async (opts) => {
    try {
      const ranked = await rankApplicants(opts.job);

      if (opts.json) {
        console.log(JSON.stringify(ranked, null, 2));
      } else {
        if (ranked.length === 0) {
          console.log("No applicants to rank.");
          return;
        }
        console.log("Ranking:");
        for (let i = 0; i < ranked.length; i++) {
          const { applicant, score } = ranked[i];
          console.log(`  ${i + 1}. ${applicant.name} — ${score.match_pct}% (${score.recommendation})`);
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// --- Offer Letter ---

applicantCmd
  .command("offer")
  .description("Generate a Markdown offer letter")
  .argument("<id>", "Applicant ID")
  .requiredOption("--salary <amount>", "Annual salary")
  .requiredOption("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--title <title>", "Position title override")
  .option("--department <dept>", "Department override")
  .option("--benefits <text>", "Benefits description")
  .option("--equity <text>", "Equity details")
  .option("--signing-bonus <amount>", "Signing bonus")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    try {
      const letter = generateOffer(id, {
        salary: parseInt(opts.salary),
        start_date: opts.startDate,
        position_title: opts.title,
        department: opts.department,
        benefits: opts.benefits,
        equity: opts.equity,
        signing_bonus: opts.signingBonus ? parseInt(opts.signingBonus) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify({ offer_letter: letter }, null, 2));
      } else {
        console.log(letter);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// --- Bulk Rejection ---

applicantCmd
  .command("reject-batch")
  .description("Bulk reject applicants for a job by status")
  .requiredOption("--job <id>", "Job ID")
  .requiredOption("--status <status>", "Status to reject (applied/screening/etc.)")
  .option("--reason <reason>", "Rejection reason")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = bulkReject(opts.job, opts.status, opts.reason);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Rejected ${result.rejected} applicant(s)`);
    }
  });

// --- Interviews ---

const interviewCmd = program
  .command("interview")
  .description("Interview management");

interviewCmd
  .command("schedule")
  .description("Schedule an interview")
  .requiredOption("--applicant <id>", "Applicant ID")
  .option("--interviewer <name>", "Interviewer name")
  .option("--at <datetime>", "Scheduled datetime (ISO 8601)")
  .option("--duration <min>", "Duration in minutes")
  .option("--type <type>", "Interview type (phone/video/onsite)", "phone")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const interview = createInterview({
      applicant_id: opts.applicant,
      interviewer: opts.interviewer,
      scheduled_at: opts.at,
      duration_min: opts.duration ? parseInt(opts.duration) : undefined,
      type: opts.type,
    });

    if (opts.json) {
      console.log(JSON.stringify(interview, null, 2));
    } else {
      console.log(`Scheduled interview (${interview.id})`);
    }
  });

interviewCmd
  .command("list")
  .description("List interviews")
  .option("--applicant <id>", "Filter by applicant ID")
  .option("--status <status>", "Filter by status")
  .option("--type <type>", "Filter by type")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const interviews = listInterviews({
      applicant_id: opts.applicant,
      status: opts.status,
      type: opts.type,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(interviews, null, 2));
    } else {
      if (interviews.length === 0) {
        console.log("No interviews found.");
        return;
      }
      for (const i of interviews) {
        const when = i.scheduled_at || "TBD";
        const who = i.interviewer || "TBD";
        console.log(`  ${i.type} with ${who} @ ${when} — ${i.status} (${i.id})`);
      }
      console.log(`\n${interviews.length} interview(s)`);
    }
  });

interviewCmd
  .command("feedback")
  .description("Add feedback to an interview (supports structured scoring dimensions)")
  .argument("<id>", "Interview ID")
  .option("--feedback <text>", "Feedback text")
  .option("--rating <n>", "Overall rating (1-5)")
  .option("--technical <n>", "Technical score (1-5)")
  .option("--communication <n>", "Communication score (1-5)")
  .option("--culture-fit <n>", "Culture fit score (1-5)")
  .option("--problem-solving <n>", "Problem solving score (1-5)")
  .option("--leadership <n>", "Leadership score (1-5)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const hasStructured = opts.technical || opts.communication || opts.cultureFit ||
      opts.problemSolving || opts.leadership;

    let interview;
    if (hasStructured) {
      interview = submitStructuredFeedback(
        id,
        {
          technical: opts.technical ? parseInt(opts.technical) : undefined,
          communication: opts.communication ? parseInt(opts.communication) : undefined,
          culture_fit: opts.cultureFit ? parseInt(opts.cultureFit) : undefined,
          problem_solving: opts.problemSolving ? parseInt(opts.problemSolving) : undefined,
          leadership: opts.leadership ? parseInt(opts.leadership) : undefined,
          overall: opts.rating ? parseInt(opts.rating) : undefined,
        },
        opts.feedback
      );
    } else {
      if (!opts.feedback) {
        console.error("Either --feedback or structured scores (--technical, --communication, etc.) are required.");
        process.exit(1);
      }
      interview = addInterviewFeedback(
        id,
        opts.feedback,
        opts.rating ? parseInt(opts.rating) : undefined
      );
    }

    if (!interview) {
      console.error(`Interview '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(interview, null, 2));
    } else {
      console.log(`Added feedback to interview ${id}`);
    }
  });

// --- Pipeline & Stats ---

program
  .command("pipeline")
  .description("Show hiring pipeline for a job")
  .argument("<job-id>", "Job ID")
  .option("--json", "Output as JSON", false)
  .action((jobId, opts) => {
    const pipeline = getPipeline(jobId);

    if (opts.json) {
      console.log(JSON.stringify(pipeline, null, 2));
    } else {
      if (pipeline.length === 0) {
        console.log("No applicants in pipeline.");
        return;
      }
      console.log("Pipeline:");
      for (const p of pipeline) {
        const bar = "#".repeat(p.count);
        console.log(`  ${p.status.padEnd(14)} ${bar} (${p.count})`);
      }
    }
  });

program
  .command("stats")
  .description("Show hiring statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getHiringStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log("Hiring Stats:");
      console.log(`  Jobs: ${stats.total_jobs} total, ${stats.open_jobs} open`);
      console.log(`  Applicants: ${stats.total_applicants}`);
      console.log(`  Interviews: ${stats.total_interviews}`);
      if (stats.avg_rating) console.log(`  Avg Rating: ${stats.avg_rating}`);
      if (stats.applicants_by_status.length) {
        console.log("  By Status:");
        for (const s of stats.applicants_by_status) {
          console.log(`    ${s.status}: ${s.count}`);
        }
      }
    }
  });

// --- Referral Stats ---

const statsCmd = program
  .command("stats-referrals")
  .description("Show referral/source conversion rates")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getReferralStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      if (stats.length === 0) {
        console.log("No applicant source data.");
        return;
      }
      console.log("Referral Stats:");
      for (const s of stats) {
        console.log(`  ${s.source}: ${s.total} total, ${s.hired} hired, ${s.conversion_rate}% conversion`);
      }
    }
  });

// --- Forecast ---

program
  .command("forecast")
  .description("Estimate days-to-fill based on pipeline velocity")
  .argument("<job-id>", "Job ID")
  .option("--json", "Output as JSON", false)
  .action((jobId, opts) => {
    try {
      const forecast = getHiringForecast(jobId);

      if (opts.json) {
        console.log(JSON.stringify(forecast, null, 2));
      } else {
        console.log(`Forecast for: ${forecast.job_title}`);
        console.log(`  Total applicants: ${forecast.total_applicants}`);
        console.log(`  Estimated days to fill: ${forecast.estimated_days_to_fill ?? "N/A"}`);

        if (Object.keys(forecast.avg_days_per_stage).length) {
          console.log("  Avg days per transition:");
          for (const [stage, days] of Object.entries(forecast.avg_days_per_stage)) {
            console.log(`    ${stage}: ${days} days`);
          }
        }

        if (Object.keys(forecast.conversion_rates).length) {
          console.log("  Conversion rates:");
          for (const [stage, rate] of Object.entries(forecast.conversion_rates)) {
            console.log(`    ${stage}: ${rate}%`);
          }
        }
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// --- Job Templates ---

jobCmd
  .command("save-template")
  .description("Save a job as a reusable template")
  .argument("<id>", "Job ID")
  .requiredOption("--name <name>", "Template name")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    try {
      const template = saveJobAsTemplate(id, opts.name);

      if (opts.json) {
        console.log(JSON.stringify(template, null, 2));
      } else {
        console.log(`Saved template: ${template.name} (${template.id})`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

jobCmd
  .command("from-template")
  .description("Create a job from a template")
  .requiredOption("--template <name>", "Template name")
  .option("--title <title>", "Override title")
  .option("--department <dept>", "Override department")
  .option("--location <loc>", "Override location")
  .option("--salary-range <range>", "Override salary range")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const job = createJobFromTemplate(opts.template, {
        title: opts.title,
        department: opts.department,
        location: opts.location,
        salary_range: opts.salaryRange,
      });

      if (opts.json) {
        console.log(JSON.stringify(job, null, 2));
      } else {
        console.log(`Created job from template: ${job.title} (${job.id})`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

jobCmd
  .command("templates")
  .description("List all job templates")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const templates = listJobTemplates();

    if (opts.json) {
      console.log(JSON.stringify(templates, null, 2));
    } else {
      if (templates.length === 0) {
        console.log("No templates found.");
        return;
      }
      for (const t of templates) {
        console.log(`  ${t.name} — ${t.title} (${t.id})`);
      }
      console.log(`\n${templates.length} template(s)`);
    }
  });

program.parse(process.argv);
