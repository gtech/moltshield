/**
 * Exchange Dataset Generator
 *
 * Sends injection cases to Kimi-K2.5 as the victim model and records
 * real responses for manual labeling.
 *
 * Features:
 * - Adaptive binary exponential concurrency (doubles on success, halves on 429/timeout)
 * - Resume support (skips already-generated IDs)
 * - Quota tracking via Synthetic API
 * - JSONL output for incremental writes
 *
 * Usage:
 *   npx tsx tests/benchmarks/tools/generate-exchanges.ts [startConcurrency] [maxCases]
 */

import "dotenv/config";
import * as fs from "fs";
import * as fsp from "fs/promises";
import { resolveConfig } from "../../../src/config.js";
import { callLLM } from "../../../src/providers.js";
import {
  loadAllInjection,
  loadAllBenign,
} from "../framework/loaders.js";
import type { TestCase } from "../framework/harness.js";

// ============================================================================
// Types
// ============================================================================

interface ExchangeRecord {
  id: string;
  category: string;
  source: string;
  input: string;
  response: string | null;
  userRequest: string;
  attackGoal: string;
  expectedBlock: boolean;
  latencyMs: number;
  timestamp: string;
  error: string | null;
}

// ============================================================================
// Quota Tracking
// ============================================================================

async function checkQuota(apiKey: string): Promise<{ used: number; limit: number } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://api.synthetic.new/v2/quotas", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      subscription: { limit: number; requests: number };
    };
    return { used: data.subscription.requests, limit: data.subscription.limit };
  } catch {
    return null;
  }
}

// ============================================================================
// Resume Support
// ============================================================================

