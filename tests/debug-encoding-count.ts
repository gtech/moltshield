import { loadAllInjection, loadAllBenign } from "./benchmarks/framework/loaders.js";
import { preprocessForClassification } from "../src/encoding.js";

async function main() {
  const [injectionCases, benignCases] = await Promise.all([
    loadAllInjection(),
    loadAllBenign(),
  ]);

  console.log(`Injection cases: ${injectionCases.length}`);
  console.log(`Benign cases: ${benignCases.length}`);

  // Count encodings in ALL injection cases
  let encodedInjection = 0;
  for (const tc of injectionCases) {
    const { wasEncoded } = preprocessForClassification(tc.input);
    if (wasEncoded) encodedInjection++;
  }
  console.log(`\nInjection cases with encoding: ${encodedInjection}/${injectionCases.length} (${(encodedInjection/injectionCases.length*100).toFixed(1)}%)`);

  // Count encodings in ALL benign cases
  let encodedBenign = 0;
  for (const tc of benignCases) {
    const { wasEncoded } = preprocessForClassification(tc.input);
    if (wasEncoded) encodedBenign++;
  }
  console.log(`Benign cases with encoding: ${encodedBenign}/${benignCases.length} (${(encodedBenign/benignCases.length*100).toFixed(1)}%)`);

  // Sample like the benchmark does
  const halfCount = 50;
  const injectionSample = injectionCases.sort(() => Math.random() - 0.5).slice(0, halfCount);
  const benignSample = benignCases.sort(() => Math.random() - 0.5).slice(0, halfCount);

  let encodedSample = 0;
  for (const tc of [...injectionSample, ...benignSample]) {
    const { wasEncoded } = preprocessForClassification(tc.input);
    if (wasEncoded) encodedSample++;
  }
  console.log(`\nSampled (100 cases) with encoding: ${encodedSample}`);
}

main().catch(console.error);
