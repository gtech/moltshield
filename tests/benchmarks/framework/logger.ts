/**
 * Benchmark Evaluation Logger
 *
 * Logs all evaluation attempts to JSONL for classifier training data.
 * Used by all benchmark scripts.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import type { EvaluationResult, HeuristicResult } from "../../../src/evaluator.js";

const LOG_DIR = "data";

// ============================================================================
// Cost Estimation
// ============================================================================

// Pricing per 1M tokens (input/output) as of 2026-02
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
  // OpenRouter (varies, using estimates)
  "openai/gpt-oss-120b": { input: 0.039, output: 0.19 },
  "openai/gpt-oss-safeguard-20b": { input: 0.075, output: 0.30 },
  "anthropic/claude-haiku-4-5": { input: 1.00, output: 5.00 }, // OpenRouter markup
  "meta-llama/llama-3.2-3b-instruct:free": { input: 0, output: 0 },
  // OpenAI
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  // Default fallback
  "default": { input: 0.50, output: 2.00 },
};

/**
 * Estimate token count from text (rough: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate cost for a single evaluation
 * @param promptLength - Length of prompt in characters
 * @param iterations - Number of DATDP iterations
 * @param model - Model name
 * @param systemPromptLength - Approximate system prompt length (default 500)
 */
export function estimateCost(
  promptLength: number,
  iterations: number,
  model: string = "default",
  systemPromptLength: number = 500
): { inputTokens: number; outputTokens: number; costUsd: number } {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["default"];

  // Input: system prompt + user prompt, repeated per iteration
  // ~4 chars per token
  const inputTokens = Math.ceil((systemPromptLength + promptLength) / 4) * iterations;
  // Output: ~10 tokens per response ("yes", "no", or brief explanation)
  const outputTokens = 10 * iterations;

  const costUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

  return { inputTokens, outputTokens, costUsd };
}

export interface EvaluationLogEntry {
  timestamp: string;
  promptHash: string;
  prompt: string;
  dataset: string;
  expectedBlock: boolean;
  heuristics: HeuristicResult;
  evaluation: EvaluationResult;
  finalBlocked: boolean;
  correct: boolean;
  // Cost tracking (requires evaluator to return token usage)
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  model?: string;
  durationMs?: number;
}

export function hashPrompt(prompt: string): string {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

export async function logEvaluation(
  entry: EvaluationLogEntry,
  logFile: string = "evaluations.jsonl"
): Promise<void> {
  const filePath = path.join(LOG_DIR, logFile);
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.appendFile(filePath, JSON.stringify(entry) + "\n");
}

export async function logBatch(
  entries: EvaluationLogEntry[],
  logFile: string = "evaluations.jsonl"
): Promise<void> {
  if (entries.length === 0) return;
  const filePath = path.join(LOG_DIR, logFile);
  await fs.mkdir(LOG_DIR, { recursive: true });
  const lines = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
  await fs.appendFile(filePath, lines);
}

export function createLogEntry(
  prompt: string,
  dataset: string,
  expectedBlock: boolean,
  heuristics: HeuristicResult,
  evaluation: EvaluationResult,
  finalBlocked: boolean,
  options?: { model?: string; iterations?: number; durationMs?: number }
): EvaluationLogEntry {
  const iterations = options?.iterations ?? evaluation.datdp?.iterations ?? 3;
  const model = options?.model ?? process.env.MOLTSHIELD_MODEL ?? "default";
  const cost = estimateCost(prompt.length, iterations, model);

  return {
    timestamp: new Date().toISOString(),
    promptHash: hashPrompt(prompt),
    prompt,
    dataset,
    expectedBlock,
    heuristics,
    evaluation,
    finalBlocked,
    correct: expectedBlock === finalBlocked,
    usage: {
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      totalTokens: cost.inputTokens + cost.outputTokens,
      estimatedCostUsd: cost.costUsd,
    },
    model,
    durationMs: options?.durationMs,
  };
}
