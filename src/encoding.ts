/**
 * MoltShield Encoding Detection & Decoding
 *
 * Detects and decodes common encoding schemes used to bypass filters:
 * - Base64, Base32, Hex
 * - ROT13, Caesar cipher variants
 * - Unicode escapes (\uXXXX, \xXX)
 * - URL encoding (%XX)
 * - HTML entities
 *
 * Design: Regex + entropy analysis (not ML - overkill for this task)
 * Target: <1ms detection, deterministic results
 */

// ============================================================================
// Types
// ============================================================================

export interface EncodingMatch {
  type: EncodingType;
  encoded: string;
  decoded: string;
  start: number;
  end: number;
  confidence: number;
}

export interface EncodingResult {
  hasEncoding: boolean;
  encodings: EncodingMatch[];
  decodedContent: string;      // Full content with encodings replaced
  recursiveDecodes: number;    // How many layers were decoded
  entropy: number;             // Original content entropy
}

export type EncodingType =
  | "base64"
  | "base32"
  | "hex"
  | "rot13"
  | "unicode_escape"
  | "url"
  | "html_entity"
  | "ascii_shift"
  | "zero_width"
  | "reverse"
  | "morse"
  | "binary"
  | "leet"
  | "braille"
  | "homoglyph";

// ============================================================================
// Constants
// ============================================================================

const MAX_RECURSIVE_DEPTH = 5;
const MIN_ENCODED_LENGTH = 8;  // Minimum length to consider as encoded

// Character sets for validation
const BASE64_CHARS = /^[A-Za-z0-9+/]+=*$/;
const BASE32_CHARS = /^[A-Z2-7]+=*$/i;
const HEX_CHARS = /^[0-9a-fA-F]+$/;

// ============================================================================
// Entropy Calculation
// ============================================================================

/**
 * Calculate Shannon entropy of a string (bits per character)
 * - Normal English text: ~4.0-4.5 bits/char
 * - Base64 encoded: ~5.9-6.0 bits/char
 * - Random data: ~8.0 bits/char
 */
export function calculateEntropy(str: string): number {
  if (!str || str.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Check if character distribution is suspiciously uniform
 * Encoded content typically has more uniform distribution than natural text
 */
function hasUniformDistribution(str: string, threshold = 0.7): boolean {
  if (str.length < 20) return false;

  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }

  const counts = Array.from(freq.values());
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length;
  const cv = Math.sqrt(variance) / mean;  // Coefficient of variation

  // Lower CV = more uniform distribution
  // Natural text: CV > 1.0, Base64: CV < 0.5
  return cv < threshold;
}

// ============================================================================
// Encoding Detection
// ============================================================================

/**
 * Detect Base64 encoded substrings
 */
function detectBase64(content: string): EncodingMatch[] {
  const matches: EncodingMatch[] = [];

  // Match potential base64: 12+ chars from base64 alphabet, optional padding
  // (12 chars = 9 decoded bytes, enough for short words)
  const regex = /[A-Za-z0-9+/]{12,}={0,2}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const encoded = match[0];

    // Try to decode
    try {
      // Pad to multiple of 4
      const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
      const decoded = atob(padded);

      // Validate decoded content is mostly printable ASCII or common whitespace
      const printableCount = (decoded.match(/[\x20-\x7E\n\r\t]/g) || []).length;
      const printableRatio = printableCount / decoded.length;
      if (printableRatio < 0.7) continue;

      // Reject if decoded looks like random garbage
      // Real text has repeated characters and common patterns
      const hasCommonChars = /[etaoinshrdlu ]/i.test(decoded);
      if (!hasCommonChars && decoded.length > 10) continue;

      // Calculate confidence based on multiple signals
      let confidence = 0.6;
      if (encoded.endsWith("=")) confidence += 0.2;  // Has padding
      if (printableRatio > 0.9) confidence += 0.1;
      if (/\s/.test(decoded)) confidence += 0.1;  // Has whitespace = likely text

      matches.push({
        type: "base64",
        encoded,
        decoded,
        start: match.index,
        end: match.index + encoded.length,
        confidence: Math.min(confidence, 1.0),
      });
    } catch {
      // Invalid base64, skip
    }
  }

  return matches;
}

/**
 * Detect hexadecimal encoded substrings
 */
