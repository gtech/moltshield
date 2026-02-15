/**
 * Encoding-Only Classifier Benchmark
 *
 * Tests classifiers specifically on cases with detected encodings.
 * This isolates the impact of the encoding preprocessing layer.
 */

import "dotenv/config";
import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import {
  runBenchmark,
  printResults,
  type ClassifierFn,
  type BenchmarkConfig,
  type TestCase,
} from "../framework/harness.js";
import { loadAllInjection, loadAllBenign } from "../framework/loaders.js";
import { preprocessForClassification } from "../../../src/encoding.js";

// ============================================================================
// Python Classifier Wrapper
// ============================================================================

interface ClassifierResult {
  blocked: boolean;
  confidence: number;
  label: string;
  error?: string;
}

class LocalClassifier {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private ready = false;
  private responseQueue: Array<{ resolve: (r: ClassifierResult) => void; reject: (e: Error) => void }> = [];
  private modelName: string;

  constructor(private model: "pg2" | "deberta" | "piguard" | "sentinel" | "deepset") {
    this.modelName = model.toUpperCase();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(".venv/bin/python", [
        "tests/benchmarks/framework/local-classifier.py",
        "--model", this.model,
        "--batch"
      ], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.rl = readline.createInterface({
        input: this.process.stdout!,
        crlfDelay: Infinity,
      });

      this.rl.on("line", (line) => {
        try {
          const data = JSON.parse(line);
          if (data.status === "ready") {
            this.ready = true;
            resolve();
            return;
          }
          const pending = this.responseQueue.shift();
          if (pending) {
            if (data.error) {
              pending.reject(new Error(data.error));
            } else {
              pending.resolve(data as ClassifierResult);
            }
          }
        } catch (e) {
          console.error(`Parse error: ${line}`);
        }
      });

      this.process.stderr?.on("data", (data) => {
        const msg = data.toString();
        if (!msg.includes("Loading weights") && !msg.includes("it/s")) {
          process.stderr.write(`[${this.modelName}] ${msg}`);
        }
      });

      this.process.on("error", reject);
      this.process.on("exit", (code) => {
        if (!this.ready) {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      setTimeout(() => {
        if (!this.ready) {
          reject(new Error("Timeout waiting for classifier to start"));
        }
      }, 120000);
    });
  }

  async classify(text: string): Promise<ClassifierResult> {
    if (!this.process || !this.ready) {
      throw new Error("Classifier not started");
    }

    return new Promise((resolve, reject) => {
      this.responseQueue.push({ resolve, reject });
      this.process!.stdin!.write(JSON.stringify({ text }) + "\n");
    });
  }

  stop(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /** Classifier WITHOUT encoding preprocessing */
  createClassifierFn(): ClassifierFn {
    return async (input: string) => {
      const result = await this.classify(input);
      return {
        blocked: result.blocked,
        confidence: result.confidence,
        raw: { label: result.label },
      };
    };
  }

  /** Classifier WITH encoding preprocessing */
  createClassifierWithEncodingFn(): ClassifierFn {
    return async (input: string) => {
      const { original, processed, wasEncoded, encodingTypes } = preprocessForClassification(input);

      // Classify original
      const originalResult = await this.classify(original);

      // If encoded content was found, also classify the decoded version
      if (wasEncoded && processed !== original) {
        const decodedResult = await this.classify(processed);

        // Block if EITHER version triggers
        const blocked = originalResult.blocked || decodedResult.blocked;
        const confidence = Math.max(originalResult.confidence, decodedResult.confidence);

        return {
          blocked,
          confidence,
          raw: {
            originalLabel: originalResult.label,
            originalBlocked: originalResult.blocked,
            decodedLabel: decodedResult.label,
            decodedBlocked: decodedResult.blocked,
            encodingTypes,
            wasEncoded: true,
          },
        };
      }

      return {
        blocked: originalResult.blocked,
        confidence: originalResult.confidence,
        raw: { label: originalResult.label, wasEncoded: false },
      };
    };
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=" .repeat(70));
  console.log("ENCODING-ONLY CLASSIFIER BENCHMARK");
  console.log("=" .repeat(70));

  // Load test data
  console.log("\nLoading test data...");
  const [injectionCases, benignCases] = await Promise.all([
    loadAllInjection(),
    loadAllBenign(),
  ]);

  console.log(`  Total injection cases: ${injectionCases.length}`);
  console.log(`  Total benign cases: ${benignCases.length}`);

  // Filter to only cases with detected encodings
  const encodedInjection = injectionCases.filter(tc => {
    const { wasEncoded } = preprocessForClassification(tc.input);
    return wasEncoded;
  });

  const encodedBenign = benignCases.filter(tc => {
    const { wasEncoded } = preprocessForClassification(tc.input);
    return wasEncoded;
  });

  console.log(`\n  Encoded injection cases: ${encodedInjection.length}`);
  console.log(`  Encoded benign cases: ${encodedBenign.length}`);

  const testCases: TestCase[] = [...encodedInjection, ...encodedBenign];
  console.log(`  Total test cases: ${testCases.length}`);

  if (testCases.length === 0) {
    console.error("No encoded cases found!");
    return;
  }

  // Show encoding type breakdown
  const encodingBreakdown = new Map<string, number>();
  for (const tc of testCases) {
    const { encodingTypes } = preprocessForClassification(tc.input);
    for (const type of encodingTypes) {
      encodingBreakdown.set(type, (encodingBreakdown.get(type) || 0) + 1);
    }
  }
  console.log("\n  Encoding types:");
  for (const [type, count] of [...encodingBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // Classifiers to test
  const classifiers: Array<{ name: string; model: "pg2" | "piguard" }> = [
    { name: "PG2", model: "pg2" },
    { name: "PIGuard", model: "piguard" },
  ];

  const allResults: Array<{ name: string; result: any }> = [];

  for (const { name, model } of classifiers) {
    const classifier = new LocalClassifier(model);
    try {
      console.log(`\n  Starting ${name}...`);
      await classifier.start();
    } catch (error) {
      console.error(`Failed to start ${name}:`, error);
      continue;
    }

    // Baseline (no preprocessing)
    console.log(`\n${"=".repeat(70)}`);
    console.log(`${name} BASELINE (no preprocessing)`);
    console.log("=".repeat(70));

    const baselineConfig: BenchmarkConfig = {
      name: `${name}-baseline`,
      classifier: classifier.createClassifierFn(),
      concurrency: 1,
      timeoutMs: 10000,
      verbose: true,
      outputDir: "data",
    };

    try {
      const baselineResult = await runBenchmark(testCases, baselineConfig);
      allResults.push({ name: `${name} (baseline)`, result: baselineResult });
      printResults(baselineResult);
    } catch (error) {
      console.error(`Error running ${name} baseline:`, error);
    }

    // With encoding preprocessing
    console.log(`\n${"=".repeat(70)}`);
    console.log(`${name} + ENCODING PREPROCESSING`);
    console.log("=".repeat(70));

    const encodingConfig: BenchmarkConfig = {
      name: `${name}-with-encoding`,
      classifier: classifier.createClassifierWithEncodingFn(),
      concurrency: 1,
      timeoutMs: 10000,
      verbose: true,
      outputDir: "data",
    };

    try {
      const encodingResult = await runBenchmark(testCases, encodingConfig);
      allResults.push({ name: `${name} + encoding`, result: encodingResult });
      printResults(encodingResult);
    } catch (error) {
      console.error(`Error running ${name} with encoding:`, error);
    }

    classifier.stop();
  }

  // Summary
  if (allResults.length > 1) {
    console.log("\n" + "=".repeat(70));
    console.log("SUMMARY: ENCODING PREPROCESSING IMPACT");
    console.log("=".repeat(70));

    console.log("\n" + "Classifier".padEnd(25) +
      "TPR".padStart(10) +
      "FPR".padStart(10) +
      "F1".padStart(10) +
      "Δ TPR".padStart(12));
    console.log("-".repeat(67));

    for (const model of ["PG2", "PIGuard"]) {
      const baseline = allResults.find(r => r.name === `${model} (baseline)`);
      const withEnc = allResults.find(r => r.name === `${model} + encoding`);

      if (baseline && withEnc) {
        const deltaTPR = (withEnc.result.overall.tpr - baseline.result.overall.tpr) * 100;

        console.log(
          baseline.name.padEnd(25) +
          `${(baseline.result.overall.tpr * 100).toFixed(1)}%`.padStart(10) +
          `${(baseline.result.overall.fpr * 100).toFixed(1)}%`.padStart(10) +
          baseline.result.overall.f1.toFixed(3).padStart(10) +
          "-".padStart(12)
        );
        console.log(
          withEnc.name.padEnd(25) +
          `${(withEnc.result.overall.tpr * 100).toFixed(1)}%`.padStart(10) +
          `${(withEnc.result.overall.fpr * 100).toFixed(1)}%`.padStart(10) +
          withEnc.result.overall.f1.toFixed(3).padStart(10) +
          `${deltaTPR >= 0 ? "+" : ""}${deltaTPR.toFixed(1)}%`.padStart(12)
        );
        console.log();
      }
    }

    console.log("\nNote: This benchmark only includes cases with detected encodings.");
    console.log(`Total encoded cases: ${testCases.length} (${encodedInjection.length} injection, ${encodedBenign.length} benign)`);
  }
}

main().catch(console.error);
