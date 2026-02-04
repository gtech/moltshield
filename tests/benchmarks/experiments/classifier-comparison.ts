/**
 * Classifier Comparison Benchmark
 *
 * Compares local pre-inference classifiers using the unified benchmark harness:
 * - ProtectAI DeBERTa v3 (prompt-injection-v2)
 * - Meta Prompt Guard 2 (86M)
 *
 * Uses Python subprocess for local transformer inference.
 *
 * Usage:
 *   npx tsx tests/benchmarks/experiments/classifier-comparison.ts [count]
 *   npx tsx tests/benchmarks/experiments/classifier-comparison.ts 100
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

// ============================================================================
// Python Classifier Wrapper
// ============================================================================

interface ClassifierResult {
  blocked: boolean;
  confidence: number;
  label: string;
  error?: string;
}

/**
 * Creates a classifier function that uses local Python inference.
 * Spawns a persistent Python process for efficient batch classification.
 */
class LocalClassifier {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private ready = false;
  private responseQueue: Array<{ resolve: (r: ClassifierResult) => void; reject: (e: Error) => void }> = [];
  private modelName: string;

  constructor(private model: "pg2" | "deberta") {
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

          // Response to a classification request (FIFO order)
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
        // Filter out progress bars and loading messages
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

      // Timeout for startup
      setTimeout(() => {
        if (!this.ready) {
          reject(new Error("Timeout waiting for classifier to start"));
        }
      }, 60000);
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
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const maxCases = parseInt(process.argv[2] || "0");  // 0 = all cases

  console.log("=".repeat(70));
  console.log("CLASSIFIER COMPARISON BENCHMARK");
  console.log("=".repeat(70));
  console.log(`\nMax cases: ${maxCases}`);

  // Load test data using our loaders
  console.log("\nLoading test data...");
  const [injectionCases, benignCases] = await Promise.all([
    loadAllInjection(),
    loadAllBenign(),
  ]);

  console.log(`  Injection cases available: ${injectionCases.length}`);
  console.log(`  Benign cases available: ${benignCases.length}`);

  // Use all cases or sample if maxCases specified
  let injectionSample = injectionCases;
  let benignSample = benignCases;

  if (maxCases > 0 && maxCases < injectionCases.length + benignCases.length) {
    const halfCount = Math.floor(maxCases / 2);
    injectionSample = injectionCases
      .sort(() => Math.random() - 0.5)
      .slice(0, halfCount);
    benignSample = benignCases
      .sort(() => Math.random() - 0.5)
      .slice(0, halfCount);
  }

  const testCases: TestCase[] = [...injectionSample, ...benignSample];
  console.log(`  Using ${testCases.length} cases (${injectionSample.length} injection, ${benignSample.length} benign)`);

  // Initialize classifiers
  console.log("\nInitializing classifiers...");

  const pg2 = new LocalClassifier("pg2");
  const deberta = new LocalClassifier("deberta");

  try {
    console.log("  Starting PG2...");
    await pg2.start();
    console.log("  Starting DeBERTa...");
    await deberta.start();
    console.log("  Classifiers ready.");
  } catch (error) {
    console.error("Failed to start classifiers:", error);
    process.exit(1);
  }

  // Run benchmarks
  const classifiers: Array<{ name: string; classifier: LocalClassifier }> = [
    { name: "PG2", classifier: pg2 },
    { name: "DeBERTa", classifier: deberta },
  ];

  const results = [];

  for (const { name, classifier } of classifiers) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`Running: ${name}`);
    console.log("=".repeat(70));

    const config: BenchmarkConfig = {
      name,
      classifier: classifier.createClassifierFn(),
      concurrency: 1,  // Local inference is sequential
      timeoutMs: 10000,
      verbose: true,
      outputDir: "data",
    };

    try {
      const result = await runBenchmark(testCases, config);
      results.push(result);
      printResults(result);
    } catch (error) {
      console.error(`Error running ${name}:`, error);
    }
  }

  // Cleanup
  pg2.stop();
  deberta.stop();

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
