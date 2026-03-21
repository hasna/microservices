import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-subscriptions-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
  countPlans,
  createSubscriber,
  getSubscriber,
  listSubscribers,
  updateSubscriber,
  deleteSubscriber,
  countSubscribers,
  cancelSubscriber,
  upgradeSubscriber,
  downgradeSubscriber,
  recordEvent,
  listEvents,
  getMrr,
  getArr,
  getChurnRate,
  listExpiring,
  getSubscriberStats,
  pauseSubscriber,
  resumeSubscriber,
  extendTrial,
  createDunning,
  getDunning,
  listDunning,
  updateDunning,
  bulkImportSubscribers,
  exportSubscribers,
  parseImportCsv,
  getLtv,
  getNrr,
  getCohortReport,
  comparePlans,
  getExpiringRenewals,
} from "./subscriptions";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Plans", () => {
  test("create and get plan", () => {
    const plan = createPlan({
      name: "Basic",
      price: 9.99,
      interval: "monthly",
      features: ["email", "chat"],
    });

    expect(plan.id).toBeTruthy();
    expect(plan.name).toBe("Basic");
    expect(plan.price).toBe(9.99);
    expect(plan.interval).toBe("monthly");
    expect(plan.features).toEqual(["email", "chat"]);
    expect(plan.active).toBe(true);

    const fetched = getPlan(plan.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(plan.id);
  });

  test("create yearly plan", () => {
    const plan = createPlan({
      name: "Pro Annual",
      price: 99.99,
      interval: "yearly",
      features: ["email", "chat", "phone", "priority"],
    });

    expect(plan.interval).toBe("yearly");
    expect(plan.price).toBe(99.99);
  });

  test("create lifetime plan", () => {
    const plan = createPlan({
      name: "Lifetime",
      price: 299.99,
      interval: "lifetime",
    });

    expect(plan.interval).toBe("lifetime");
    expect(plan.features).toEqual([]);
  });

  test("list plans", () => {
    const plans = listPlans();
    expect(plans.length).toBeGreaterThanOrEqual(3);
  });

  test("list active plans only", () => {
    // Create an inactive plan
    const plan = createPlan({ name: "Inactive Plan", price: 5, interval: "monthly" });
    updatePlan(plan.id, { active: false });

    const activePlans = listPlans({ active_only: true });
    expect(activePlans.every((p) => p.active)).toBe(true);
  });

  test("update plan", () => {
    const plan = createPlan({ name: "Update Me", price: 10, interval: "monthly" });
    const updated = updatePlan(plan.id, {
      name: "Updated Plan",
      price: 15,
      features: ["new-feature"],
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Plan");
    expect(updated!.price).toBe(15);
    expect(updated!.features).toEqual(["new-feature"]);
  });

  test("delete plan", () => {
    const plan = createPlan({ name: "Delete Me", price: 5, interval: "monthly" });
    expect(deletePlan(plan.id)).toBe(true);
    expect(getPlan(plan.id)).toBeNull();
  });

  test("count plans", () => {
    const count = countPlans();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("get nonexistent plan returns null", () => {
    expect(getPlan("nonexistent-id")).toBeNull();
  });
});

describe("Subscribers", () => {
  let monthlyPlan: ReturnType<typeof createPlan>;
  let yearlyPlan: ReturnType<typeof createPlan>;
  let lifetimePlan: ReturnType<typeof createPlan>;

  // Create reusable plans for subscriber tests
  test("setup plans for subscriber tests", () => {
    monthlyPlan = createPlan({ name: "Sub Monthly", price: 29, interval: "monthly" });
    yearlyPlan = createPlan({ name: "Sub Yearly", price: 290, interval: "yearly" });
    lifetimePlan = createPlan({ name: "Sub Lifetime", price: 999, interval: "lifetime" });
  });

  test("create subscriber", () => {
    const sub = createSubscriber({
      plan_id: monthlyPlan.id,
      customer_name: "Alice Johnson",
      customer_email: "alice@example.com",
    });

    expect(sub.id).toBeTruthy();
    expect(sub.customer_name).toBe("Alice Johnson");
    expect(sub.customer_email).toBe("alice@example.com");
    expect(sub.status).toBe("active");
    expect(sub.plan_id).toBe(monthlyPlan.id);
    expect(sub.current_period_end).toBeTruthy();
  });

  test("create subscriber with trial", () => {
    const trialEnd = "2099-12-31 23:59:59";
    const sub = createSubscriber({
      plan_id: monthlyPlan.id,
      customer_name: "Bob Trial",
      customer_email: "bob@example.com",
      status: "trialing",
      trial_ends_at: trialEnd,
    });

    expect(sub.status).toBe("trialing");
    expect(sub.trial_ends_at).toBe(trialEnd);
  });

  test("create subscriber with lifetime plan has no period end", () => {
    const sub = createSubscriber({
      plan_id: lifetimePlan.id,
      customer_name: "Charlie Lifetime",
      customer_email: "charlie@example.com",
    });

    expect(sub.current_period_end).toBeNull();
  });

  test("list subscribers", () => {
    const subs = listSubscribers();
    expect(subs.length).toBeGreaterThanOrEqual(3);
  });

  test("list subscribers by status", () => {
    const trialing = listSubscribers({ status: "trialing" });
    expect(trialing.length).toBeGreaterThanOrEqual(1);
    expect(trialing.every((s) => s.status === "trialing")).toBe(true);
  });

  test("search subscribers", () => {
    const results = listSubscribers({ search: "Alice" });
    expect(results.length).toBe(1);
    expect(results[0].customer_name).toBe("Alice Johnson");
  });

  test("update subscriber", () => {
    const sub = createSubscriber({
      plan_id: monthlyPlan.id,
      customer_name: "Update Me",
      customer_email: "update@example.com",
    });
    const updated = updateSubscriber(sub.id, {
      customer_name: "Updated Name",
      metadata: { source: "test" },
    });

    expect(updated).toBeDefined();
    expect(updated!.customer_name).toBe("Updated Name");
    expect(updated!.metadata).toEqual({ source: "test" });
  });

  test("delete subscriber", () => {
    const sub = createSubscriber({
      plan_id: monthlyPlan.id,
      customer_name: "Delete Me",
      customer_email: "delete@example.com",
    });
    expect(deleteSubscriber(sub.id)).toBe(true);
    expect(getSubscriber(sub.id)).toBeNull();
  });

  test("cancel subscriber", () => {
    const sub = createSubscriber({
      plan_id: monthlyPlan.id,
      customer_name: "Cancel Me",
      customer_email: "cancel@example.com",
    });

    const canceled = cancelSubscriber(sub.id);
    expect(canceled).toBeDefined();
    expect(canceled!.status).toBe("canceled");
    expect(canceled!.canceled_at).toBeTruthy();
  });

  test("upgrade subscriber", () => {
    const sub = createSubscriber({
      plan_id: monthlyPlan.id,
      customer_name: "Upgrade Me",
      customer_email: "upgrade@example.com",
    });

    const upgraded = upgradeSubscriber(sub.id, yearlyPlan.id);
    expect(upgraded).toBeDefined();
    expect(upgraded!.plan_id).toBe(yearlyPlan.id);
    expect(upgraded!.status).toBe("active");
  });

  test("downgrade subscriber", () => {
    const sub = createSubscriber({
      plan_id: yearlyPlan.id,
      customer_name: "Downgrade Me",
      customer_email: "downgrade@example.com",
    });

    const downgraded = downgradeSubscriber(sub.id, monthlyPlan.id);
    expect(downgraded).toBeDefined();
    expect(downgraded!.plan_id).toBe(monthlyPlan.id);
    expect(downgraded!.status).toBe("active");
  });

  test("upgrade nonexistent subscriber returns null", () => {
    expect(upgradeSubscriber("nonexistent", monthlyPlan.id)).toBeNull();
  });

  test("downgrade to nonexistent plan returns null", () => {
    const sub = createSubscriber({
      plan_id: monthlyPlan.id,
      customer_name: "Bad Downgrade",
      customer_email: "baddown@example.com",
    });
    expect(downgradeSubscriber(sub.id, "nonexistent-plan")).toBeNull();
  });

  test("count subscribers", () => {
    const count = countSubscribers();
    expect(count).toBeGreaterThanOrEqual(5);
  });
});

describe("Events", () => {
  test("creation event is recorded automatically", () => {
    const plan = createPlan({ name: "Event Plan", price: 10, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Event Person",
      customer_email: "event@example.com",
    });

    const events = listEvents({ subscriber_id: sub.id });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === "created")).toBe(true);
  });

  test("cancel event is recorded", () => {
    const plan = createPlan({ name: "Cancel Event Plan", price: 10, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Cancel Event",
      customer_email: "cancelevent@example.com",
    });

    cancelSubscriber(sub.id);

    const events = listEvents({ subscriber_id: sub.id });
    expect(events.some((e) => e.type === "canceled")).toBe(true);
  });

  test("upgrade event is recorded", () => {
    const plan1 = createPlan({ name: "Upgrade From", price: 10, interval: "monthly" });
    const plan2 = createPlan({ name: "Upgrade To", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan1.id,
      customer_name: "Upgrade Event",
      customer_email: "upgradeevent@example.com",
    });

    upgradeSubscriber(sub.id, plan2.id);

    const events = listEvents({ subscriber_id: sub.id });
    const upgradeEvent = events.find((e) => e.type === "upgraded");
    expect(upgradeEvent).toBeDefined();
    expect(upgradeEvent!.details).toHaveProperty("old_plan_id", plan1.id);
    expect(upgradeEvent!.details).toHaveProperty("new_plan_id", plan2.id);
  });

  test("downgrade event is recorded", () => {
    const plan1 = createPlan({ name: "Downgrade From", price: 20, interval: "monthly" });
    const plan2 = createPlan({ name: "Downgrade To", price: 10, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan1.id,
      customer_name: "Downgrade Event",
      customer_email: "downgradeevent@example.com",
    });

    downgradeSubscriber(sub.id, plan2.id);

    const events = listEvents({ subscriber_id: sub.id });
    const downgradeEvent = events.find((e) => e.type === "downgraded");
    expect(downgradeEvent).toBeDefined();
    expect(downgradeEvent!.details).toHaveProperty("old_plan_id", plan1.id);
    expect(downgradeEvent!.details).toHaveProperty("new_plan_id", plan2.id);
  });

  test("record custom event", () => {
    const plan = createPlan({ name: "Custom Event Plan", price: 10, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Custom Event",
      customer_email: "customevent@example.com",
    });

    const event = recordEvent(sub.id, "payment_failed", { reason: "card_declined" });
    expect(event.type).toBe("payment_failed");
    expect(event.details).toEqual({ reason: "card_declined" });
  });

  test("list events by type", () => {
    const events = listEvents({ type: "created" });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.type === "created")).toBe(true);
  });
});

