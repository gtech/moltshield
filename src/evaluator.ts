/**
 * MoltShield Evaluator
 *
 * Main entry point. Thin wrapper around strategy tree execution.
 */

import type { EvaluatorConfig, EvaluationResult } from "./types.js";
import { resolveConfig } from "./config.js";
import { getFromCache, setCache } from "./cache.js";
import { execute, PRESET_DATDP, PRESET_CCFC, type StrategyNode, type StrategyResult } from "./strategy.js";

// Re-exports for backwards compatibility
export { runHeuristics, type HeuristicResult } from "./heuristics.js";
export { clearCache, clearImageCache, clearExchangeCache, clearAllCaches } from "./cache.js";
export { evaluateExchange } from "./exchange.js";
export { evaluateImage, evaluateImages } from "./image.js";
export { execute, type StrategyNode, type StrategyResult, type Verdict } from "./strategy.js";
export * from "./strategy.js";  // presets
export { buildSystemPrompt, buildUserPrompt } from "./datdp.js";
export { ASSESSMENT_TASKS } from "./config.js";
export type { EvaluationResult, ImageEvaluationResult, ExchangeEvaluationResult, EvaluatorConfig, DATDPResult } from "./types.js";

// ============================================================================
// Main Evaluation Function
// ============================================================================

export interface EvaluateOptions extends EvaluatorConfig {
  /** Custom strategy tree (overrides useCCFC) */
  strategy?: StrategyNode;
}

/**
 * Evaluate content for adversarial patterns.
 */
export async function evaluatePrompt(
  content: string,
  options: EvaluateOptions = {}
): Promise<EvaluationResult> {
  const config = await resolveConfig(options);

  // Check cache
  if (!config.noCache) {
    const cached = getFromCache(content);
    if (cached) {
      if (config.verbose) console.log("[MoltShield] Cache hit");
      return cached;
    }
  }

  // Select strategy tree
  const strategy = options.strategy ?? (config.useCCFC ? PRESET_CCFC : PRESET_DATDP);

  // Execute strategy tree
  const strategyResult = await execute(content, strategy, config);

  // Convert to EvaluationResult
  // "escalate" with no target is treated as "pass" (fail-open)
  const result: EvaluationResult = {
    safe: strategyResult.verdict !== "block",
    confidence: strategyResult.confidence,
    flags: [],
    reasoning: JSON.stringify(strategyResult.trace?.slice(-1)[0]?.data ?? {}),
    datdp: extractDATDPData(strategyResult),
    ccfc: extractCCFCData(strategyResult),
  };

  if (!config.noCache) setCache(content, result);
  return result;
}

/**
 * Check if content should be blocked based on evaluation result.
 */
export function shouldBlock(result: EvaluationResult): boolean {
  return !result.safe;
}

/**
 * Evaluate multiple content items
 */
export async function evaluateContext(
  items: string[],
  options: EvaluateOptions = {}
): Promise<EvaluationResult> {
  const combined = items.join("\n---\n");
  return evaluatePrompt(combined, options);
}

// ============================================================================
// Helpers
// ============================================================================

function extractDATDPData(result: StrategyResult): EvaluationResult["datdp"] {
  // Find DATDP trace entry
  const datdpTrace = result.trace?.find(t => t.node.startsWith("datdp"));
  if (!datdpTrace?.data) return undefined;

  const data = datdpTrace.data as {
    yesVotes?: number;
    noVotes?: number;
    unclearVotes?: number;
    score?: number;
  };

  return {
    iterations: (data.yesVotes ?? 0) + (data.noVotes ?? 0) + (data.unclearVotes ?? 0),
    yesVotes: data.yesVotes ?? 0,
    noVotes: data.noVotes ?? 0,
    unclearVotes: data.unclearVotes ?? 0,
    score: data.score ?? 0,
  };
}

function extractCCFCData(result: StrategyResult): EvaluationResult["ccfc"] {
  // Find CCFC trace entry (full CCFC node, not just extract)
  const ccfcTrace = result.trace?.find(t => t.node.startsWith("ccfc("));
  if (!ccfcTrace?.data) return undefined;

  const data = ccfcTrace.data as {
    core?: string;
    coreResult?: { blocked: boolean; score: number; yesVotes: number; noVotes: number };
    cfcResult?: { blocked: boolean; score: number; yesVotes: number; noVotes: number };
    blockedBy?: string;
  };

  return {
    coreExtract: data.core ?? "",
    coreOnlyResult: {
      blocked: data.coreResult?.blocked ?? false,
      score: data.coreResult?.score ?? 0,
      yesVotes: data.coreResult?.yesVotes ?? 0,
      noVotes: data.coreResult?.noVotes ?? 0,
    },
    cfcResult: {
      blocked: data.cfcResult?.blocked ?? false,
      score: data.cfcResult?.score ?? 0,
      yesVotes: data.cfcResult?.yesVotes ?? 0,
      noVotes: data.cfcResult?.noVotes ?? 0,
    },
    blockedBy: (data.blockedBy as "core" | "cfc" | "both" | "none") ?? "none",
  };
}
