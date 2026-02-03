/**
 * DATDP vs CCFC Comparison Benchmark
 *
 * Runs the same prompts through both configurations and compares results.
 * Usage: npx tsx tests/benchmarks/compare-datdp-ccfc.ts [limit]
 */

import "dotenv/config";
import { evaluatePrompt, shouldBlock, runHeuristics, type EvaluationResult } from "../../src/evaluator.js";
import { logBatch, createLogEntry, type EvaluationLogEntry } from "./logger.js";
import * as fs from "fs/promises";
import * as path from "path";

const DATDP_DATA_DIR = "tests/fixtures/datdp/data/datasets";

interface ComparisonResult {
  prompt: string;
  expectedBlock: boolean;
  dataset: string;
  datdp: { blocked: boolean; result: EvaluationResult };
  ccfc: { blocked: boolean; result: EvaluationResult };
  heuristics: { score: number; flags: string[] };
}

async function loadCSVLines(filename: string): Promise<string[]> {
  const filepath = path.join(DATDP_DATA_DIR, filename);
  const content = await fs.readFile(filepath, "utf-8");
  return content
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

async function runComparison(maxPrompts?: number): Promise<void> {
  console.log("=".repeat(70));
  console.log("DATDP vs CCFC COMPARISON");
  console.log("Heuristics: DISABLED");
  console.log("=".repeat(70));

  // Load datasets
  const datasets: Array<{ file: string; name: string; expectBlock: boolean }> = [
    { file: "BoN_paper_text_jailbreaks_prompts_only.csv", name: "BoN Jailbreaks", expectBlock: true },
    { file: "normal_prompts_250.csv", name: "Normal Prompts", expectBlock: false },
    { file: "original_prompts.csv", name: "Original Harmful", expectBlock: true },
  ];

  const allResults: ComparisonResult[] = [];
  const logEntries: EvaluationLogEntry[] = [];

  for (const dataset of datasets) {
    let prompts = await loadCSVLines(dataset.file);
    if (maxPrompts && prompts.length > maxPrompts) {
      prompts = prompts.slice(0, maxPrompts);
    }

    console.log(`\n[${dataset.name}] Testing ${prompts.length} prompts...`);

    for (const prompt of prompts) {
      const heuristics = runHeuristics(prompt);

      // Run DATDP (no CCFC)
      const datdpResult = await evaluatePrompt(prompt, {
        verbose: false,
        iterations: 3,
        timeout: 15000,
        skipHeuristics: true,
        useCCFC: false,
        noCache: true,
      });

      // Run CCFC
      const ccfcResult = await evaluatePrompt(prompt, {
        verbose: false,
        iterations: 3,
        timeout: 15000,
        skipHeuristics: true,
        useCCFC: true,
        noCache: true,
      });

      allResults.push({
        prompt,
        expectedBlock: dataset.expectBlock,
        dataset: dataset.name,
        datdp: { blocked: shouldBlock(datdpResult), result: datdpResult },
        ccfc: { blocked: shouldBlock(ccfcResult), result: ccfcResult },
        heuristics: { score: heuristics.score, flags: heuristics.flags },
      });

      // Log both evaluations
      logEntries.push(createLogEntry(
        prompt,
        `${dataset.name}-datdp`,
        dataset.expectBlock,
        heuristics,
        datdpResult,
        shouldBlock(datdpResult)
      ));
      logEntries.push(createLogEntry(
        prompt,
        `${dataset.name}-ccfc`,
        dataset.expectBlock,
        heuristics,
        ccfcResult,
        shouldBlock(ccfcResult)
      ));
    }
  }

  // Log all evaluations
  await logBatch(logEntries, "comparison-evaluations.jsonl");

  // Calculate metrics
  const malicious = allResults.filter(r => r.expectedBlock);
  const benign = allResults.filter(r => !r.expectedBlock);

  const datdpTP = malicious.filter(r => r.datdp.blocked).length;
  const datdpFP = benign.filter(r => r.datdp.blocked).length;
  const datdpTPR = datdpTP / malicious.length;
  const datdpFPR = datdpFP / benign.length;
  const datdpPrecision = datdpTP / (datdpTP + datdpFP) || 0;
  const datdpF1 = 2 * (datdpPrecision * datdpTPR) / (datdpPrecision + datdpTPR) || 0;

  const ccfcTP = malicious.filter(r => r.ccfc.blocked).length;
  const ccfcFP = benign.filter(r => r.ccfc.blocked).length;
  const ccfcTPR = ccfcTP / malicious.length;
  const ccfcFPR = ccfcFP / benign.length;
  const ccfcPrecision = ccfcTP / (ccfcTP + ccfcFP) || 0;
  const ccfcF1 = 2 * (ccfcPrecision * ccfcTPR) / (ccfcPrecision + ccfcTPR) || 0;

  // Print results
  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));

  console.log("\n                    DATDP       CCFC        Winner");
  console.log("-".repeat(55));
  console.log(`TPR (↑ better)      ${(datdpTPR * 100).toFixed(1).padStart(5)}%      ${(ccfcTPR * 100).toFixed(1).padStart(5)}%      ${datdpTPR > ccfcTPR ? "DATDP" : ccfcTPR > datdpTPR ? "CCFC" : "TIE"}`);
  console.log(`FPR (↓ better)      ${(datdpFPR * 100).toFixed(1).padStart(5)}%      ${(ccfcFPR * 100).toFixed(1).padStart(5)}%      ${datdpFPR < ccfcFPR ? "DATDP" : ccfcFPR < datdpFPR ? "CCFC" : "TIE"}`);
  console.log(`Precision           ${(datdpPrecision * 100).toFixed(1).padStart(5)}%      ${(ccfcPrecision * 100).toFixed(1).padStart(5)}%      ${datdpPrecision > ccfcPrecision ? "DATDP" : ccfcPrecision > datdpPrecision ? "CCFC" : "TIE"}`);
  console.log(`F1 Score            ${datdpF1.toFixed(3).padStart(5)}       ${ccfcF1.toFixed(3).padStart(5)}       ${datdpF1 > ccfcF1 ? "DATDP" : ccfcF1 > datdpF1 ? "CCFC" : "TIE"}`);

  // Disagreements
  const disagreements = allResults.filter(r => r.datdp.blocked !== r.ccfc.blocked);
  console.log(`\nDisagreements: ${disagreements.length}/${allResults.length} (${(disagreements.length / allResults.length * 100).toFixed(1)}%)`);

  if (disagreements.length > 0) {
    console.log("\nSample disagreements:");
    for (const d of disagreements.slice(0, 5)) {
      const datdpVerdict = d.datdp.blocked ? "BLOCK" : "PASS";
      const ccfcVerdict = d.ccfc.blocked ? "BLOCK" : "PASS";
      const correct = d.expectedBlock ? "should block" : "should pass";
      console.log(`  "${d.prompt.slice(0, 50)}..."`);
      console.log(`    DATDP: ${datdpVerdict}, CCFC: ${ccfcVerdict} (${correct})`);
    }
  }

  // False positives detail
  const datdpFPs = benign.filter(r => r.datdp.blocked);
  const ccfcFPs = benign.filter(r => r.ccfc.blocked);

  if (datdpFPs.length > 0) {
    console.log("\nDATDP False Positives:");
    for (const fp of datdpFPs.slice(0, 5)) {
      console.log(`  "${fp.prompt.slice(0, 60)}"`);
    }
  }

  if (ccfcFPs.length > 0) {
    console.log("\nCCFC False Positives:");
    for (const fp of ccfcFPs.slice(0, 5)) {
      console.log(`  "${fp.prompt.slice(0, 60)}"`);
    }
  }

  // Save full results
  await fs.writeFile(
    "data/comparison-results.json",
    JSON.stringify({
      timestamp: new Date().toISOString(),
      config: { maxPrompts, heuristics: false },
      summary: {
        datdp: { tpr: datdpTPR, fpr: datdpFPR, precision: datdpPrecision, f1: datdpF1 },
        ccfc: { tpr: ccfcTPR, fpr: ccfcFPR, precision: ccfcPrecision, f1: ccfcF1 },
      },
      disagreements: disagreements.length,
      results: allResults,
    }, null, 2)
  );

  console.log("\nResults saved to data/comparison-results.json");
  console.log("Evaluations logged to data/comparison-evaluations.jsonl");
}

// CLI
const maxPrompts = parseInt(process.argv[2] || "0") || undefined;
runComparison(maxPrompts).catch(console.error);