function detectHex(content: string): EncodingMatch[] {
  const matches: EncodingMatch[] = [];

  // Match hex patterns: 0x prefix, \x sequences, or long hex strings
  const patterns: Array<{ regex: RegExp; type: "0x" | "\\x" | "raw" }> = [
    { regex: /0x([0-9a-fA-F]{2})+/g, type: "0x" },
    { regex: /(\\x[0-9a-fA-F]{2}){4,}/g, type: "\\x" },  // At least 4 \x sequences
    { regex: /(?<![a-zA-Z0-9])([0-9a-fA-F]{16,})(?![a-zA-Z0-9])/g, type: "raw" },
  ];

  for (const { regex, type } of patterns) {
    regex.lastIndex = 0;  // Reset regex state
    let match;
    while ((match = regex.exec(content)) !== null) {
      const encoded = match[0];
      let hexStr = encoded;

      // Strip prefix based on type
      if (type === "0x") {
        hexStr = hexStr.slice(2);
      } else if (type === "\\x") {
        hexStr = hexStr.replace(/\\x/g, "");
      }

      if (hexStr.length < MIN_ENCODED_LENGTH) continue;
      if (hexStr.length % 2 !== 0) continue;

      try {
        // Decode hex to string
        let decoded = "";
        for (let i = 0; i < hexStr.length; i += 2) {
          decoded += String.fromCharCode(parseInt(hexStr.slice(i, i + 2), 16));
        }

        // Validate decoded content
        const printableRatio = (decoded.match(/[\x20-\x7E]/g) || []).length / decoded.length;
        if (printableRatio < 0.6) continue;

        matches.push({
          type: "hex",
          encoded,
          decoded,
          start: match.index,
          end: match.index + encoded.length,
          confidence: type !== "raw" ? 0.95 : 0.7,
        });
      } catch {
        // Invalid hex, skip
      }
    }
  }

  return matches;
}

/**
 * Detect ROT13 encoded content
 * This is trickier - we look for text that becomes more "readable" when decoded
 */
function detectRot13(content: string): EncodingMatch[] {
  const matches: EncodingMatch[] = [];

  // ROT13 decode function
  const rot13 = (str: string) =>
    str.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });

  // Suspicious words that indicate injection when decoded
  const injectionWords = /\b(ignore|bypass|disregard|forget|override|system|instruction|prompt|assistant|user|admin|execute|eval|command)\b/i;

  // Common English words (to detect if input is already English)
  const commonEnglish = /\b(the|and|for|are|but|not|you|all|can|was|one|our|out|this|that|with|have|from|they|will|would|there|their|what|about|which|when|make|like|time|just|know|take|people|into|year|your|good|some|could|them|other|than|then|now|look|only|come|its|over|think|also|back|after|use|two|how|work|first|well|way|even|new|want|because|any|these|give|day|most|us)\b/i;

  // Look for sequences of words (at least 2 words, 3+ chars each)
  const wordSequences = content.match(/[a-zA-Z]{3,}(\s+[a-zA-Z]{3,})+/g) || [];

  for (const seq of wordSequences) {
    // Skip if already contains common English words (probably not encoded)
    const englishWordCount = (seq.match(commonEnglish) || []).length;
    const totalWords = seq.split(/\s+/).length;
    if (englishWordCount > totalWords * 0.3) continue;

    const decoded = rot13(seq);

    // Check if decoded version has injection-related words
    if (injectionWords.test(decoded)) {
      const start = content.indexOf(seq);
      matches.push({
        type: "rot13",
        encoded: seq,
        decoded,
        start,
        end: start + seq.length,
        confidence: 0.8,
      });
    }
  }

  return matches;
}

/**
 * Detect Unicode escape sequences (\uXXXX only, not \xXX which is handled by hex)
 */
function detectUnicodeEscapes(content: string): EncodingMatch[] {
  const matches: EncodingMatch[] = [];

  // Match \uXXXX sequences only (not \xXX - that's hex)
  const regex = /(\\u[0-9a-fA-F]{4})+/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const encoded = match[0];
    if (encoded.length < MIN_ENCODED_LENGTH) continue;

    try {
      // Decode unicode escapes
      const decoded = encoded.replace(
        /\\u([0-9a-fA-F]{4})/g,
        (_, hex) => String.fromCharCode(parseInt(hex, 16))
      );

      matches.push({
        type: "unicode_escape",
        encoded,
        decoded,
        start: match.index,
        end: match.index + encoded.length,
        confidence: 0.95,
      });
    } catch {
      // Invalid escape, skip
    }
  }

  return matches;
}