describe("Analytics", () => {
  test("MRR calculation with monthly plans", () => {
    // Create a fresh plan and subscriber for controlled MRR test
    const plan = createPlan({ name: "MRR Test Monthly", price: 50, interval: "monthly" });
    createSubscriber({
      plan_id: plan.id,
      customer_name: "MRR Monthly",
      customer_email: "mrr-monthly@example.com",
    });

    const mrr = getMrr();
    // MRR should include at least this subscriber's $50
    expect(mrr).toBeGreaterThanOrEqual(50);
  });

  test("MRR calculation with yearly plans divides by 12", () => {
    const plan = createPlan({ name: "MRR Test Yearly", price: 120, interval: "yearly" });
    const mrrBefore = getMrr();

    createSubscriber({
      plan_id: plan.id,
      customer_name: "MRR Yearly",
      customer_email: "mrr-yearly@example.com",
    });

    const mrrAfter = getMrr();
    // $120/year = $10/month MRR contribution
    expect(mrrAfter - mrrBefore).toBeCloseTo(10, 1);
  });

  test("MRR excludes lifetime plans", () => {
    const plan = createPlan({ name: "MRR Test Lifetime", price: 500, interval: "lifetime" });
    const mrrBefore = getMrr();

    createSubscriber({
      plan_id: plan.id,
      customer_name: "MRR Lifetime",
      customer_email: "mrr-lifetime@example.com",
    });

    const mrrAfter = getMrr();
    // Lifetime should not affect MRR
    expect(mrrAfter).toBe(mrrBefore);
  });

  test("MRR excludes canceled subscribers", () => {
    const plan = createPlan({ name: "MRR Cancel Test", price: 100, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "MRR Cancel",
      customer_email: "mrr-cancel@example.com",
    });

    const mrrBefore = getMrr();
    cancelSubscriber(sub.id);
    const mrrAfter = getMrr();

    expect(mrrAfter).toBe(mrrBefore - 100);
  });

  test("ARR is MRR * 12", () => {
    const mrr = getMrr();
    const arr = getArr();
    expect(arr).toBeCloseTo(mrr * 12, 1);
  });

  test("churn rate with no canceled subscribers is low", () => {
    // With many active and few canceled in the recent period, churn should be calculable
    const rate = getChurnRate(30);
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(100);
  });

  test("churn rate increases after cancellation", () => {
    const plan = createPlan({ name: "Churn Test Plan", price: 10, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Churn Test",
      customer_email: "churn@example.com",
    });

    const rateBefore = getChurnRate(30);
    cancelSubscriber(sub.id);
    const rateAfter = getChurnRate(30);

    expect(rateAfter).toBeGreaterThanOrEqual(rateBefore);
  });

  test("subscriber stats returns counts by status", () => {
    const stats = getSubscriberStats();

    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("active");
    expect(stats).toHaveProperty("trialing");
    expect(stats).toHaveProperty("past_due");
    expect(stats).toHaveProperty("canceled");
    expect(stats).toHaveProperty("expired");
    expect(stats).toHaveProperty("paused");
    expect(stats.total).toBe(
      stats.active + stats.trialing + stats.past_due + stats.canceled + stats.expired + stats.paused
    );
  });

  test("expiring list finds subscribers expiring within days", () => {
    const plan = createPlan({ name: "Expiring Test", price: 10, interval: "monthly" });

    // Create a subscriber with period_end 3 days from now
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const futureStr = futureDate.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Expiring Soon",
      customer_email: "expiring@example.com",
      current_period_end: futureStr,
    });

    const expiring7 = listExpiring(7);
    expect(expiring7.some((s) => s.id === sub.id)).toBe(true);

    const expiring1 = listExpiring(1);
    // 3 days out should NOT appear in 1-day window
    expect(expiring1.some((s) => s.id === sub.id)).toBe(false);
  });
});

