import { loadAllInjection } from "./benchmarks/framework/loaders.js";
import { preprocessForClassification } from "../src/encoding.js";

async function main() {
  const cases = await loadAllInjection();

  // Find zeroleaks-encoding cases
  const encodingCases = cases.filter(c => c.category === "zeroleaks-encoding");

  console.log(`Zeroleaks-encoding cases: ${encodingCases.length}`);

  let detected = 0;
  let notDetected = 0;

  for (const tc of encodingCases) {
    const { wasEncoded, encodingTypes } = preprocessForClassification(tc.input);
    if (wasEncoded) {
      detected++;
    } else {
      notDetected++;
      console.log("\n--- NOT DETECTED ---");
      console.log("ID:", tc.id);
      console.log("Input (first 200):", tc.input?.slice(0, 200));
    }
  }

  console.log(`\nDetected: ${detected}/${encodingCases.length}`);
  console.log(`Not detected: ${notDetected}/${encodingCases.length}`);
}

main().catch(console.error);