/**
 * Detect URL encoded content
 */
function detectUrlEncoding(content: string): EncodingMatch[] {
  const matches: EncodingMatch[] = [];

  // Match sequences of %XX
  const regex = /(%[0-9a-fA-F]{2}){4,}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const encoded = match[0];

    try {
      const decoded = decodeURIComponent(encoded);

      // Only count if significantly different from encoded
      if (decoded.length < encoded.length * 0.5) {
        matches.push({
          type: "url",
          encoded,
          decoded,
          start: match.index,
          end: match.index + encoded.length,
          confidence: 0.9,
        });
      }
    } catch {
      // Invalid URL encoding, skip
    }
  }

  return matches;
}

/**
 * Detect zero-width character encoding
 * Uses invisible characters to encode binary data:
 * - Zero-width space (U+200B) = 0
 * - Zero-width non-joiner (U+200C) = 1
 * Or other variants using multiple zero-width chars
 */
function detectZeroWidth(content: string): EncodingMatch[] {
  const matches: EncodingMatch[] = [];

  // Zero-width characters used for steganography
  const ZWSP = "\u200B";  // Zero-width space
  const ZWNJ = "\u200C";  // Zero-width non-joiner
  const ZWJ = "\u200D";   // Zero-width joiner
  const WORD_JOINER = "\u2060";
  const INVISIBLE_SEPARATOR = "\u2063";

  const zeroWidthChars = [ZWSP, ZWNJ, ZWJ, WORD_JOINER, INVISIBLE_SEPARATOR];
  const zwRegex = /[\u200B-\u200D\u2060\u2063]+/g;

  let match;
  while ((match = zwRegex.exec(content)) !== null) {
    const encoded = match[0];

    // Need at least 8 chars to encode a byte
    if (encoded.length < 8) continue;

    // Try binary decoding (ZWSP=0, ZWNJ=1)
    let binary = "";
    for (const char of encoded) {
      if (char === ZWSP) binary += "0";
      else if (char === ZWNJ) binary += "1";
      else if (char === ZWJ) binary += "1";  // Alternative encoding
    }

    // Try to decode as ASCII
    if (binary.length >= 8) {
      let decoded = "";
      for (let i = 0; i + 8 <= binary.length; i += 8) {
        const byte = parseInt(binary.slice(i, i + 8), 2);
        if (byte >= 32 && byte < 127) {
          decoded += String.fromCharCode(byte);
        }
      }

      // Only match if we got readable output
      if (decoded.length >= 3) {
        matches.push({
          type: "zero_width",
          encoded: `[${encoded.length} zero-width chars]`,
          decoded,
          start: match.index,
          end: match.index + encoded.length,
          confidence: 0.8,
        });
      }
    }
  }

  return matches;
}

/**
 * Strip all zero-width characters (even if not decodable)
 * These are often used for tracking/fingerprinting or obfuscation
 */
export function stripZeroWidth(content: string): string {
  return content.replace(/[\u200B-\u200D\u2060\u2063\uFEFF]/g, "");
}

/**
 * Detect and normalize homoglyphs (characters that look like ASCII but aren't)
 * Common in Cyrillic, Greek, and other scripts
 */
function detectHomoglyphs(content: string): EncodingMatch[] {
  // Cyrillic to Latin mappings (most common homoglyphs)
  const homoglyphMap: Record<string, string> = {
    // Cyrillic lowercase
    "а": "a", "с": "c", "е": "e", "о": "o", "р": "p",
    "х": "x", "у": "y", "і": "i", "ѕ": "s", "ј": "j",
    // Cyrillic uppercase
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H",
    "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T",
    "Х": "X", "У": "Y",
    // Greek
    "α": "a", "ο": "o", "ρ": "p", "ν": "v",
    // Other lookalikes
    "ℓ": "l", "ⅰ": "i", "ⅱ": "ii", "ⅲ": "iii",
  };

  // Check if content has any homoglyphs
  let hasHomoglyph = false;
  let decoded = "";

  for (const char of content) {
    if (homoglyphMap[char]) {
      hasHomoglyph = true;
      decoded += homoglyphMap[char];
    } else {
      decoded += char;
    }
  }

  if (!hasHomoglyph || decoded === content) {
    return [];
  }

  return [{
    type: "homoglyph",
    encoded: content,
    decoded,
    start: 0,
    end: content.length,
    confidence: 0.9,
  }];
}

