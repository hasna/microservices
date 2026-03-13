/**
 * Locale and country-specific settings for timesheets
 */

import { getDatabase } from "./database.js";

export interface CountryDefaults {
  currency: string;
  max_daily_hours: number;
  max_weekly_hours: number;
  overtime_multiplier: number;
  date_format: string;
  locale: string;
  week_start: "monday" | "sunday";
}

/**
 * Country-specific defaults for work hours and formatting
 */
export const COUNTRY_DEFAULTS: Record<string, CountryDefaults> = {
  // Romania
  RO: {
    currency: "RON",
    max_daily_hours: 8,
    max_weekly_hours: 40,
    overtime_multiplier: 1.75, // Romanian labor code: 75% bonus for first 2h overtime, 100% after
    date_format: "DD.MM.YYYY",
    locale: "ro-RO",
    week_start: "monday",
  },
  // United States
  US: {
    currency: "USD",
    max_daily_hours: 8,
    max_weekly_hours: 40,
    overtime_multiplier: 1.5, // FLSA: time and a half
    date_format: "MM/DD/YYYY",
    locale: "en-US",
    week_start: "sunday",
  },
  // United Kingdom
  GB: {
    currency: "GBP",
    max_daily_hours: 8,
    max_weekly_hours: 48, // UK Working Time Regulations
    overtime_multiplier: 1.5,
    date_format: "DD/MM/YYYY",
    locale: "en-GB",
    week_start: "monday",
  },
  // Germany
  DE: {
    currency: "EUR",
    max_daily_hours: 8,
    max_weekly_hours: 48, // can extend to 10h/day if averaged to 8h over 6 months
    overtime_multiplier: 1.25,
    date_format: "DD.MM.YYYY",
    locale: "de-DE",
    week_start: "monday",
  },
  // France
  FR: {
    currency: "EUR",
    max_daily_hours: 7, // 35h/week standard
    max_weekly_hours: 35,
    overtime_multiplier: 1.25, // 25% first 8h, 50% after
    date_format: "DD/MM/YYYY",
    locale: "fr-FR",
    week_start: "monday",
  },
  // Netherlands
  NL: {
    currency: "EUR",
    max_daily_hours: 8,
    max_weekly_hours: 40,
    overtime_multiplier: 1.5,
    date_format: "DD-MM-YYYY",
    locale: "nl-NL",
    week_start: "monday",
  },
  // Italy
  IT: {
    currency: "EUR",
    max_daily_hours: 8,
    max_weekly_hours: 40,
    overtime_multiplier: 1.25,
    date_format: "DD/MM/YYYY",
    locale: "it-IT",
    week_start: "monday",
  },
  // Spain
  ES: {
    currency: "EUR",
    max_daily_hours: 8,
    max_weekly_hours: 40,
    overtime_multiplier: 1.25,
    date_format: "DD/MM/YYYY",
    locale: "es-ES",
    week_start: "monday",
  },
  // Poland
  PL: {
    currency: "PLN",
    max_daily_hours: 8,
    max_weekly_hours: 40,
    overtime_multiplier: 1.5,
    date_format: "DD.MM.YYYY",
    locale: "pl-PL",
    week_start: "monday",
  },
  // Hungary
  HU: {
    currency: "HUF",
    max_daily_hours: 8,
    max_weekly_hours: 40,
    overtime_multiplier: 1.5,
    date_format: "YYYY.MM.DD",
    locale: "hu-HU",
    week_start: "monday",
  },
  // Sweden
  SE: {
    currency: "SEK",
    max_daily_hours: 8,
    max_weekly_hours: 40,
    overtime_multiplier: 1.5,
    date_format: "YYYY-MM-DD",
    locale: "sv-SE",
    week_start: "monday",
  },
  // Bulgaria
  BG: {
    currency: "BGN",
    max_daily_hours: 8,
    max_weekly_hours: 40,
    overtime_multiplier: 1.5,
    date_format: "DD.MM.YYYY",
    locale: "bg-BG",
    week_start: "monday",
  },
};

/**
 * Get defaults for a country, falling back to US
 */
export function getCountryDefaults(country: string): CountryDefaults {
  return COUNTRY_DEFAULTS[country.toUpperCase()] || COUNTRY_DEFAULTS["US"];
}

/**
 * List all supported countries
 */
export function listSupportedCountries(): { code: string; defaults: CountryDefaults }[] {
  return Object.entries(COUNTRY_DEFAULTS).map(([code, defaults]) => ({ code, defaults }));
}

// --- Settings ---

export function getSetting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value || null;
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  ).run(key, value, value);
}

export function getAllSettings(): Record<string, string> {
  const db = getDatabase();
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

/**
 * Format currency amount according to locale
 */
export function formatCurrency(amount: number, currency: string, locale?: string): string {
  const loc = locale || getSetting("locale") || "en-US";
  return new Intl.NumberFormat(loc, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Check if hours exceed daily/weekly limits for a country
 */
export function checkOvertimeStatus(
  dailyHours: number,
  weeklyHours: number,
  country: string
): {
  daily_overtime: boolean;
  weekly_overtime: boolean;
  daily_excess: number;
  weekly_excess: number;
  overtime_rate: number;
} {
  const defaults = getCountryDefaults(country);
  const dailyExcess = Math.max(0, dailyHours - defaults.max_daily_hours);
  const weeklyExcess = Math.max(0, weeklyHours - defaults.max_weekly_hours);

  return {
    daily_overtime: dailyExcess > 0,
    weekly_overtime: weeklyExcess > 0,
    daily_excess: dailyExcess,
    weekly_excess: weeklyExcess,
    overtime_rate: defaults.overtime_multiplier,
  };
}
