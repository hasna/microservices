/**
 * PII (Personally Identifiable Information) detection and redaction.
 */

export interface PIIMatch {
  type: string;
  value: string;
  start: number;
  end: number;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_US_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const PHONE_INTL_RE = /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CC_RE = /\b(\d[ -]?){13,19}\b/g;
// IPv4: 0.0.0.0 - 255.255.255.255
const IP_V4_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
// IPv6: full and compressed forms
const IP_V6_RE =
  /\b(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::)\b/gi;
const ZIP_US_RE = /\b\d{5}(?:-\d{4})?\b/g;
// Date of birth in multiple formats: MM/DD/YYYY, YYYY-MM-DD, YYYY/MM/DD, Month DD, YYYY
const DOB_RE =
  /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-\/](?:0[1-9]|1[0-2])[-\/](?:0[1-9]|[12]\d|3[01])\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:0?[1-9]|[12]\d|3[01]),?\s+(?:19|20)\d{2}\b|\b(?:0?[1-9]|[12]\d|3[01])\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:19|20)\d{2}\b/gi;
// US license plates: various formats (AAA-1234, A123456, ABC-123, etc.)
const LICENSE_PLATE_US_RE =
  /\b[A-Z]{1,3}[-\s]?[0-9][-\s]?[A-Z]{0,2}[-\s]?[0-9]{0,4}\b|\b[0-9]{1,4}[-\s]?[A-Z]{1,3}[-\s]?[A-Z]{0,3}\b/g;
// EU license plates: country-specific patterns (e.g., DE: B-AB 1234, FR: AB-123-CD)
const LICENSE_PLATE_EU_RE =
  /\b[A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}\b|\b[A-Z]{1,3}[-\s]?[0-9]{1,4}[-\s]?[A-Z]{0,2}\b/g;
// NPI (National Provider Identifier) — US medical license: 10 digits starting with non-zero
const MEDICAL_LICENSE_NPI_RE = /\b[1-9]\d{9}\b/g;

/**
 * Luhn algorithm — validates credit card numbers.
 */