/**
 * Detect HTML entities
 */
function detectHtmlEntities(content: string): EncodingMatch[] {
  const matches: EncodingMatch[] = [];

  // Match sequences of HTML entities
  const regex = /(&[#a-zA-Z0-9]+;){3,}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const encoded = match[0];

    // Decode HTML entities
    const decoded = encoded
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");

    if (decoded !== encoded) {
      matches.push({
        type: "html_entity",
        encoded,
        decoded,
        start: match.index,
        end: match.index + encoded.length,
        confidence: 0.9,
      });
    }
  }

  return matches;
}

// ============================================================================
// Speculative Decoders (try all, keep valid results)
// ============================================================================

interface DecodeAttempt {
  type: EncodingType;
  decoded: string;
  confidence: number;
}

/**
 * Try to decode as base64, return null if invalid
 */
function tryBase64(content: string): DecodeAttempt | null {
  // Must be at least 4 chars and valid base64 alphabet
  if (content.length < 4) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(content)) return null;

  try {
    const padded = content + "=".repeat((4 - (content.length % 4)) % 4);
    const decoded = atob(padded);

    // Check if decoded is mostly printable
    const printableCount = (decoded.match(/[\x20-\x7E\n\r\t]/g) || []).length;
    if (printableCount / decoded.length < 0.7) return null;

    return { type: "base64", decoded, confidence: 0.8 };
  } catch {
    return null;
  }
}

/**
 * Try to decode as hex (0x prefix or raw), return null if invalid
 */
function tryHex(content: string): DecodeAttempt | null {
  let hexStr = content;

  // Handle 0x prefix
  if (hexStr.toLowerCase().startsWith("0x")) {
    hexStr = hexStr.slice(2);
  }

  // Must be even length and valid hex
  if (hexStr.length < 4 || hexStr.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(hexStr)) return null;

  try {
    let decoded = "";
    for (let i = 0; i < hexStr.length; i += 2) {
      const byte = parseInt(hexStr.slice(i, i + 2), 16);
      decoded += String.fromCharCode(byte);
    }

    // Check if decoded is mostly printable
    const printableCount = (decoded.match(/[\x20-\x7E\n\r\t]/g) || []).length;
    if (printableCount / decoded.length < 0.6) return null;

    return { type: "hex", decoded, confidence: 0.8 };
  } catch {
    return null;
  }
}

/**
 * Try ROT13 decode
 */
function tryRot13(content: string): DecodeAttempt | null {
  // Only try on content that has at least one letter to transform
  const letterCount = (content.match(/[a-zA-Z]/g) || []).length;
  if (letterCount < 1) return null;

  const decoded = content.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

  // If no change, skip
  if (decoded === content) return null;

  return { type: "rot13", decoded, confidence: 0.5 };  // Lower confidence, will be validated by recursion
}

/**
 * Try URL decode, return null if no encoding present
 */
function tryUrlDecode(content: string): DecodeAttempt | null {
  if (!content.includes("%")) return null;

  try {
    const decoded = decodeURIComponent(content);
    if (decoded === content) return null;  // No change

    return { type: "url", decoded, confidence: 0.9 };
  } catch {
    return null;
  }
}

/**
 * Try unicode escape decode (\uXXXX or \xXX)
 */
function tryUnicodeDecode(content: string): DecodeAttempt | null {
  if (!content.includes("\\u") && !content.includes("\\x")) return null;

  try {
    const decoded = content
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    if (decoded === content) return null;  // No change

    return { type: "unicode_escape", decoded, confidence: 0.9 };
  } catch {
    return null;
  }
}

/**
 * Try HTML entity decode
 */
function tryHtmlDecode(content: string): DecodeAttempt | null {
  if (!content.includes("&")) return null;

  const decoded = content
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

  if (decoded === content) return null;

  return { type: "html_entity", decoded, confidence: 0.9 };
}

/**
 * Try reverse text decode
 * Only attempts on content that looks like it could be reversed text
 */
