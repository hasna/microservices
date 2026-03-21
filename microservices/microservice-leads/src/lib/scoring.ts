/**
 * Lead scoring — rule-based scoring with AI fallback
 */

import { getLead, updateLead, addActivity, getActivities, listLeads } from "../db/leads.js";
import type { Lead } from "../db/leads.js";

export interface ScoreResult {
  score: number;
  reason: string;
}

const FREE_EMAIL_DOMAINS = [
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "aol.com", "protonmail.com", "mail.com", "icloud.com",
];

/**
 * Score a lead using rule-based analysis.
 * Returns score 0-100 with reason.
 */
export function scoreLead(leadId: string): ScoreResult | null {
  const lead = getLead(leadId);
  if (!lead) return null;

  let score = 0;
  const reasons: string[] = [];

  // +10 for company email (not free provider)
  if (lead.email) {
    const domain = lead.email.split("@")[1];
    if (domain && !FREE_EMAIL_DOMAINS.includes(domain)) {
      score += 10;
      reasons.push("company email (+10)");
    }
  }

  // +15 for having a title
  if (lead.title) {
    score += 15;
    reasons.push("has title (+15)");

    // Bonus for decision-maker titles
    const decisionMakerKeywords = ["ceo", "cto", "cfo", "coo", "vp", "director", "head", "chief", "founder", "owner", "president"];
    const titleLower = lead.title.toLowerCase();
    if (decisionMakerKeywords.some((kw) => titleLower.includes(kw))) {
      score += 10;
      reasons.push("decision maker title (+10)");
    }
  }

  // +10 for having a phone number
  if (lead.phone) {
    score += 10;
    reasons.push("has phone (+10)");
  }

  // +20 for having LinkedIn
  if (lead.linkedin_url) {
    score += 20;
    reasons.push("has LinkedIn (+20)");
  }

  // +10 for having a company
  if (lead.company) {
    score += 10;
    reasons.push("has company (+10)");
  }

  // +5 per activity (up to 25)
  const activities = getActivities(leadId);
  const activityScore = Math.min(activities.length * 5, 25);
  if (activityScore > 0) {
    score += activityScore;
    reasons.push(`${activities.length} activities (+${activityScore})`);
  }

  // +5 for being enriched
  if (lead.enriched) {
    score += 5;
    reasons.push("enriched (+5)");
  }

  // Cap at 100
  score = Math.min(score, 100);

  const reason = reasons.join(", ") || "no scoring signals";

  // Update the lead
  updateLead(leadId, { score, score_reason: reason });
  addActivity(leadId, "score_change", `Score updated to ${score}: ${reason}`);

  return { score, reason };
}

/**
 * Auto-score all leads with score=0
 */
export function autoScoreAll(): { scored: number; total: number } {
  const leads = listLeads();
  const unscored = leads.filter((l) => l.score === 0);
  let scored = 0;

  for (const lead of unscored) {
    const result = scoreLead(lead.id);
    if (result) scored++;
  }

  return { scored, total: unscored.length };
}

export interface ScoreDistribution {
  range: string;
  count: number;
}

/**
 * Get score distribution across all leads
 */
export function getScoreDistribution(): ScoreDistribution[] {
  const leads = listLeads();
  const ranges = [
    { range: "0-20", min: 0, max: 20 },
    { range: "21-40", min: 21, max: 40 },
    { range: "41-60", min: 41, max: 60 },
    { range: "61-80", min: 61, max: 80 },
    { range: "81-100", min: 81, max: 100 },
  ];

  return ranges.map(({ range, min, max }) => ({
    range,
    count: leads.filter((l) => l.score >= min && l.score <= max).length,
  }));
}
