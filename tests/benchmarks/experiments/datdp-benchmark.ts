/**
 * DATDP Benchmark
 *
 * Tests the DATDP (Defense Against The Dark Prompts) voting algorithm
 * against our standard test data for comparison with classifiers.
 */

import "dotenv/config";
import {
  runBenchmark,
  printResults,
  type ClassifierFn,
  type BenchmarkConfig,
  type TestCase,
} from "../framework/harness.js";
import { loadAllInjection, loadAllBenign } from "../framework/loaders.js";
import { runDATDP } from "../../../src/datdp.js";
import { resolveConfig } from "../../../src/config.js";

async function main() {
  const maxCases = parseInt(process.argv[2] || "100");

  console.log("=".repeat(70));
  console.log("DATDP BENCHMARK");
  console.log("=".repeat(70));

  // Load test data
  console.log("\nLoading test data...");
  const [injectionCases, benignCases] = await Promise.all([
    loadAllInjection(),
    loadAllBenign(),
  ]);

  console.log(`  Injection cases: ${injectionCases.length}`);
  console.log(`  Benign cases: ${benignCases.length}`);

  // Sample
  const halfCount = Math.floor(maxCases / 2);
  const injectionSample = injectionCases
    .sort(() => Math.random() - 0.5)
    .slice(0, halfCount);
  const benignSample = benignCases
    .sort(() => Math.random() - 0.5)
    .slice(0, halfCount);

  const testCases: TestCase[] = [...injectionSample, ...benignSample];
  console.log(`  Using ${testCases.length} cases (${injectionSample.length} injection, ${benignSample.length} benign)`);

  // Resolve config
  const config = await resolveConfig({
    verbose: false,
    iterations: 3,  // Lower iterations for speed
    task: "safety1",
  });

  console.log(`\n  Model: ${config.model}`);
  console.log(`  Iterations: ${config.iterations}`);
  console.log(`  Task: ${config.task}`);

  // Create DATDP classifier function
  const datdpClassifier: ClassifierFn = async (input: string) => {
    const result = await runDATDP(input, config);
    return {
      blocked: result.blocked,
      confidence: Math.abs(result.score) / (config.iterations * 2),  // Normalize score
      raw: {
        score: result.score,
        yesVotes: result.yesVotes,
        noVotes: result.noVotes,
        unclearVotes: result.unclearVotes,
      },
    };
  };

  // Run benchmark
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Running DATDP (${config.iterations} iterations per case)`);
  console.log("=".repeat(70));

  const benchmarkConfig: BenchmarkConfig = {
    name: "DATDP",
    classifier: datdpClassifier,
    concurrency: 5,  // Parallel API calls
    timeoutMs: 60000,
    verbose: true,
    outputDir: "data",
  };

  try {
    const result = await runBenchmark(testCases, benchmarkConfig);
    printResults(result);

    // Show vote distribution
    console.log("\n--- VOTE DISTRIBUTION ---");
    let totalYes = 0, totalNo = 0, totalUnclear = 0;
    for (const r of result.results) {
      if (r.raw) {
        totalYes += r.raw.yesVotes || 0;
        totalNo += r.raw.noVotes || 0;
        totalUnclear += r.raw.unclearVotes || 0;
      }
    }
    const totalVotes = totalYes + totalNo + totalUnclear;
    console.log(`  Yes (block): ${totalYes} (${(totalYes/totalVotes*100).toFixed(1)}%)`);
    console.log(`  No (allow): ${totalNo} (${(totalNo/totalVotes*100).toFixed(1)}%)`);
    console.log(`  Unclear: ${totalUnclear} (${(totalUnclear/totalVotes*100).toFixed(1)}%)`);

  } catch (error) {
    console.error("Benchmark failed:", error);
  }
}

main().catch(console.error);