function tryReverse(content: string): DecodeAttempt | null {
  // Only try if content is mostly letters/spaces and not too long
  if (content.length > 200) return null;
  if (!/^[a-zA-Z\s.,!?]+$/.test(content)) return null;

  const decoded = content.split("").reverse().join("");

  // Check if reversed version has more common English words
  const commonWords = /\b(the|and|for|are|but|not|you|all|can|was|one|ignore|system|instruction|prompt|user|bypass|override)\b/gi;
  const originalMatches = (content.match(commonWords) || []).length;
  const decodedMatches = (decoded.match(commonWords) || []).length;

  // Only return if reversed has significantly more English words
  if (decodedMatches > originalMatches && decodedMatches >= 1) {
    return { type: "reverse", decoded, confidence: 0.6 };
  }

  return null;
}

// ============================================================================
// Context-Aware Encoding Detection
// ============================================================================

/**
 * Detect encodings by looking for context clues in the prompt.
 * E.g., "Decode this ROT13: Bhgchg..." tells us to try ROT13 on what follows.
 */
function detectByContext(content: string): EncodingMatch[] {
  const matches: EncodingMatch[] = [];

  // Context patterns: keyword + flexible separator + payload
  // These patterns look for encoding type mentions then extract the payload that follows
  const contextPatterns: Array<{
    pattern: RegExp;
    type: EncodingType;
    decoder: (s: string) => string;
  }> = [
    // ROT13 context - flexible patterns (match until end of string or newline)
    {
      pattern: /\b(?:rot13|rot-13|rot 13)[^:]*:\s*([a-zA-Z\s,.!?]+)/gi,
      type: "rot13",
      decoder: (s) => s.trim().replace(/[a-zA-Z]/g, (c) => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      }),
    },
    // ROT13 with parenthetical mention
    {
      pattern: /\(rot13\)[^:]*:\s*([a-zA-Z\s,.!?]+)/gi,
      type: "rot13",
      decoder: (s) => s.trim().replace(/[a-zA-Z]/g, (c) => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      }),
    },
    // ROT13 header followed by content on next line (e.g., "[ROT13 ENCODED MESSAGE]\nPayload")
    {
      pattern: /\[rot13[^\]]*\]\s*\n([a-zA-Z\s,.!?]+)/gi,
      type: "rot13",
      decoder: (s) => s.trim().replace(/[a-zA-Z]/g, (c) => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      }),
    },
    // Reverse text context - "backwards", "reverse"
    {
      pattern: /\b(?:reverse|reversed|backwards?)[^:]*:\s*([a-zA-Z\s,.!?]+)/gi,
      type: "reverse",
      decoder: (s) => s.trim().split("").reverse().join(""),
    },
    // Base64 context - more flexible, look for base64 anywhere before colon
    {
      pattern: /\b(?:base64|base-64)[^:]*:\s*([A-Za-z0-9+/=]{8,})/gi,
      type: "base64",
      decoder: (s) => {
        try {
          const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
          return atob(padded);
        } catch {
          return s;
        }
      },
    },
    // Hex context
    {
      pattern: /\b(?:hex|hexadecimal)[^:]*:\s*([0-9a-fA-F]{8,})/gi,
      type: "hex",
      decoder: (s) => {
        try {
          let decoded = "";
          for (let i = 0; i < s.length; i += 2) {
            decoded += String.fromCharCode(parseInt(s.slice(i, i + 2), 16));
          }
          return decoded;
        } catch {
          return s;
        }
      },
    },
    // Morse code context - "morse code transmission:", "morse:"
    {
      pattern: /\b(?:morse(?:\s+code)?)[^:]*:\s*([\.\-\s\/]+)/gi,
      type: "morse",
      decoder: decodeMorse,
    },
    // Binary context - "computer language:", "binary:"
    {
      pattern: /\b(?:binary|computer\s+language)[^:]*:\s*([01\s]{16,})/gi,
      type: "binary",
      decoder: decodeBinary,
    },
    // Leet speak context (1337) - more flexible patterns
    {
      pattern: /\b(?:leet|l33t|1337|1337sp34k|leetspeak)[^:]*:\s*([^\n]+)/gi,
      type: "leet",
      decoder: decodeLeetExtended,
    },
    // Braille context
    {
      pattern: /\b(?:braille)[^:]*:\s*([⠀-⣿\s]+)/gi,
      type: "braille" as EncodingType,
      decoder: decodeBraille,
    },
  ];

  for (const { pattern, type, decoder } of contextPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const payload = match[1].trim();
      if (!payload || payload.length < 3) continue;

      const decoded = decoder(payload);

      // Only count if decoding changed something meaningfully
      if (decoded !== payload && decoded.length >= 3) {
        // Validate decoded is readable
        const printableRatio = (decoded.match(/[\x20-\x7E]/g) || []).length / decoded.length;
        if (printableRatio < 0.5) continue;

        matches.push({
          type: type as EncodingType,
          encoded: payload,
          decoded,
          start: match.index,
          end: match.index + match[0].length,
          confidence: 0.85,  // High confidence due to explicit context
        });
      }
    }
  }

  return matches;
}