describe("Subscription Pause/Resume", () => {
  test("pause an active subscriber", () => {
    const plan = createPlan({ name: "Pause Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Pause Test",
      customer_email: "pause@example.com",
    });

    const paused = pauseSubscriber(sub.id);
    expect(paused).toBeDefined();
    expect(paused!.status).toBe("paused");
  });

  test("pause with resume date", () => {
    const plan = createPlan({ name: "Pause Resume Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Pause Resume Test",
      customer_email: "pauseresume@example.com",
    });

    const resumeDate = "2099-06-01 00:00:00";
    const paused = pauseSubscriber(sub.id, resumeDate);
    expect(paused).toBeDefined();
    expect(paused!.status).toBe("paused");
    expect(paused!.resume_at).toBe(resumeDate);
  });

  test("resume a paused subscriber", () => {
    const plan = createPlan({ name: "Resume Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Resume Test",
      customer_email: "resume@example.com",
    });

    pauseSubscriber(sub.id);
    const resumed = resumeSubscriber(sub.id);
    expect(resumed).toBeDefined();
    expect(resumed!.status).toBe("active");
    expect(resumed!.resume_at).toBeNull();
  });

  test("cannot pause canceled subscriber", () => {
    const plan = createPlan({ name: "Pause Cancel Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Pause Cancel",
      customer_email: "pausecancel@example.com",
    });
    cancelSubscriber(sub.id);

    const result = pauseSubscriber(sub.id);
    expect(result).toBeNull();
  });

  test("cannot resume non-paused subscriber", () => {
    const plan = createPlan({ name: "Resume Active Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Resume Active",
      customer_email: "resumeactive@example.com",
    });

    const result = resumeSubscriber(sub.id);
    expect(result).toBeNull();
  });

  test("paused subscriber excluded from MRR", () => {
    const plan = createPlan({ name: "Pause MRR Plan", price: 75, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Pause MRR",
      customer_email: "pausemrr@example.com",
    });

    const mrrBefore = getMrr();
    pauseSubscriber(sub.id);
    const mrrAfter = getMrr();

    expect(mrrAfter).toBe(mrrBefore - 75);
  });

  test("pause and resume events are recorded", () => {
    const plan = createPlan({ name: "Pause Event Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Pause Event",
      customer_email: "pauseevent@example.com",
    });

    pauseSubscriber(sub.id);
    resumeSubscriber(sub.id);

    const events = listEvents({ subscriber_id: sub.id });
    expect(events.some((e) => e.type === "paused")).toBe(true);
    expect(events.some((e) => e.type === "resumed")).toBe(true);
  });

  test("pause nonexistent subscriber returns null", () => {
    expect(pauseSubscriber("nonexistent-id")).toBeNull();
  });
});

