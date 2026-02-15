/**
 * Test encoding detection on multilingual content
 *
 * Concern: Will the BFS decoder incorrectly "decode" legitimate non-English text?
 */

import { detectEncodings, preprocessForClassification } from "../src/encoding.js";

const multilingualTests = [
  // European languages (Latin script - rot13 affects these)
  { lang: "French", text: "Bonjour, comment allez-vous aujourd'hui?" },
  { lang: "Spanish", text: "Hola, ¿cómo estás? Me llamo Carlos." },
  { lang: "German", text: "Guten Tag, wie geht es Ihnen heute?" },
  { lang: "Portuguese", text: "Olá, como você está? Tudo bem?" },
  { lang: "Italian", text: "Ciao, come stai? Piacere di conoscerti." },

  // Non-Latin scripts (rot13 won't affect these)
  { lang: "Chinese", text: "你好，今天天气怎么样？" },
  { lang: "Japanese", text: "こんにちは、元気ですか？" },
  { lang: "Korean", text: "안녕하세요, 어떻게 지내세요?" },
  { lang: "Arabic", text: "مرحبا، كيف حالك اليوم؟" },
  { lang: "Russian", text: "Привет, как дела сегодня?" },
  { lang: "Hindi", text: "नमस्ते, आप कैसे हैं?" },

  // Mixed scripts
  { lang: "Mixed EN/CN", text: "Hello 你好 World 世界" },
  { lang: "Mixed EN/JP", text: "Welcome to Tokyo 東京へようこそ" },

  // Edge cases that might look like encodings
  { lang: "Base64-like word", text: "The word 'café' contains accents." },
  { lang: "Hex-like German", text: "Das Café hat die Adresse 0xABCD." },
  { lang: "URL in text", text: "Besuchen Sie https://example.com/path?q=café" },

  // Technical content in other languages
  { lang: "Spanish tech", text: "La función base64 codifica los datos en ASCII." },
  { lang: "French code", text: "Le code hexadécimal 0xFF représente 255." },
];

console.log("=".repeat(70));
console.log("MULTILINGUAL ENCODING TEST");
console.log("=".repeat(70));
console.log("\nTesting if legitimate multilingual text gets incorrectly 'decoded'\n");

let issues = 0;

for (const { lang, text } of multilingualTests) {
  const result = preprocessForClassification(text);

  const wasChanged = result.processed !== result.original;

  console.log(`${lang}:`);
  console.log(`  Original:  "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`);

  if (wasChanged) {
    console.log(`  ⚠️  CHANGED: "${result.processed.slice(0, 50)}${result.processed.length > 50 ? "..." : ""}"`);
    console.log(`  Encodings: ${result.encodingTypes.join(", ")}`);
    issues++;
  } else {
    console.log(`  ✓ Unchanged`);
  }
  console.log();
}

console.log("=".repeat(70));
console.log(`SUMMARY: ${issues} issues found out of ${multilingualTests.length} tests`);
if (issues > 0) {
  console.log("⚠️  Some multilingual text was incorrectly decoded!");
} else {
  console.log("✓ All multilingual text preserved correctly");
}
console.log("=".repeat(70));