/**
 * Decode morse code
 */
function decodeMorse(morse: string): string {
  const morseMap: Record<string, string> = {
    ".-": "a", "-...": "b", "-.-.": "c", "-..": "d", ".": "e",
    "..-.": "f", "--.": "g", "....": "h", "..": "i", ".---": "j",
    "-.-": "k", ".-..": "l", "--": "m", "-.": "n", "---": "o",
    ".--.": "p", "--.-": "q", ".-.": "r", "...": "s", "-": "t",
    "..-": "u", "...-": "v", ".--": "w", "-..-": "x", "-.--": "y",
    "--..": "z", ".----": "1", "..---": "2", "...--": "3", "....-": "4",
    ".....": "5", "-....": "6", "--...": "7", "---..": "8", "----.": "9",
    "-----": "0", "": " ",
  };

  // Split by word separators (/ or multiple spaces) then by character separators
  return morse
    .split(/\s*\/\s*|\s{3,}/)
    .map(word =>
      word.split(/\s+/)
        .map(char => morseMap[char] || "")
        .join("")
    )
    .join(" ");
}

/**
 * Decode binary (8-bit ASCII)
 */
function decodeBinary(binary: string): string {
  const clean = binary.replace(/\s/g, "");
  let result = "";
  for (let i = 0; i + 8 <= clean.length; i += 8) {
    const byte = parseInt(clean.slice(i, i + 8), 2);
    if (byte >= 32 && byte < 127) {
      result += String.fromCharCode(byte);
    }
  }
  return result;
}

/**
 * Decode leet speak (1337 -> leet) - basic version
 */
function decodeLeet(leet: string): string {
  const leetMap: Record<string, string> = {
    "0": "o", "1": "i", "2": "z", "3": "e", "4": "a",
    "5": "s", "6": "g", "7": "t", "8": "b", "9": "g",
    "@": "a", "$": "s", "!": "i", "|": "l",
  };
  return leet.split("").map(c => leetMap[c.toLowerCase()] || c.toLowerCase()).join("");
}

/**
 * Decode extended leet speak with Unicode symbols
 * Handles complex substitutions like †=t, €=e, ¥=y, etc.
 */
function decodeLeetExtended(leet: string): string {
  // Multi-char substitutions (order matters - longer first)
  const multiCharMap: Array<[RegExp, string]> = [
    [/\/\\/gi, "v"],     // /\ = v
    [/\|\\\/\|/gi, "m"], // |\/| = m
    [/\|\|/gi, "u"],     // || = u
    [/\|3/gi, "b"],      // |3 = b
    [/\|</gi, "k"],      // |< = k
    [/\|\)/gi, "d"],     // |) = d
    [/\|>/gi, "p"],      // |> = p
    [/\|2/gi, "r"],      // |2 = r
    [/\[\]/gi, "o"],     // [] = o
    [/\(\)/gi, "o"],     // () = o
    [/\{\}/gi, "o"],     // {} = o
    [/<>/gi, "o"],       // <> = o
    [/\|=/gi, "f"],      // |= = f
    [/\|-\|/gi, "h"],    // |-| = h
    [/#/gi, "h"],        // # = h
    [/><!/gi, "y"],      // ><! = y
  ];

  let result = leet;
  for (const [pattern, replacement] of multiCharMap) {
    result = result.replace(pattern, replacement);
  }

  // Single-char substitutions
  const singleCharMap: Record<string, string> = {
    "0": "o", "1": "i", "2": "z", "3": "e", "4": "a",
    "5": "s", "6": "g", "7": "t", "8": "b", "9": "g",
    "@": "a", "$": "s", "!": "i", "|": "l", "+": "t",
    "†": "t", "€": "e", "¥": "y", "£": "l", "©": "c",
    "®": "r", "∂": "d", "ƒ": "f", "µ": "u", "ñ": "n",
    "^": "a", "&": "and", "=": "e", "~": "n",
  };

  result = result.split("").map(c => singleCharMap[c] || c.toLowerCase()).join("");

  // Clean up multiple spaces
  result = result.replace(/\s+/g, " ").trim();

  return result;
}

