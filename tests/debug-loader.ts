import { loadAllInjection } from "./benchmarks/framework/loaders.js";
import { preprocessForClassification } from "../src/encoding.js";

async function main() {
  const cases = await loadAllInjection();

  // Find zeroleaks-encoding cases
  const encodingCases = cases.filter(c => c.category?.includes("encoding"));

  console.log(`Total cases: ${cases.length}`);
  console.log(`Encoding cases: ${encodingCases.length}`);

  // Check first few
  for (const tc of encodingCases.slice(0, 5)) {
    console.log("\n" + "=".repeat(70));
    console.log("ID:", tc.id);
    console.log("Category:", tc.category);
    console.log("Content (first 200 chars):", tc.content?.slice(0, 200));
    console.log("Content length:", tc.content?.length);

    if (tc.input) {
      const result = preprocessForClassification(tc.input);
      console.log("wasEncoded:", result.wasEncoded);
      console.log("encodingTypes:", result.encodingTypes);
      if (result.wasEncoded) {
        console.log("Decoded:", result.processed.slice(0, 100));
      }
    } else {
      console.log("WARNING: No input!");
    }
  }
}

main().catch(console.error);
