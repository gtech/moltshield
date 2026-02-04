/**
 * LLM Classifier Comparison Benchmark
 *
 * Compares LLM-based classifiers using the unified benchmark harness:
 * - DATDP (pre-inference)
 * - CCFC (pre-inference)
 * - Exchange (post-inference, requires response generation)
 *
 * Usage:
 *   npx tsx tests/benchmarks/llm-classifier-comparison.ts [count]
 */

import "dotenv/config";
import {
  runBenchmark,
  printResults,
  type ClassifierFn,
  type BenchmarkConfig,
  type TestCase,
} from "./harness.js";
import { loadAllInjection, loadAllBenign } from "./loaders.js";
import { execute, PRESET_DATDP, PRESET_CCFC } from "../../src/strategy.js";
import { resolveConfig } from "../../src/config.js";

// ============================================================================
// Classifier Wrappers
// ============================================================================

function createDATDPClassifier(
  config: Awaited<ReturnType<typeof resolveConfig>>
): ClassifierFn {
  return async (input: string) => {
    try {
      const result = await execute(input, PRESET_DATDP, config);
      const blocked = result.verdict === "block";

      // Extract confidence from trace
      const datdpTrace = result.trace?.find((t) => t.node.startsWith("datdp"));
      const confidence = datdpTrace?.data?.score ?? (blocked ? 0.8 : 0.2);

      return {
        blocked,
        confidence,
        raw: {
          verdict: result.verdict,
          trace: result.trace,
        },
      };
    } catch (e) {
      return { blocked: false, confidence: 0, raw: { error: String(e) } };
    }
  };
}

function createCCFCClassifier(
  config: Awaited<ReturnType<typeof resolveConfig>>
): ClassifierFn {
  return async (input: string) => {
    try {
      const result = await execute(input, PRESET_CCFC, config);
      const blocked = result.verdict === "block";

      // Extract data from trace
      const ccfcTrace = result.trace?.find((t) => t.node.startsWith("ccfc"));
      const confidence = blocked ? 0.9 : 0.1;

      return {
        blocked,
        confidence,
        raw: {
          verdict: result.verdict,
          core: ccfcTrace?.data?.core,
          blockedBy: ccfcTrace?.data?.blockedBy,
        },
      };
    } catch (e) {
      return { blocked: false, confidence: 0, raw: { error: String(e) } };
    }
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const maxCases = parseInt(process.argv[2] || "50");

  console.log("=".repeat(70));
  console.log("LLM CLASSIFIER COMPARISON BENCHMARK");
  console.log("=".repeat(70));
  console.log(`\nMax cases: ${maxCases}`);

  // Load test data
  console.log("\nLoading test data...");
  const [injectionCases, benignCases] = await Promise.all([
    loadAllInjection(),
    loadAllBenign(),
  ]);

  console.log(`  Injection cases available: ${injectionCases.length}`);
  console.log(`  Benign cases available: ${benignCases.length}`);

  // Sample balanced dataset
  const halfCount = Math.floor(maxCases / 2);
  const injectionSample = injectionCases
    .sort(() => Math.random() - 0.5)
    .slice(0, halfCount);
  const benignSample = benignCases
    .sort(() => Math.random() - 0.5)
    .slice(0, halfCount);

  const testCases: TestCase[] = [...injectionSample, ...benignSample];
  console.log(`  Using ${testCases.length} cases (${injectionSample.length} injection, ${benignSample.length} benign)`);

  // Initialize config
  const config = await resolveConfig({
    verbose: false,
    timeout: 60000,
    noCache: true
  });
  console.log(`\nUsing evaluator model: ${config.model}`);

  // Create classifiers
  const classifiers: Array<{ name: string; fn: ClassifierFn }> = [
    { name: "DATDP", fn: createDATDPClassifier(config) },
    { name: "CCFC", fn: createCCFCClassifier(config) },
  ];

  // Run benchmarks
  const results = [];

  for (const { name, fn } of classifiers) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`Running: ${name}`);
    console.log("=".repeat(70));

    const benchConfig: BenchmarkConfig = {
      name,
      classifier: fn,
      concurrency: 5,  // LLM API supports parallelism
      timeoutMs: 60000,
      verbose: true,
      outputDir: "data",
    };

    try {
      const result = await runBenchmark(testCases, benchConfig);
      results.push(result);
      printResults(result);
    } catch (error) {
      console.error(`Error running ${name}:`, error);
    }
  }

  // Summary comparison
  if (results.length > 1) {
    console.log("\n" + "=".repeat(70));
    console.log("COMPARISON SUMMARY");
    console.log("=".repeat(70));

    console.log("\n" + "Classifier".padEnd(20) +
      "TPR".padStart(10) +
      "FPR".padStart(10) +
      "F1".padStart(10) +
      "Latency".padStart(12));
    console.log("-".repeat(62));

    for (const r of results) {
      console.log(
        r.name.padEnd(20) +
        `${(r.overall.tpr * 100).toFixed(1)}%`.padStart(10) +
        `${(r.overall.fpr * 100).toFixed(1)}%`.padStart(10) +
        r.overall.f1.toFixed(3).padStart(10) +
        `${r.latency.p50.toFixed(0)}ms`.padStart(12)
      );
    }
  }
}

main().catch(console.error);
