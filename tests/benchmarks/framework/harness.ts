/**
 * Benchmark Harness
 *
 * Unified framework for testing prompt injection classifiers.
 *
 * Features:
 * - Runtime loading from multiple data sources
 * - Configurable parallelism
 * - Per-category metrics
 * - Cost and latency tracking
 * - JSON + human-readable output
 */

import * as fs from "fs/promises";
import * as path from "path";
import { estimateCost } from "./logger.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A single test case for the benchmark
 */
export interface TestCase {
  id: string;
  category: string;
  input: string;              // The content to classify
  expectedBlock: boolean;     // Ground truth: should this be blocked?
  metadata?: Record<string, unknown>;
}

/**
 * Result of classifying a single test case
 */
export interface ClassificationResult {
  testCase: TestCase;
  blocked: boolean;
  confidence: number;
  latencyMs: number;
  error?: string;
  raw?: unknown;              // Raw classifier output for debugging
}

/**
 * Classifier function signature
 */
export type ClassifierFn = (input: string) => Promise<{
  blocked: boolean;
  confidence: number;
  raw?: unknown;
}>;

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  name: string;               // Benchmark name for reporting
  classifier: ClassifierFn;   // The classifier to test
  concurrency?: number;       // Max parallel executions (default: 5)
  timeoutMs?: number;         // Per-case timeout (default: 30000)
  maxCases?: number;          // Limit total cases (for quick tests)
  categories?: string[];      // Filter to specific categories
  outputDir?: string;         // Where to save results (default: data/)
  verbose?: boolean;          // Print progress
}

/**
 * Per-category metrics
 */
export interface CategoryMetrics {
  category: string;
  total: number;
  tp: number;                 // True positives (blocked & should block)
  fp: number;                 // False positives (blocked & should pass)
  tn: number;                 // True negatives (passed & should pass)
  fn: number;                 // False negatives (passed & should block)
  tpr: number;                // True positive rate (recall)
  fpr: number;                // False positive rate
  tnr: number;                // True negative rate (specificity)
  precision: number;
  f1: number;
  avgLatencyMs: number;
}

/**
 * Full benchmark results
 */
export interface BenchmarkResults {
  name: string;
  timestamp: string;
  config: {
    concurrency: number;
    timeoutMs: number;
    totalCases: number;
    filteredCategories: string[] | null;
  };
  overall: CategoryMetrics;
  byCategory: CategoryMetrics[];
  latency: {
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
  };
  cost: {
    estimatedTokens: number;
    estimatedUsd: number;
  };
  errors: Array<{ id: string; error: string }>;
  duration: {
    totalMs: number;
    avgPerCaseMs: number;
  };
}

// ============================================================================
// Core Runner
// ============================================================================

/**
 * Run a benchmark with the given test cases and classifier
 */
export async function runBenchmark(
  testCases: TestCase[],
  config: BenchmarkConfig
): Promise<BenchmarkResults> {
  const startTime = Date.now();
  const concurrency = config.concurrency ?? 5;
  const timeoutMs = config.timeoutMs ?? 30000;

  // Filter cases if needed
  let cases = testCases;
  if (config.categories?.length) {
    cases = cases.filter(c => config.categories!.includes(c.category));
  }
  if (config.maxCases && cases.length > config.maxCases) {
    cases = cases.slice(0, config.maxCases);
  }

  if (config.verbose) {
    console.log(`\n[${config.name}] Running ${cases.length} test cases (concurrency: ${concurrency})`);
  }

  // Run classifications with concurrency limit
  const results: ClassificationResult[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < cases.length; i += concurrency) {
    const batch = cases.slice(i, i + concurrency);
    const batchPromises = batch.map(tc => classifyWithTimeout(tc, config.classifier, timeoutMs));
    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      results.push(result);
      if (result.error) {
        errors.push({ id: result.testCase.id, error: result.error });
      }
    }

    if (config.verbose) {
      const done = Math.min(i + concurrency, cases.length);
      const pct = ((done / cases.length) * 100).toFixed(0);
      process.stdout.write(`\r  Progress: ${done}/${cases.length} (${pct}%)`);
    }
  }

  if (config.verbose) {
    console.log(); // newline after progress
  }

  // Calculate metrics
  const overall = calculateMetrics("overall", results);
  const byCategory = calculateCategoryMetrics(results);
  const latencyStats = calculateLatencyStats(results);
  const costEstimate = estimateTotalCost(cases.map(c => c.input));

  const benchmarkResults: BenchmarkResults = {
    name: config.name,
    timestamp: new Date().toISOString(),
    config: {
      concurrency,
      timeoutMs,
      totalCases: cases.length,
      filteredCategories: config.categories ?? null,
    },
    overall,
    byCategory,
    latency: latencyStats,
    cost: costEstimate,
    errors,
    duration: {
      totalMs: Date.now() - startTime,
      avgPerCaseMs: (Date.now() - startTime) / cases.length,
    },
  };

  // Save results
  if (config.outputDir !== null) {
    await saveResults(benchmarkResults, config.outputDir ?? "data");
  }

  return benchmarkResults;
}

