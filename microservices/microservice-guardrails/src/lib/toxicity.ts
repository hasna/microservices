/**
 * Keyword-based toxicity detection (no API calls).
 */

// Minimal representative lists — production systems should use larger curated lists
const PROFANITY_WORDS = [
  "fuck", "shit", "damn", "bastard", "asshole", "bitch", "crap",
  "dick", "piss", "cunt", "cock", "motherfucker", "bullshit",
];

const SLUR_WORDS = [
  "nigger", "nigga", "faggot", "fag", "retard", "retarded",
  "kike", "spic", "chink", "wetback", "tranny",
];

const THREAT_PATTERNS = [
  /\bi(?:'?ll| will)\s+kill\s+you\b/i,
  /\bi(?:'?ll| will)\s+hurt\s+you\b/i,
  /\byou(?:'re|\s+are)\s+(?:gonna\s+)?die\b/i,
  /\bi(?:'?ll| will)\s+find\s+(?:you|where\s+you\s+live)\b/i,
  /\bdeath\s+threat\b/i,
  /\bkill\s+(?:your)?self\b/i,
  /\byou\s+deserve\s+to\s+die\b/i,
];

const HARASSMENT_PATTERNS = [
  /\bkill\s+yourself\b/i,
  /\bgo\s+die\b/i,
  /\bnobody\s+(?:loves|likes|cares\s+about)\s+you\b/i,
  /\byou(?:'re|\s+are)\s+(?:worthless|pathetic|disgusting|trash|garbage)\b/i,
  /\bshut\s+(?:the\s+fuck\s+)?up\b/i,
];

function wordBoundaryMatch(text: string, word: string): boolean {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(text);
}

/**
 * Check text for toxic content using keyword and pattern matching.
 * Returns categories like 'profanity', 'slur', 'threat', 'harassment'.
 * Score 0.0-1.0.
 */
export function checkToxicity(text: string): {
  toxic: boolean;
  score: number;
  categories: string[];
} {
  const categories: string[] = [];
  let score = 0;

  // Profanity check
  const profanityCount = PROFANITY_WORDS.filter((w) => wordBoundaryMatch(text, w)).length;
  if (profanityCount > 0) {
    categories.push("profanity");
    score += Math.min(profanityCount * 0.15, 0.4);
  }

  // Slur check
  const slurCount = SLUR_WORDS.filter((w) => wordBoundaryMatch(text, w)).length;
  if (slurCount > 0) {
    categories.push("slur");
    score += Math.min(slurCount * 0.3, 0.6);
  }

  // Threat check
  const threatCount = THREAT_PATTERNS.filter((p) => p.test(text)).length;
  if (threatCount > 0) {
    categories.push("threat");
    score += Math.min(threatCount * 0.25, 0.5);
  }

  // Harassment check
  const harassmentCount = HARASSMENT_PATTERNS.filter((p) => p.test(text)).length;
  if (harassmentCount > 0) {
    categories.push("harassment");
    score += Math.min(harassmentCount * 0.2, 0.4);
  }

  score = Math.min(score, 1.0);
  score = Math.round(score * 100) / 100;

  return {
    toxic: score >= 0.3,
    score,
    categories,
  };
}