/**
 * Decode braille (Unicode Braille Patterns block)
 */
function decodeBraille(braille: string): string {
  // Braille Unicode: U+2800 to U+28FF
  // Standard Grade 1 Braille (letters only, not contractions)
  const brailleMap: Record<string, string> = {
    "⠁": "a", "⠃": "b", "⠉": "c", "⠙": "d", "⠑": "e",
    "⠋": "f", "⠛": "g", "⠓": "h", "⠊": "i", "⠚": "j",
    "⠅": "k", "⠇": "l", "⠍": "m", "⠝": "n", "⠕": "o",
    "⠏": "p", "⠟": "q", "⠗": "r", "⠎": "s", "⠞": "t",
    "⠥": "u", "⠧": "v", "⠺": "w", "⠭": "x", "⠽": "y",
    "⠵": "z", "⠀": " ",  // Braille space
    " ": " ",             // Regular space
  };
  return braille.split("").map(c => brailleMap[c] || c).join("");
}

// ============================================================================
// Main Speculative Decoding Function
// ============================================================================

/**
 * Speculatively decode content by trying ALL decoders and recursing on valid results.
 * This handles cases like rot13(base64(payload)) where detection-first would fail.
 *
 * Uses BFS to explore all decode paths and returns the most "readable" result.
 */
export function detectEncodings(content: string, maxDepth = MAX_RECURSIVE_DEPTH): EncodingResult {
  if (!content) {
    return {
      hasEncoding: false,
      encodings: [],
      decodedContent: content || "",
      recursiveDecodes: 0,
      entropy: 0,
    };
  }

  const originalEntropy = calculateEntropy(content);

  interface DecodePath {
    content: string;
    encodings: EncodingMatch[];
    depth: number;
  }

  // BFS to explore all decode paths
  const queue: DecodePath[] = [{ content, encodings: [], depth: 0 }];
  const visited = new Set<string>([content]);
  let bestPath: DecodePath = { content, encodings: [], depth: 0 };
  let bestScore = calculateReadabilityScore(content);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    // Try all decoders speculatively on the full content
    const attempts = [
      tryBase64(current.content),
      tryHex(current.content),
      tryRot13(current.content),
      tryReverse(current.content),
      tryUrlDecode(current.content),
      tryUnicodeDecode(current.content),
      tryHtmlDecode(current.content),
    ].filter((a): a is DecodeAttempt => a !== null);

    // Also try pattern-based detection for partial encodings
    const patternMatches = [
      ...detectBase64(current.content),
      ...detectHex(current.content),
      ...detectUnicodeEscapes(current.content),
      ...detectUrlEncoding(current.content),
      ...detectHtmlEntities(current.content),
      ...detectZeroWidth(current.content),
      ...detectHomoglyphs(current.content),  // Cyrillic/Greek lookalikes
      ...detectByContext(current.content),   // Context-aware detection (ROT13, reverse, morse, etc.)
    ].filter((m) => m.confidence >= 0.7);

    // Process pattern matches (partial content)
    if (patternMatches.length > 0) {
      patternMatches.sort((a, b) => b.start - a.start);
      let newContent = current.content;
      const newEncodings = [...current.encodings];
      for (const match of patternMatches) {
        newContent = newContent.slice(0, match.start) + match.decoded + newContent.slice(match.end);
        newEncodings.push(match);
      }
      if (!visited.has(newContent)) {
        visited.add(newContent);
        // Pattern matches get a bonus because finding an encoding is itself valuable
        // The fact that we decoded meaningful text from a pattern context is a strong signal
        const patternBonus = patternMatches.reduce((sum, m) => sum + m.confidence * 20, 0);
        const score = calculateReadabilityScore(newContent) + patternBonus;
        const newPath = { content: newContent, encodings: newEncodings, depth: current.depth + 1 };
        if (score > bestScore) {
          bestScore = score;
          bestPath = newPath;
        }
        queue.push(newPath);
      }
    }

    // Process full-content speculative decodes
    for (const attempt of attempts) {
      if (!visited.has(attempt.decoded)) {
        visited.add(attempt.decoded);
        const newEncodings = [...current.encodings, {
          type: attempt.type,
          encoded: current.content,
          decoded: attempt.decoded,
          start: 0,
          end: current.content.length,
          confidence: attempt.confidence,
        }];
        const score = calculateReadabilityScore(attempt.decoded);
        const newPath = { content: attempt.decoded, encodings: newEncodings, depth: current.depth + 1 };
        if (score > bestScore) {
          bestScore = score;
          bestPath = newPath;
        }
        queue.push(newPath);
      }
    }
  }

  return {
    hasEncoding: bestPath.encodings.length > 0,
    encodings: bestPath.encodings,
    decodedContent: bestPath.content,
    recursiveDecodes: bestPath.depth,
    entropy: originalEntropy,
  };
}

