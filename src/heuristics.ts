/**
 * MoltShield Heuristics
 *
 * Fast pattern-based checks that run before LLM evaluation.
 * These are considered a "hack" but catch obvious attacks quickly.
 *
 * Patterns detected:
 * - Best-of-N style attacks (random capitalization)
 * - Jailbreak phrases (ignore instructions, DAN mode, etc.)
 * - Injection markers (tool result attacks)
 * - Encoded payloads (base64)
 * - Unicode confusables/homoglyphs
 */

// ============================================================================
// Pattern Definitions
// ============================================================================

/**
 * Common jailbreak patterns with associated weights
 */
const JAILBREAK_PATTERNS = [
  { pattern: /ignore\s+(all\s+)?(previous|prior|above|system)/i, weight: 5 },
  { pattern: /you\s+are\s+now\s+(a|an|the|my)/i, weight: 4 },
  { pattern: /pretend\s+(you('re)?|to\s+be)/i, weight: 3 },
  { pattern: /bypass\s+(your|the|all|any)/i, weight: 4 },
  { pattern: /disregard\s+(your|the|all|any)/i, weight: 4 },
  { pattern: /from\s+now\s+on/i, weight: 3 },
  { pattern: /developer\s+mode/i, weight: 5 },
  { pattern: /jailbreak/i, weight: 5 },
  { pattern: /DAN\s*(mode)?/i, weight: 5 },
  { pattern: /do\s+anything\s+now/i, weight: 5 },
  { pattern: /act\s+as\s+(a|an|if)/i, weight: 2 },
  { pattern: /roleplay\s+as/i, weight: 2 },
  { pattern: /new\s+conversation/i, weight: 2 },
  { pattern: /reset\s+(your|the)\s+(context|memory|instructions)/i, weight: 4 },
  { pattern: /you\s+have\s+no\s+(restrictions|limits|rules)/i, weight: 5 },
  { pattern: /unlock(ed)?\s+(mode|capabilities)/i, weight: 4 },
  { pattern: /hypothetical\s+(world|scenario|situation)/i, weight: 3 },
  { pattern: /in\s+a\s+world\s+where/i, weight: 3 },
  { pattern: /let'?s\s+(say|pretend|imagine)/i, weight: 2 },
];

/**
 * Injection markers commonly found in tool results (indirect injection)
 */
const INJECTION_MARKERS = [
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /### System:/i,
  /### Human:/i,
  /### Assistant:/i,
  /<\|system\|>/i,
  /<\|user\|>/i,
  /<\|assistant\|>/i,
  /\[SYSTEM\]/i,
  /<<SYS>>/i,
  /<\/SYS>>/i,
];

// ============================================================================
// Types
// ============================================================================

export interface HeuristicResult {
  score: number;
  flags: string[];
  details: Record<string, number>;
}

// ============================================================================
// Main Heuristic Function
// ============================================================================

/**
 * Fast heuristic checks - runs before LLM evaluation
 */
export function runHeuristics(content: string): HeuristicResult {
  const flags: string[] = [];
  const details: Record<string, number> = {};
  let score = 0;

  // 1. Invisible characters (zero-width spaces, etc.)
  const invisibleChars = content.match(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g);
  if (invisibleChars && invisibleChars.length > 2) {
    flags.push("invisible_characters");
    details.invisible_characters = invisibleChars.length;
    score += Math.min(invisibleChars.length, 5);
  }

  // 2. Excessive mixed case (Best-of-N signature)
  // Normalize legitimate camelCase (2+ lowercase before uppercase) to avoid false positives
  // "JavaScript" -> "Java Script", but "TeLl" stays "TeLl"
  const normalizedContent = content.replace(/([a-z]{2,})([A-Z])/g, "$1 $2");
  const words = normalizedContent.split(/\s+/).filter(w => w.length > 3);
  const mixedCaseWords = words.filter(w => {
    // Must have both upper and lower case
    if (!/[a-z]/.test(w) || !/[A-Z]/.test(w)) return false;
    // Allow standard capitalization (e.g., "Hello")
    if (/^[A-Z][a-z]+$/.test(w)) return false;
    return true;
  });
  const mixedCaseRatio = words.length > 0 ? mixedCaseWords.length / words.length : 0;
  if (mixedCaseRatio > 0.4) {
    flags.push("excessive_mixed_case");
    details.mixed_case_ratio = Math.round(mixedCaseRatio * 100);
    score += Math.round(mixedCaseRatio * 10);
  }

  // 3. Jailbreak patterns
  for (const { pattern, weight } of JAILBREAK_PATTERNS) {
    if (pattern.test(content)) {
      if (!flags.includes("jailbreak_pattern")) {
        flags.push("jailbreak_pattern");
      }
      details[`pattern_${pattern.source.slice(0, 20)}`] = weight;
      score += weight;
    }
  }

  // 4. Injection markers (critical for tool results)
  for (const marker of INJECTION_MARKERS) {
    if (marker.test(content)) {
      if (!flags.includes("injection_marker")) {
        flags.push("injection_marker");
      }
      score += 5;
      break;
    }
  }

  // 5. Base64 encoded content (potential payload)
  const base64Match = content.match(/[A-Za-z0-9+/]{30,}={0,2}/);
  if (base64Match) {
    flags.push("encoded_content");
    details.base64_length = base64Match[0].length;
    score += 4;
  }

  // 6. Unicode confusables/homoglyphs
  const confusables = content.match(/[\u0430-\u044F\u0410-\u042F\u03B1-\u03C9]/g);
  if (confusables && confusables.length > 3) {
    flags.push("unicode_confusables");
    details.confusables = confusables.length;
    score += 3;
  }

  // 7. Excessive punctuation (often used in attacks)
  const punctuationRatio = (content.match(/[!?]{2,}/g) || []).length;
  if (punctuationRatio > 3) {
    flags.push("excessive_punctuation");
    details.punctuation_clusters = punctuationRatio;
    score += 2;
  }

  return { score, flags, details };
}
