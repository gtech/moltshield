/**
 * MoltShield - Pre-inference defense for LLM applications
 *
 * @example Basic usage
 * ```typescript
 * import { evaluatePrompt, shouldBlock } from "moltshield";
 *
 * const result = await evaluatePrompt("user input here");
 * if (shouldBlock(result)) {
 *   // reject the input
 * }
 * ```
 *
 * @example Custom strategy tree
 * ```typescript
 * import { evaluatePrompt } from "moltshield";
 *
 * const result = await evaluatePrompt(content, {
 *   strategy: {
 *     type: "serial",
 *     steps: [
 *       { type: "heuristics", escalateAbove: 5 },
 *       { type: "datdp", iterations: 3 },
 *     ]
 *   }
 * });
 * ```
 */

// Main API
export {
  evaluatePrompt,
  evaluateContext,
  shouldBlock,
  type EvaluateOptions,
} from "./evaluator.js";

// Strategy tree
export {
  execute,
  type StrategyNode,
  type StrategyResult,
  type StrategyContext,
  type Verdict,
  type TraceEntry,
  type HeuristicsNode,
  type DATDPNode,
  type CCFCExtractNode,
  type SerialNode,
  type BranchNode,
  type NestNode,
  type ParallelNode,
  PRESET_DATDP,
  PRESET_CCFC,
  PRESET_HEURISTICS_DATDP,
  PRESET_ESCALATION,
  PRESET_PARANOID,
} from "./strategy.js";

// Individual evaluators
export { runHeuristics, type HeuristicResult } from "./heuristics.js";
export { runDATDP, buildSystemPrompt, buildUserPrompt } from "./datdp.js";
export { extractCore, buildCFCContent } from "./ccfc.js";
export { evaluateExchange } from "./exchange.js";
export { evaluateImage, evaluateImages } from "./image.js";

// Config
export { resolveConfig, ASSESSMENT_TASKS } from "./config.js";

// Cache
export { clearCache, clearImageCache, clearExchangeCache, clearAllCaches } from "./cache.js";

// Providers
export { callLLM, callVision } from "./providers.js";

// Types
export type {
  EvaluationResult,
  ImageEvaluationResult,
  ExchangeEvaluationResult,
  EvaluatorConfig,
  ResolvedConfig,
  AssessmentTask,
  DATDPResult,
} from "./types.js";
