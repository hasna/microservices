/**
 * Prompt injection detection.
 */

export interface InjectionResult {
  detected: boolean;
  confidence: number;
  patterns: string[];
}

const INJECTION_PATTERNS: { pattern: RegExp; name: string; weight: number }[] = [
  // Instruction override attempts
  { pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|context)/i, name: "ignore_previous_instructions", weight: 0.4 },
  { pattern: /disregard\s+(?:all\s+)?(?:above|previous|prior|earlier)/i, name: "disregard_above", weight: 0.4 },
  { pattern: /forget\s+everything/i, name: "forget_everything", weight: 0.35 },
  { pattern: /do\s+not\s+follow\s+(?:the\s+)?(?:above|previous|prior|earlier)/i, name: "do_not_follow", weight: 0.35 },

  // Role hijacking
  { pattern: /you\s+are\s+now\s+(?:a\s+)?/i, name: "role_hijack_you_are_now", weight: 0.3 },
  { pattern: /new\s+instructions?\s*:/i, name: "new_instructions", weight: 0.35 },
  { pattern: /^system\s*:/im, name: "system_prefix", weight: 0.35 },
  { pattern: /SYSTEM\s+OVERRIDE/i, name: "system_override", weight: 0.4 },

  // Markdown/HTML injection
  { pattern: /<script\b[^>]*>/i, name: "html_script_injection", weight: 0.3 },
  { pattern: /<iframe\b[^>]*>/i, name: "html_iframe_injection", weight: 0.3 },
  { pattern: /javascript\s*:/i, name: "javascript_protocol", weight: 0.25 },

  // Encoding tricks
  { pattern: /&#x?[0-9a-fA-F]+;/i, name: "html_entity_encoding", weight: 0.15 },
  { pattern: /%[0-9a-fA-F]{2}(?:%[0-9a-fA-F]{2}){5,}/i, name: "url_encoding_excessive", weight: 0.2 },

  // Base64 encoded instructions (blocks of base64 > 40 chars)
  { pattern: /[A-Za-z0-9+/]{40,}={0,2}/i, name: "base64_encoded_block", weight: 0.2 },

  // Jailbreak patterns
  { pattern: /\bDAN\s+mode\b/i, name: "dan_mode", weight: 0.35 },
  { pattern: /\bjailbreak\b/i, name: "jailbreak_keyword", weight: 0.25 },
  { pattern: /pretend\s+(?:you(?:'re|\s+are)\s+)?(?:not\s+)?(?:an?\s+)?AI/i, name: "pretend_not_ai", weight: 0.3 },
];

/**
 * Detect prompt injection attempts in text.
 * Returns confidence 0.0-1.0 based on patterns matched.
 */
export function detectPromptInjection(text: string): InjectionResult {
  const matched: string[] = [];
  let totalWeight = 0;

  for (const { pattern, name, weight } of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(name);
      totalWeight += weight;
    }
  }

  // Cap confidence at 1.0
  const confidence = Math.min(totalWeight, 1.0);

  return {
    detected: confidence >= 0.3,
    confidence: Math.round(confidence * 100) / 100,
    patterns: matched,
  };
}
