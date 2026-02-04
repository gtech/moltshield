/**
 * Benchmark Utilities
 *
 * Shared utilities for benchmark runners.
 */

// ============================================================================
// Text Augmentation (for obfuscation resistance testing)
// ============================================================================

/**
 * Generate augmented versions of text using various obfuscation techniques.
 * Useful for testing if classifiers can detect attacks through noise.
 */
export function augmentText(text: string, type: AugmentationType): string {
  switch (type) {
    case "random_caps":
      return text.split("").map((c) =>
        Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()
      ).join("");

    case "leetspeak": {
      const leetMap: Record<string, string> = {
        "a": "4", "e": "3", "i": "1", "o": "0", "s": "5", "t": "7",
        "A": "4", "E": "3", "I": "1", "O": "0", "S": "5", "T": "7",
      };
      return text.split("").map(c => leetMap[c] || c).join("");
    }

    case "unicode_confusables": {
      // Replace some Latin chars with Cyrillic lookalikes
      const confusables: Record<string, string> = {
        "a": "\u0430", "e": "\u0435", "o": "\u043E", "p": "\u0440",
        "c": "\u0441", "x": "\u0445", "A": "\u0410", "E": "\u0415",
      };
      return text.split("").map(c =>
        Math.random() > 0.7 ? (confusables[c] || c) : c
      ).join("");
    }

    case "invisible_chars":
      // Insert zero-width spaces randomly
      return text.split("").map(c =>
        Math.random() > 0.8 ? c + "\u200B" : c
      ).join("");

    case "mixed": {
      // Combine multiple techniques
      let result = text;
      result = augmentText(result, "random_caps");
      result = augmentText(result, "invisible_chars");
      return result;
    }

    default:
      return text;
  }
}

export type AugmentationType =
  | "random_caps"
  | "leetspeak"
  | "unicode_confusables"
  | "invisible_chars"
  | "mixed";

export const AUGMENTATION_TYPES: AugmentationType[] = [
  "random_caps",
  "leetspeak",
  "unicode_confusables",
  "invisible_chars",
  "mixed",
];