describe("Trial Extension", () => {
  test("extend trial for subscriber with existing trial", () => {
    const plan = createPlan({ name: "Trial Extend Plan", price: 20, interval: "monthly" });
    const trialEnd = "2099-01-15 00:00:00";
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Trial Extend",
      customer_email: "trialextend@example.com",
      status: "trialing",
      trial_ends_at: trialEnd,
    });

    const extended = extendTrial(sub.id, 7);
    expect(extended).toBeDefined();
    expect(extended!.status).toBe("trialing");
    // Should be 7 days after the original trial end
    expect(extended!.trial_ends_at).toBe("2099-01-22 00:00:00");
  });

  test("extend trial for subscriber without trial sets from now", () => {
    const plan = createPlan({ name: "Trial No Trial Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "No Trial Extend",
      customer_email: "notrialextend@example.com",
    });

    const extended = extendTrial(sub.id, 14);
    expect(extended).toBeDefined();
    expect(extended!.status).toBe("trialing");
    expect(extended!.trial_ends_at).toBeTruthy();
  });

  test("extend trial records event", () => {
    const plan = createPlan({ name: "Trial Event Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Trial Event",
      customer_email: "trialevent@example.com",
      status: "trialing",
      trial_ends_at: "2099-01-01 00:00:00",
    });

    extendTrial(sub.id, 5);

    const events = listEvents({ subscriber_id: sub.id });
    const trialEvent = events.find((e) => e.type === "trial_extended");
    expect(trialEvent).toBeDefined();
    expect(trialEvent!.details).toHaveProperty("days", 5);
  });

  test("extend trial for nonexistent subscriber returns null", () => {
    expect(extendTrial("nonexistent", 7)).toBeNull();
  });
});