/**
 * Score how "readable" a string is (higher = more readable)
 */
function calculateReadabilityScore(s: string): number {
  let score = 0;

  // Printable ASCII ratio
  const printableCount = (s.match(/[\x20-\x7E]/g) || []).length;
  score += (printableCount / s.length) * 50;

  // Common English words
  const commonWords = (s.match(/\b(the|and|for|are|but|not|you|all|can|was|one|our|ignore|system|instruction|prompt|user|bypass|override|this|that|with|have|from)\b/gi) || []).length;
  score += commonWords * 10;

  // Spaces (natural text has spaces)
  const spaceRatio = (s.match(/ /g) || []).length / s.length;
  score += spaceRatio * 20;

  // Penalize very long strings of same char type
  if (/[A-Za-z0-9+/=]{40,}/.test(s)) score -= 20;

  return score;
}

// ============================================================================
// Quick Check (Fast Path)
// ============================================================================

/**
 * Fast check if content likely contains encoding (no decoding)
 * Use this for quick filtering before full detection
 */
export function likelyHasEncoding(content: string): boolean {
  if (!content) return false;

  // Quick regex checks
  const patterns = [
    /[A-Za-z0-9+/]{30,}={0,2}/,        // Base64
    /0x[0-9a-fA-F]{8,}/,                // Hex with prefix
    /\\x[0-9a-fA-F]{2}/,                // Hex escape
    /\\u[0-9a-fA-F]{4}/,                // Unicode escape
    /(%[0-9a-fA-F]{2}){4,}/,            // URL encoding
    /(&[#a-zA-Z0-9]+;){3,}/,            // HTML entities
    /[\u200B-\u200D\u2060\u2063]{8,}/,  // Zero-width chars
  ];

  for (const pattern of patterns) {
    if (pattern.test(content)) return true;
  }

  // Entropy check for unknown encodings
  const entropy = calculateEntropy(content);
  if (entropy > 5.5 && hasUniformDistribution(content, 0.5)) {
    return true;
  }

  return false;
}

// ============================================================================
// Integration Helper
// ============================================================================

/**
 * Process content for classification: detect, decode, return both versions
 * Returns original if no encoding found, otherwise returns decoded for re-classification
 */
export function preprocessForClassification(content: string): {
  original: string;
  processed: string;
  wasEncoded: boolean;
  encodingTypes: EncodingType[];
} {
  // Handle null/undefined content
  if (!content) {
    return {
      original: content ?? "",
      processed: content ?? "",
      wasEncoded: false,
      encodingTypes: [],
    };
  }

  // For short content, always run BFS (catches rot13 which has no obvious markers)
  // For longer content, use fast-path heuristics
  const SHORT_CONTENT_THRESHOLD = 500;

  if (content.length > SHORT_CONTENT_THRESHOLD && !likelyHasEncoding(content)) {
    return {
      original: content,
      processed: content,
      wasEncoded: false,
      encodingTypes: [],
    };
  }

  // Full detection
  const result = detectEncodings(content);

  return {
    original: content,
    processed: result.decodedContent,
    wasEncoded: result.hasEncoding,
    encodingTypes: [...new Set(result.encodings.map((e) => e.type))],
  };
}
