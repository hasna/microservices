import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "ms-timesheets-locale-" + Date.now() + "-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import { closeDatabase } from "./database";
closeDatabase();

import {
  getCountryDefaults,
  listSupportedCountries,
  getSetting,
  setSetting,
  getAllSettings,
  formatCurrency,
  checkOvertimeStatus,
  COUNTRY_DEFAULTS,
} from "./locale";
import { createProject } from "./timesheets";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Country Defaults", () => {
  test("Romania: RON, 8h/day, 40h/week, 1.75x overtime", () => {
    const ro = getCountryDefaults("RO");
    expect(ro.currency).toBe("RON");
    expect(ro.max_daily_hours).toBe(8);
    expect(ro.max_weekly_hours).toBe(40);
    expect(ro.overtime_multiplier).toBe(1.75);
    expect(ro.date_format).toBe("DD.MM.YYYY");
    expect(ro.locale).toBe("ro-RO");
    expect(ro.week_start).toBe("monday");
  });

  test("US: USD, 8h/day, 40h/week, 1.5x overtime", () => {
    const us = getCountryDefaults("US");
    expect(us.currency).toBe("USD");
    expect(us.overtime_multiplier).toBe(1.5);
    expect(us.date_format).toBe("MM/DD/YYYY");
    expect(us.week_start).toBe("sunday");
  });

  test("UK: GBP, 48h/week max", () => {
    const gb = getCountryDefaults("GB");
    expect(gb.currency).toBe("GBP");
    expect(gb.max_weekly_hours).toBe(48);
  });

  test("France: 35h/week, 7h/day", () => {
    const fr = getCountryDefaults("FR");
    expect(fr.max_weekly_hours).toBe(35);
    expect(fr.max_daily_hours).toBe(7);
  });

  test("Germany: EUR, 48h/week max", () => {
    const de = getCountryDefaults("DE");
    expect(de.currency).toBe("EUR");
    expect(de.max_weekly_hours).toBe(48);
  });

  test("unknown country falls back to US", () => {
    const xx = getCountryDefaults("XX");
    expect(xx.currency).toBe("USD");
  });

  test("list all supported countries", () => {
    const countries = listSupportedCountries();
    expect(countries.length).toBe(Object.keys(COUNTRY_DEFAULTS).length);
    expect(countries.some(c => c.code === "RO")).toBe(true);
    expect(countries.some(c => c.code === "US")).toBe(true);
    expect(countries.some(c => c.code === "GB")).toBe(true);
  });
});

describe("Overtime Detection", () => {
  test("no overtime when under limits", () => {
    const result = checkOvertimeStatus(7, 35, "RO");
    expect(result.daily_overtime).toBe(false);
    expect(result.weekly_overtime).toBe(false);
    expect(result.daily_excess).toBe(0);
    expect(result.weekly_excess).toBe(0);
  });

  test("daily overtime in Romania (>8h)", () => {
    const result = checkOvertimeStatus(10, 35, "RO");
    expect(result.daily_overtime).toBe(true);
    expect(result.daily_excess).toBe(2);
    expect(result.overtime_rate).toBe(1.75);
  });

  test("weekly overtime in US (>40h)", () => {
    const result = checkOvertimeStatus(8, 45, "US");
    expect(result.weekly_overtime).toBe(true);
    expect(result.weekly_excess).toBe(5);
    expect(result.overtime_rate).toBe(1.5);
  });

  test("France overtime kicks in earlier (>35h/week, >7h/day)", () => {
    const result = checkOvertimeStatus(8, 36, "FR");
    expect(result.daily_overtime).toBe(true);
    expect(result.daily_excess).toBe(1);
    expect(result.weekly_overtime).toBe(true);
    expect(result.weekly_excess).toBe(1);
  });

  test("UK allows up to 48h/week before overtime", () => {
    const result = checkOvertimeStatus(8, 45, "GB");
    expect(result.weekly_overtime).toBe(false);
  });
});

describe("Settings", () => {
  test("get and set settings", () => {
    setSetting("locale", "ro-RO");
    expect(getSetting("locale")).toBe("ro-RO");
  });

  test("get all settings", () => {
    const all = getAllSettings();
    expect(all["locale"]).toBe("ro-RO");
    expect(all["default_currency"]).toBe("USD");
  });

  test("update existing setting", () => {
    setSetting("default_currency", "RON");
    expect(getSetting("default_currency")).toBe("RON");
  });
});

describe("Currency Formatting", () => {
  test("format RON", () => {
    const formatted = formatCurrency(1500.5, "RON", "ro-RO");
    expect(formatted).toContain("1.500,50");
  });

  test("format USD", () => {
    const formatted = formatCurrency(1500.5, "USD", "en-US");
    expect(formatted).toContain("1,500.50");
  });

  test("format EUR with German locale", () => {
    const formatted = formatCurrency(1500.5, "EUR", "de-DE");
    expect(formatted).toContain("1.500,50");
  });

  test("format GBP", () => {
    const formatted = formatCurrency(1500.5, "GBP", "en-GB");
    expect(formatted).toContain("1,500.50");
  });
});

describe("Projects with Locale", () => {
  test("create Romanian project with RON", () => {
    const proj = createProject({
      name: "Website Redesign",
      client: "SC Test SRL",
      hourly_rate: 200,
      budget_hours: 100,
    });
    expect(proj.name).toBe("Website Redesign");
    // New fields have defaults from migration
    expect(proj.currency).toBeDefined();
  });
});