describe("Dunning", () => {
  test("create dunning attempt", () => {
    const plan = createPlan({ name: "Dunning Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Dunning Test",
      customer_email: "dunning@example.com",
    });

    const attempt = createDunning({ subscriber_id: sub.id });
    expect(attempt.id).toBeTruthy();
    expect(attempt.subscriber_id).toBe(sub.id);
    expect(attempt.attempt_number).toBe(1);
    expect(attempt.status).toBe("pending");
  });

  test("create dunning with custom fields", () => {
    const plan = createPlan({ name: "Dunning Custom Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Dunning Custom",
      customer_email: "dunningcustom@example.com",
    });

    const retryDate = "2099-06-01 12:00:00";
    const attempt = createDunning({
      subscriber_id: sub.id,
      attempt_number: 3,
      status: "retrying",
      next_retry_at: retryDate,
    });

    expect(attempt.attempt_number).toBe(3);
    expect(attempt.status).toBe("retrying");
    expect(attempt.next_retry_at).toBe(retryDate);
  });

  test("get dunning attempt", () => {
    const plan = createPlan({ name: "Dunning Get Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Dunning Get",
      customer_email: "dunningget@example.com",
    });

    const created = createDunning({ subscriber_id: sub.id });
    const fetched = getDunning(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
  });

  test("list dunning attempts", () => {
    const attempts = listDunning();
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });

  test("list dunning by subscriber", () => {
    const plan = createPlan({ name: "Dunning List Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Dunning List",
      customer_email: "dunninglist@example.com",
    });

    createDunning({ subscriber_id: sub.id, attempt_number: 1 });
    createDunning({ subscriber_id: sub.id, attempt_number: 2 });

    const attempts = listDunning({ subscriber_id: sub.id });
    expect(attempts.length).toBe(2);
    expect(attempts.every((a) => a.subscriber_id === sub.id)).toBe(true);
  });

  test("list dunning by status", () => {
    const pending = listDunning({ status: "pending" });
    expect(pending.every((a) => a.status === "pending")).toBe(true);
  });

  test("update dunning attempt", () => {
    const plan = createPlan({ name: "Dunning Update Plan", price: 20, interval: "monthly" });
    const sub = createSubscriber({
      plan_id: plan.id,
      customer_name: "Dunning Update",
      customer_email: "dunningupdate@example.com",
    });

    const attempt = createDunning({ subscriber_id: sub.id });
    const updated = updateDunning(attempt.id, {
      status: "recovered",
      next_retry_at: null,
    });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("recovered");
    expect(updated!.next_retry_at).toBeNull();
  });

  test("update nonexistent dunning returns null", () => {
    expect(updateDunning("nonexistent", { status: "failed" })).toBeNull();
  });

  test("get nonexistent dunning returns null", () => {
    expect(getDunning("nonexistent")).toBeNull();
  });
});

describe("Bulk Import/Export", () => {
  test("bulk import subscribers", () => {
    const plan = createPlan({ name: "Import Plan", price: 15, interval: "monthly" });

    const imported = bulkImportSubscribers([
      { plan_id: plan.id, customer_name: "Import A", customer_email: "importa@example.com" },
      { plan_id: plan.id, customer_name: "Import B", customer_email: "importb@example.com" },
      { plan_id: plan.id, customer_name: "Import C", customer_email: "importc@example.com" },
    ]);

    expect(imported.length).toBe(3);
    expect(imported[0].customer_name).toBe("Import A");
    expect(imported[1].customer_name).toBe("Import B");
    expect(imported[2].customer_name).toBe("Import C");
    expect(imported.every((s) => s.status === "active")).toBe(true);
  });

  test("export subscribers as JSON", () => {
    const output = exportSubscribers("json");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("customer_name");
    expect(parsed[0]).toHaveProperty("customer_email");
  });

  test("export subscribers as CSV", () => {
    const output = exportSubscribers("csv");
    const lines = output.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // First line should be headers
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("customer_name");
    expect(lines[0]).toContain("customer_email");
  });

  test("parse import CSV", () => {
    const csv = `plan_id,customer_name,customer_email,status
abc123,John Doe,john@example.com,active
def456,Jane Smith,jane@example.com,trialing`;

    const parsed = parseImportCsv(csv);
    expect(parsed.length).toBe(2);
    expect(parsed[0].customer_name).toBe("John Doe");
    expect(parsed[0].plan_id).toBe("abc123");
    expect(parsed[1].customer_name).toBe("Jane Smith");
    expect(parsed[1].status).toBe("trialing");
  });

  test("parse import CSV skips invalid rows", () => {
    const csv = `plan_id,customer_name,customer_email
abc123,John Doe,john@example.com
,,`;

    const parsed = parseImportCsv(csv);
    expect(parsed.length).toBe(1);
  });

  test("parse empty CSV returns empty array", () => {
    const parsed = parseImportCsv("");
    expect(parsed.length).toBe(0);
  });
});

describe("LTV Calculation", () => {
  test("LTV includes active subscribers", () => {
    const plan = createPlan({ name: "LTV Plan", price: 30, interval: "monthly" });
    createSubscriber({
      plan_id: plan.id,
      customer_name: "LTV Person",
      customer_email: "ltv@example.com",
    });

    const result = getLtv();
    expect(result.subscribers.length).toBeGreaterThan(0);
    expect(result.average_ltv).toBeGreaterThan(0);
  });

  test("LTV returns correct fields per subscriber", () => {
    const result = getLtv();
    const sub = result.subscribers[0];
    expect(sub).toHaveProperty("subscriber_id");
    expect(sub).toHaveProperty("customer_name");
    expect(sub).toHaveProperty("customer_email");
    expect(sub).toHaveProperty("plan_name");
    expect(sub).toHaveProperty("plan_price");
    expect(sub).toHaveProperty("plan_interval");
    expect(sub).toHaveProperty("months_active");
    expect(sub).toHaveProperty("ltv");
    expect(sub.months_active).toBeGreaterThanOrEqual(1);
    expect(sub.ltv).toBeGreaterThanOrEqual(0);
  });

  test("LTV for lifetime plans is plan price", () => {
    const plan = createPlan({ name: "LTV Lifetime Plan", price: 500, interval: "lifetime" });
    createSubscriber({
      plan_id: plan.id,
      customer_name: "LTV Lifetime",
      customer_email: "ltvlifetime@example.com",
    });

    const result = getLtv();
    const lifetimeSub = result.subscribers.find((s) => s.customer_email === "ltvlifetime@example.com");
    expect(lifetimeSub).toBeDefined();
    expect(lifetimeSub!.ltv).toBe(500);
  });
});

describe("NRR Calculation", () => {
  test("NRR returns correct structure", () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const result = getNrr(month);
    expect(result).toHaveProperty("month", month);
    expect(result).toHaveProperty("start_mrr");
    expect(result).toHaveProperty("expansion");
    expect(result).toHaveProperty("contraction");
    expect(result).toHaveProperty("churn");
    expect(result).toHaveProperty("nrr");
    expect(typeof result.nrr).toBe("number");
  });

  test("NRR for empty month returns zero", () => {
    const result = getNrr("2020-01");
    expect(result.start_mrr).toBe(0);
    expect(result.nrr).toBe(0);
  });

  test("NRR expansion and contraction are non-negative", () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const result = getNrr(month);
    expect(result.expansion).toBeGreaterThanOrEqual(0);
    expect(result.contraction).toBeGreaterThanOrEqual(0);
    expect(result.churn).toBeGreaterThanOrEqual(0);
  });
});