function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i]!, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function findMatches(text: string, regex: RegExp, type: string): PIIMatch[] {
  const matches: PIIMatch[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(regex.source, regex.flags);
  while ((m = re.exec(text)) !== null) {
    matches.push({
      type,
      value: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return matches;
}

/**
 * Scan text for PII patterns. Returns all matches with positions.
 */
export function scanPII(text: string): PIIMatch[] {
  const matches: PIIMatch[] = [];

  matches.push(...findMatches(text, EMAIL_RE, "email"));
  matches.push(...findMatches(text, SSN_RE, "ssn"));

  // Credit cards: find candidates then Luhn-validate
  const ccCandidates = findMatches(text, CC_RE, "credit_card");
  for (const cc of ccCandidates) {
    if (luhnCheck(cc.value)) {
      matches.push(cc);
    }
  }

  // Phone: US format then international (deduplicate overlapping)
  const phoneMatches = [
    ...findMatches(text, PHONE_US_RE, "phone"),
    ...findMatches(text, PHONE_INTL_RE, "phone"),
  ];
  // Deduplicate overlapping phone matches
  const seen = new Set<string>();
  for (const p of phoneMatches) {
    const key = `${p.start}:${p.end}`;
    if (!seen.has(key)) {
      // Filter out short digit-only matches that aren't real phone numbers
      const digits = p.value.replace(/\D/g, "");
      if (digits.length >= 7) {
        seen.add(key);
        matches.push(p);
      }
    }
  }

  // IPv4
  matches.push(...findMatches(text, IP_V4_RE, "ip_address"));
  // IPv6
  matches.push(...findMatches(text, IP_V6_RE, "ip_address"));

  // ZIP codes: only match if not already part of another match (SSN, CC, phone)
  const zipCandidates = findMatches(text, ZIP_US_RE, "zip_code");
  for (const z of zipCandidates) {
    const overlaps = matches.some((m) => z.start >= m.start && z.end <= m.end);
    if (!overlaps) {
      matches.push(z);
    }
  }

  // Date of birth (multiple formats)
  matches.push(...findMatches(text, DOB_RE, "date_of_birth"));

  // US license plates
  matches.push(...findMatches(text, LICENSE_PLATE_US_RE, "license_plate"));
  // EU license plates
  matches.push(...findMatches(text, LICENSE_PLATE_EU_RE, "license_plate"));

  // Medical license (NPI numbers)
  matches.push(...findMatches(text, MEDICAL_LICENSE_NPI_RE, "medical_license"));

  // Sort by position
  matches.sort((a, b) => a.start - b.start);

  return matches;
}

/**
 * Redact PII from text, replacing each match with [REDACTED_TYPE].
 */
export function redactPII(text: string, matches: PIIMatch[]): string {
  if (matches.length === 0) return text;

  // Sort by start position descending so replacements don't shift indices
  const sorted = [...matches].sort((a, b) => b.start - a.start);

  let result = text;
  for (const m of sorted) {
    const label = `[REDACTED_${m.type.toUpperCase()}]`;
    result = result.slice(0, m.start) + label + result.slice(m.end);
  }

  return result;
}

// ---- Full PII inspection ----------------------------------------------------

export interface FullPIIMatch extends PIIMatch {
  category: string;
  description: string;
}

const PII_CATEGORIES: Record<string, { category: string; description: string }> = {
  email: {
    category: "contact",
    description: "Email address",
  },
  phone: {
    category: "contact",
    description: "Phone number (US and international)",
  },
  ssn: {
    category: "government_id",
    description: "US Social Security Number",
  },
  credit_card: {
    category: "financial",
    description: "Credit card number (Luhn-validated)",
  },
  ip_address: {
    category: "digital_identity",
    description: "IP address (IPv4 and IPv6)",
  },
  zip_code: {
    category: "location",
    description: "US ZIP code",
  },
  date_of_birth: {
    category: "demographic",
    description: "Date of birth in various formats",
  },
  license_plate: {
    category: "vehicle",
    description: "Vehicle license plate (US and EU formats)",
  },
  medical_license: {
    category: "healthcare",
    description: "Medical license / NPI number",
  },
};

/**
 * Full PII inspection — returns all PII matches with category and description.
 */
export function inspectFull(text: string): {
  matches: FullPIIMatch[];
  summary: Record<string, { count: number; category: string; description: string }>;
  total: number;
} {
  const matches = scanPII(text);

  const fullMatches: FullPIIMatch[] = matches.map((m) => {
    const meta = PII_CATEGORIES[m.type] ?? {
      category: "unknown",
      description: "Unknown PII type",
    };
    return {
      ...m,
      category: meta.category,
      description: meta.description,
    };
  });

  // Build summary by type
  const summary: Record<
    string,
    { count: number; category: string; description: string }
  > = {};
  for (const m of fullMatches) {
    if (!summary[m.type]) {
      summary[m.type] = {
        count: 0,
        category: m.category,
        description: m.description,
      };
    }
    summary[m.type]!.count++;
  }

  return {
    matches: fullMatches,
    summary,
    total: fullMatches.length,
  };
}

/**
 * Detect IP addresses specifically (IPv4 and IPv6).
 */
export function detectIPAddress(text: string): PIIMatch[] {
  return [
    ...findMatches(text, IP_V4_RE, "ip_address"),
    ...findMatches(text, IP_V6_RE, "ip_address"),
  ];
}

/**
 * Detect dates of birth in various formats.
 */
export function detectDateOfBirth(text: string): PIIMatch[] {
  return findMatches(text, DOB_RE, "date_of_birth");
}

/**
 * Detect license plates (US and EU formats).
 */
export function detectLicensePlate(text: string): PIIMatch[] {
  return [
    ...findMatches(text, LICENSE_PLATE_US_RE, "license_plate"),
    ...findMatches(text, LICENSE_PLATE_EU_RE, "license_plate"),
  ];
}

/**
 * Detect medical licenses (NPI numbers).
 */
export function detectMedicalLicense(text: string): PIIMatch[] {
  return findMatches(text, MEDICAL_LICENSE_NPI_RE, "medical_license");
}
