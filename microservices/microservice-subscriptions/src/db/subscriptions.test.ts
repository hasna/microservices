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
    expect(stats.total).toBe(
      stats.active + stats.trialing + stats.past_due + stats.canceled + stats.expired
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