async function loadExistingIds(outputPath: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const content = await fsp.readFile(outputPath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as ExchangeRecord;
        // Only skip if we got a real response (not an error)
        if (record.response !== null) {
          ids.add(record.id);
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file doesn't exist yet
  }
  return ids;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const startConcurrency = parseInt(process.argv[2] || "20");
  const maxCases = parseInt(process.argv[3] || "0"); // 0 = all

  const OUTPUT_PATH = "tests/benchmarks/data/exchange-responses.jsonl";
  const SYSTEM_PROMPT = "You are a helpful AI assistant.";
  const MAX_TOKENS = 2000;
  const TIMEOUT_MS = 180_000; // 3 min - reasoning models can be slow
  const MIN_CONCURRENCY = 1;
  const MAX_CONCURRENCY = 80;
  const QUOTA_CHECK_INTERVAL = 50; // check quota every N completions

  console.log("=".repeat(70));
  console.log("EXCHANGE DATASET GENERATOR");
  console.log("=".repeat(70));

  // Load config
  const baseConfig = await resolveConfig({ verbose: false });
  const config = { ...baseConfig, timeout: TIMEOUT_MS };
  console.log(`Model (victim): ${config.model}`);
  console.log(`Evaluator: ${config.evaluator}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms`);
  console.log(`Max tokens: ${MAX_TOKENS}`);

  // Check initial quota
  const initialQuota = await checkQuota(config.apiKey);
  if (initialQuota) {
    console.log(`Quota: ${initialQuota.used}/${initialQuota.limit} used`);
  }

  // Load cases
  console.log("\nLoading datasets...");
  const [injection, benign] = await Promise.all([
    loadAllInjection(),
    loadAllBenign(),
  ]);

  let allCases: TestCase[] = [...injection, ...benign];
  console.log(`  Injection cases: ${injection.length}`);
  console.log(`  Benign cases: ${benign.length}`);
  console.log(`  Total: ${allCases.length}`);

  if (maxCases > 0) {
    allCases = allCases.slice(0, maxCases);
    console.log(`  Limited to: ${allCases.length}`);
  }

  // Resume support
  const existingIds = await loadExistingIds(OUTPUT_PATH);
  const pendingCases = allCases.filter(tc => !existingIds.has(tc.id));
  console.log(`  Already generated: ${existingIds.size}`);
  console.log(`  Pending: ${pendingCases.length}\n`);

  if (pendingCases.length === 0) {
    console.log("Nothing to generate. All cases already have responses.");
    return;
  }

  // Sync write helper - survives crashes, no buffering
  function appendRecord(record: ExchangeRecord) {
    fs.appendFileSync(OUTPUT_PATH, JSON.stringify(record) + "\n");
  }

  // Retry config
  const MAX_RETRIES = 3;
  const retryCount = new Map<string, number>(); // id -> attempt count

  // Adaptive concurrency state
  let concurrency = Math.min(startConcurrency, MAX_CONCURRENCY);
  let completed = 0;
  let errors = 0;
  let retried = 0;
  let permanentFailures = 0;
  let consecutiveSuccesses = 0;
  let shuttingDown = false;
  const startTime = Date.now();

  // Graceful shutdown on SIGINT/SIGTERM
  function handleShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n\n⚠ Received ${signal}. Finishing current batch then exiting...`);
    console.log(`  Progress saved: ${completed} completed, ${errors} errors, ${retried} retried`);
    console.log(`  Resume with: npx tsx tests/benchmarks/tools/generate-exchanges.ts`);
  }
  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  console.log("-".repeat(70));
  console.log(`Starting generation (concurrency: ${concurrency})`);
  console.log("-".repeat(70));

  // Work queue: starts with pending cases, failed cases get re-appended
  const workQueue: TestCase[] = [...pendingCases];
  const totalOriginal = pendingCases.length;
  let processed = 0; // total attempts (for progress display)

  while (workQueue.length > 0 && !shuttingDown) {
    const batchSize = Math.min(concurrency, workQueue.length);
    const batch = workQueue.splice(0, batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(async (tc): Promise<{ tc: TestCase; success: boolean; rateLimited: boolean }> => {
        const start = Date.now();
        const attempt = (retryCount.get(tc.id) || 0) + 1;

        // Extract metadata for labeler
        const userRequest = (tc.metadata?.userRequest as string) ||
          (tc.metadata?.userInstruction as string) || "";
        const attackGoal = (tc.metadata?.injectionGoal as string) ||
          (tc.metadata?.attackerInstruction as string) || "";
        const source = (tc.metadata?.source as string) || "unknown";

        try {
          const response = await callLLM(SYSTEM_PROMPT, tc.input, config, MAX_TOKENS);
          const latency = Date.now() - start;

          const record: ExchangeRecord = {
            id: tc.id,
            category: tc.category,
            source,
            input: tc.input,
            response,
            userRequest,
            attackGoal,
            expectedBlock: tc.expectedBlock,
            latencyMs: latency,
            timestamp: new Date().toISOString(),
            error: null,
          };

          appendRecord(record);
          completed++;
          processed++;

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          const rate = (completed / ((Date.now() - startTime) / 60000)).toFixed(1);
          const preview = response.slice(0, 80).replace(/\n/g, " ");
          const retryTag = attempt > 1 ? ` [retry ${attempt - 1}]` : "";
          console.log(
            `  [${completed}/${totalOriginal}] ${tc.id} (${latency}ms)${retryTag} ` +
            `| c=${concurrency} q=${workQueue.length} | ${rate}/min | ${elapsed}s` +
            `\n    → ${preview}...`
          );

          return { tc, success: true, rateLimited: false };
        } catch (err) {
          const latency = Date.now() - start;
          const errMsg = String(err);
          const isRateLimit = errMsg.includes("429") || errMsg.includes("rate");
          const isTimeout = errMsg.includes("abort") || errMsg.includes("timeout");
          const isRetryable = isRateLimit || isTimeout;

          processed++;
          const retryTag = attempt > 1 ? ` [retry ${attempt - 1}]` : "";

          if (isRetryable && attempt < MAX_RETRIES) {
            // Will retry - don't write error record yet
            retryCount.set(tc.id, attempt);
            retried++;
            console.log(
              `  [${completed}/${totalOriginal}] ${tc.id} RETRY-QUEUED (${latency}ms)${retryTag} | c=${concurrency} q=${workQueue.length}` +
              `\n    ↻ ${errMsg.slice(0, 100)} (attempt ${attempt}/${MAX_RETRIES})`
            );
          } else {
            // Permanent failure - write error record
            const record: ExchangeRecord = {
              id: tc.id,
              category: tc.category,
              source,
              input: tc.input,
              response: null,
              userRequest,
              attackGoal,
              expectedBlock: tc.expectedBlock,
              latencyMs: latency,
              timestamp: new Date().toISOString(),
              error: `${errMsg} (after ${attempt} attempt${attempt > 1 ? "s" : ""})`,
            };

            appendRecord(record);
            errors++;
            permanentFailures++;
            console.log(
              `  [${completed}/${totalOriginal}] ${tc.id} FAILED (${latency}ms)${retryTag} | c=${concurrency} q=${workQueue.length}` +
              `\n    ✗ ${errMsg.slice(0, 100)} (gave up after ${attempt} attempts)`
            );
          }

          return { tc, success: false, rateLimited: isRetryable };
        }
      })
    );

    // Collect failed cases for retry
    const failedForRetry: TestCase[] = [];
    const results = batchResults.map(r => {
      if (r.status === "fulfilled") {
        const { tc, success, rateLimited } = r.value;
        if (!success && rateLimited) {
          const attempt = retryCount.get(tc.id) || 0;
          if (attempt < MAX_RETRIES) {
            failedForRetry.push(tc);
          }
        }
        return { success, rateLimited };
      }
      return { success: false, rateLimited: true };
    });

    // Re-append retryable failures to the end of the work queue
    if (failedForRetry.length > 0) {
      workQueue.push(...failedForRetry);
      console.log(`  ↻ ${failedForRetry.length} case(s) re-queued for retry (queue: ${workQueue.length})`);
    }

    // Analyze batch results for concurrency adjustment
    const batchSuccesses = results.filter(r => r.success).length;
    const batchRateLimits = results.filter(r => r.rateLimited).length;

    if (batchRateLimits > 0) {
      // Rate limited or timeout: halve concurrency
      const oldConcurrency = concurrency;
      concurrency = Math.max(MIN_CONCURRENCY, Math.floor(concurrency / 2));
      consecutiveSuccesses = 0;
      if (concurrency !== oldConcurrency) {
        console.log(`  ⚠ Rate limited: concurrency ${oldConcurrency} → ${concurrency}`);
      }
      // Pause proportional to failure rate
      if (batchRateLimits > batchSize / 2) {
        const pauseMs = 10000; // 10s pause on heavy rate limiting
        console.log(`  ⏳ Pausing ${pauseMs / 1000}s (${batchRateLimits}/${batchSize} failed)...`);
        await new Promise(r => setTimeout(r, pauseMs));
      } else if (batchRateLimits > 0) {
        console.log(`  ⏳ Brief pause 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    } else if (batchSuccesses === batchSize) {
      // All succeeded: consider doubling
      consecutiveSuccesses += batchSize;
      if (consecutiveSuccesses >= concurrency * 2) {
        const oldConcurrency = concurrency;
        concurrency = Math.min(MAX_CONCURRENCY, concurrency * 2);
        consecutiveSuccesses = 0;
        if (concurrency !== oldConcurrency) {
          console.log(`  ↑ All clear: concurrency ${oldConcurrency} → ${concurrency}`);
        }
      }
    }

    // Periodic quota check
    if (processed % QUOTA_CHECK_INTERVAL === 0 && processed > 0) {
      const quota = await checkQuota(config.apiKey);
      if (quota) {
        console.log(`  📊 Quota: ${quota.used}/${quota.limit} credits used`);
      }
    }
  }

  // Final summary
  const totalElapsed = (Date.now() - startTime) / 1000;
  const finalQuota = await checkQuota(config.apiKey);

  console.log("\n" + "=".repeat(70));
  console.log("GENERATION COMPLETE");
  console.log("=".repeat(70));
  console.log(`  Completed: ${completed}`);
  console.log(`  Retried: ${retried} (${permanentFailures} gave up after ${MAX_RETRIES} attempts)`);
  console.log(`  Permanent errors: ${errors}`);
  console.log(`  Total time: ${totalElapsed.toFixed(1)}s`);
  console.log(`  Avg rate: ${(completed / (totalElapsed / 60)).toFixed(1)}/min`);
  if (finalQuota) {
    console.log(`  Credits used: ${finalQuota.used}/${finalQuota.limit}`);
    if (initialQuota) {
      console.log(`  Credits this run: ${finalQuota.used - initialQuota.used}`);
    }
  }
  console.log(`  Output: ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
