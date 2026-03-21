#!/usr/bin/env bun

import { Command } from "commander";
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
} from "../db/hiring.js";

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
  .description("Add feedback to an interview")
  .argument("<id>", "Interview ID")
  .requiredOption("--feedback <text>", "Feedback text")
  .option("--rating <n>", "Rating (1-5)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const interview = addInterviewFeedback(
      id,
      opts.feedback,
      opts.rating ? parseInt(opts.rating) : undefined
    );
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

program.parse(process.argv);