describe("Cohort Analysis", () => {
  test("cohort report returns correct number of months", () => {
    const report = getCohortReport(3);
    expect(report.length).toBe(3);
  });

  test("cohort report returns correct structure", () => {
    const report = getCohortReport(1);
    expect(report.length).toBe(1);
    const cohort = report[0];
    expect(cohort).toHaveProperty("cohort");
    expect(cohort).toHaveProperty("total");
    expect(cohort).toHaveProperty("retained");
    expect(cohort).toHaveProperty("retention_rate");
    expect(typeof cohort.retention_rate).toBe("number");
  });

  test("cohort report current month has subscribers", () => {
    const report = getCohortReport(1);
    // We've been creating subscribers in this month's tests
    expect(report[0].total).toBeGreaterThan(0);
  });

  test("cohort retention rate is between 0 and 100", () => {
    const report = getCohortReport(6);
    for (const cohort of report) {
      if (cohort.total > 0) {
        expect(cohort.retention_rate).toBeGreaterThanOrEqual(0);
        expect(cohort.retention_rate).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("Plan Comparison", () => {
  test("compare two plans", () => {
    const plan1 = createPlan({
      name: "Compare Basic",
      price: 10,
      interval: "monthly",
      features: ["email", "chat", "reports"],
    });
    const plan2 = createPlan({
      name: "Compare Pro",
      price: 25,
      interval: "monthly",
      features: ["email", "chat", "phone", "priority"],
    });

    const result = comparePlans(plan1.id, plan2.id);
    expect(result).toBeDefined();
    expect(result!.plan1.name).toBe("Compare Basic");
    expect(result!.plan2.name).toBe("Compare Pro");
    expect(result!.price_diff).toBe(15);
    expect(result!.price_diff_pct).toBe(150);
    expect(result!.common_features).toEqual(["email", "chat"]);
    expect(result!.features_only_in_plan1).toEqual(["reports"]);
    expect(result!.features_only_in_plan2).toEqual(["phone", "priority"]);
    expect(result!.interval_match).toBe(true);
  });

  test("compare plans with different intervals", () => {
    const plan1 = createPlan({ name: "Compare Monthly", price: 10, interval: "monthly" });
    const plan2 = createPlan({ name: "Compare Yearly", price: 100, interval: "yearly" });

    const result = comparePlans(plan1.id, plan2.id);
    expect(result).toBeDefined();
    expect(result!.interval_match).toBe(false);
  });

  test("compare nonexistent plan returns null", () => {
    const plan = createPlan({ name: "Compare Exists", price: 10, interval: "monthly" });
    expect(comparePlans(plan.id, "nonexistent")).toBeNull();
    expect(comparePlans("nonexistent", plan.id)).toBeNull();
  });

  test("compare plans with no features", () => {
    const plan1 = createPlan({ name: "Compare No Feat 1", price: 10, interval: "monthly" });
    const plan2 = createPlan({ name: "Compare No Feat 2", price: 20, interval: "monthly" });

    const result = comparePlans(plan1.id, plan2.id);
    expect(result).toBeDefined();
    expect(result!.common_features).toEqual([]);
    expect(result!.features_only_in_plan1).toEqual([]);
    expect(result!.features_only_in_plan2).toEqual([]);
  });
});

describe("Expiring Renewals", () => {
  test("expiring renewals returns same as listExpiring", () => {
    const plan = createPlan({ name: "Renewal Plan", price: 20, interval: "monthly" });

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const futureStr = futureDate.toISOString().replace("T", " ").replace("Z", "").split(".")[0];

    createSubscriber({
      plan_id: plan.id,
      customer_name: "Renewal Test",
      customer_email: "renewal@example.com",
      current_period_end: futureStr,
    });

    const renewals = getExpiringRenewals(7);
    const expiring = listExpiring(7);
    expect(renewals.length).toBe(expiring.length);
  });

  test("expiring renewals with 0 days returns empty", () => {
    const renewals = getExpiringRenewals(0);
    expect(renewals.length).toBe(0);
  });
});