/**
 * Classify a single test case with timeout
 */
async function classifyWithTimeout(
  testCase: TestCase,
  classifier: ClassifierFn,
  timeoutMs: number
): Promise<ClassificationResult> {
  const startTime = Date.now();

  try {
    const result = await Promise.race([
      classifier(testCase.input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeoutMs)
      ),
    ]);

    return {
      testCase,
      blocked: result.blocked,
      confidence: result.confidence,
      latencyMs: Date.now() - startTime,
      raw: result.raw,
    };
  } catch (error) {
    return {
      testCase,
      blocked: false,  // Fail open on error
      confidence: 0,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Metrics Calculation
// ============================================================================

function calculateMetrics(category: string, results: ClassificationResult[]): CategoryMetrics {
  const total = results.length;
  if (total === 0) {
    return {
      category,
      total: 0,
      tp: 0, fp: 0, tn: 0, fn: 0,
      tpr: 0, fpr: 0, tnr: 0, precision: 0, f1: 0,
      avgLatencyMs: 0,
    };
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  let totalLatency = 0;

  for (const r of results) {
    const shouldBlock = r.testCase.expectedBlock;
    const didBlock = r.blocked;

    if (shouldBlock && didBlock) tp++;
    else if (!shouldBlock && didBlock) fp++;
    else if (!shouldBlock && !didBlock) tn++;
    else if (shouldBlock && !didBlock) fn++;

    totalLatency += r.latencyMs;
  }

  const tpr = tp + fn > 0 ? tp / (tp + fn) : 0;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
  const tnr = tn + fp > 0 ? tn / (tn + fp) : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const f1 = precision + tpr > 0 ? 2 * (precision * tpr) / (precision + tpr) : 0;

  return {
    category,
    total,
    tp, fp, tn, fn,
    tpr, fpr, tnr, precision, f1,
    avgLatencyMs: totalLatency / total,
  };
}

function calculateCategoryMetrics(results: ClassificationResult[]): CategoryMetrics[] {
  const byCategory = new Map<string, ClassificationResult[]>();

  for (const r of results) {
    const cat = r.testCase.category;
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(r);
  }

  return Array.from(byCategory.entries())
    .map(([category, categoryResults]) => calculateMetrics(category, categoryResults))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function calculateLatencyStats(results: ClassificationResult[]): BenchmarkResults["latency"] {
  if (results.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const len = latencies.length;

  return {
    p50: latencies[Math.floor(len * 0.5)],
    p95: latencies[Math.floor(len * 0.95)],
    p99: latencies[Math.floor(len * 0.99)],
    min: latencies[0],
    max: latencies[len - 1],
  };
}

function estimateTotalCost(inputs: string[]): { estimatedTokens: number; estimatedUsd: number } {
  let totalTokens = 0;
  let totalUsd = 0;

  for (const input of inputs) {
    const cost = estimateCost(input.length, 1, "default");
    totalTokens += cost.inputTokens + cost.outputTokens;
    totalUsd += cost.costUsd;
  }

  return { estimatedTokens: totalTokens, estimatedUsd: totalUsd };
}

// ============================================================================
// Output
// ============================================================================

async function saveResults(results: BenchmarkResults, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = results.timestamp.replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${results.name}-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  await fs.writeFile(filepath, JSON.stringify(results, null, 2));
}

/**
 * Print a human-readable summary of benchmark results
 */
export function printResults(results: BenchmarkResults): void {
  console.log("\n" + "=".repeat(70));
  console.log(`BENCHMARK: ${results.name}`);
  console.log("=".repeat(70));

  console.log(`\nTimestamp: ${results.timestamp}`);
  console.log(`Total cases: ${results.config.totalCases}`);
  console.log(`Duration: ${(results.duration.totalMs / 1000).toFixed(1)}s (${results.duration.avgPerCaseMs.toFixed(0)}ms/case)`);

  // Overall metrics
  console.log("\n--- OVERALL METRICS ---");
  printMetricsTable([results.overall]);

  // Per-category metrics
  if (results.byCategory.length > 1) {
    console.log("\n--- BY CATEGORY ---");
    printMetricsTable(results.byCategory);
  }

  // Latency
  console.log("\n--- LATENCY ---");
  console.log(`  p50: ${results.latency.p50.toFixed(0)}ms`);
  console.log(`  p95: ${results.latency.p95.toFixed(0)}ms`);
  console.log(`  p99: ${results.latency.p99.toFixed(0)}ms`);
  console.log(`  min: ${results.latency.min.toFixed(0)}ms, max: ${results.latency.max.toFixed(0)}ms`);

  // Cost
  console.log("\n--- COST ESTIMATE ---");
  console.log(`  Tokens: ~${results.cost.estimatedTokens.toLocaleString()}`);
  console.log(`  USD: ~$${results.cost.estimatedUsd.toFixed(4)}`);

  // Errors
  if (results.errors.length > 0) {
    console.log(`\n--- ERRORS (${results.errors.length}) ---`);
    for (const err of results.errors.slice(0, 5)) {
      console.log(`  ${err.id}: ${err.error}`);
    }
    if (results.errors.length > 5) {
      console.log(`  ... and ${results.errors.length - 5} more`);
    }
  }

  console.log("\n" + "=".repeat(70));
}

function printMetricsTable(metrics: CategoryMetrics[]): void {
  // Header
  console.log(
    "  " +
    "Category".padEnd(25) +
    "N".padStart(6) +
    "TPR".padStart(8) +
    "FPR".padStart(8) +
    "Prec".padStart(8) +
    "F1".padStart(8) +
    "Lat(ms)".padStart(10)
  );
  console.log("  " + "-".repeat(73));

  // Rows
  for (const m of metrics) {
    console.log(
      "  " +
      m.category.slice(0, 24).padEnd(25) +
      String(m.total).padStart(6) +
      `${(m.tpr * 100).toFixed(1)}%`.padStart(8) +
      `${(m.fpr * 100).toFixed(1)}%`.padStart(8) +
      `${(m.precision * 100).toFixed(1)}%`.padStart(8) +
      m.f1.toFixed(3).padStart(8) +
      m.avgLatencyMs.toFixed(0).padStart(10)
    );
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Combine multiple test case arrays, deduplicating by ID
 */
export function combineTestCases(...sources: TestCase[][]): TestCase[] {
  const seen = new Set<string>();
  const combined: TestCase[] = [];

  for (const source of sources) {
    for (const tc of source) {
      if (!seen.has(tc.id)) {
        seen.add(tc.id);
        combined.push(tc);
      }
    }
  }

  return combined;
}

/**
 * Filter test cases by category
 */
export function filterByCategory(cases: TestCase[], categories: string[]): TestCase[] {
  const categorySet = new Set(categories);
  return cases.filter(tc => categorySet.has(tc.category));
}

/**
 * Sample N test cases randomly (with optional stratification by category)
 */
export function sampleCases(cases: TestCase[], n: number, stratify = false): TestCase[] {
  if (cases.length <= n) return cases;

  if (!stratify) {
    // Simple random sample
    const shuffled = [...cases].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  // Stratified sample: proportional per category
  const byCategory = new Map<string, TestCase[]>();
  for (const tc of cases) {
    if (!byCategory.has(tc.category)) {
      byCategory.set(tc.category, []);
    }
    byCategory.get(tc.category)!.push(tc);
  }

  const sampled: TestCase[] = [];
  const categoryCount = byCategory.size;
  const perCategory = Math.max(1, Math.floor(n / categoryCount));

  for (const [, categoryCases] of byCategory) {
    const shuffled = [...categoryCases].sort(() => Math.random() - 0.5);
    sampled.push(...shuffled.slice(0, perCategory));
  }

  // If we need more to reach n, add randomly from remaining
  if (sampled.length < n) {
    const sampledIds = new Set(sampled.map(tc => tc.id));
    const remaining = cases.filter(tc => !sampledIds.has(tc.id));
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    sampled.push(...shuffled.slice(0, n - sampled.length));
  }

  return sampled.slice(0, n);
}
