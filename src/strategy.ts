/**
 * MoltShield Strategy Tree
 *
 * Composable evaluation strategies with serial and matryoshka nesting.
 */

import type { ResolvedConfig } from "./types.js";
import { runHeuristics } from "./heuristics.js";
import { runDATDP } from "./datdp.js";
import { extractCore } from "./ccfc.js";
import { callLLM } from "./providers.js";

// ============================================================================
// Types
// ============================================================================

export type Verdict = "pass" | "block" | "escalate";

export interface StrategyResult {
  verdict: Verdict;
  confidence: number;
  content?: string;      // transformed content (for nesting)
  data?: unknown;        // strategy-specific output
  trace?: TraceEntry[];  // execution trace
}

export interface TraceEntry {
  node: string;
  verdict: Verdict;
  confidence: number;
  durationMs: number;
  data?: unknown;
}

export interface StrategyContext {
  config: ResolvedConfig;
  originalContent: string;
  trace: TraceEntry[];
}

// ============================================================================
// Node Types
// ============================================================================

export interface HeuristicsNode {
  type: "heuristics";
  /** Score threshold to escalate (default: 3) */
  escalateAbove?: number;
  /** Score threshold to block (default: 10) */
  blockAbove?: number;
}

export interface DATDPNode {
  type: "datdp";
  /** Override model */
  model?: string;
  /** Override iterations */
  iterations?: number;
  /** Confidence below this escalates (default: 0.7) */
  escalateBelow?: number;
}

export interface CCFCExtractNode {
  type: "ccfc-extract";
}

export interface CCFCNode {
  type: "ccfc";
  /** Override model */
  model?: string;
  /** Override iterations */
  iterations?: number;
}

export interface PassNode {
  type: "pass";
}

export interface BlockNode {
  type: "block";
}

export interface SerialNode {
  type: "serial";
  steps: StrategyNode[];
}

export interface BranchNode {
  type: "branch";
  on: StrategyNode;
  pass?: StrategyNode;
  block?: StrategyNode;
  escalate?: StrategyNode;
}

export interface NestNode {
  type: "nest";
  transform: StrategyNode;
  inner: StrategyNode;
}

export interface ParallelNode {
  type: "parallel";
  strategies: StrategyNode[];
  /** How to combine: "any" blocks if any block, "all" blocks if all block */
  mode: "any" | "all";
}

export type StrategyNode =
  | HeuristicsNode
  | DATDPNode
  | CCFCExtractNode
  | CCFCNode
  | PassNode
  | BlockNode
  | SerialNode
  | BranchNode
  | NestNode
  | ParallelNode;

// ============================================================================
// Node Executors
// ============================================================================

async function executeHeuristics(
  content: string,
  node: HeuristicsNode,
  ctx: StrategyContext
): Promise<StrategyResult> {
  const start = Date.now();
  const result = runHeuristics(content);

  const blockAbove = node.blockAbove ?? 10;
  const escalateAbove = node.escalateAbove ?? 3;

  let verdict: Verdict;
  if (result.score >= blockAbove) {
    verdict = "block";
  } else if (result.score >= escalateAbove) {
    verdict = "escalate";
  } else {
    verdict = "pass";
  }

  const confidence = Math.min(result.score / 10, 1);

  ctx.trace.push({
    node: "heuristics",
    verdict,
    confidence,
    durationMs: Date.now() - start,
    data: result,
  });

  return { verdict, confidence, data: result };
}

async function executeDATDP(
  content: string,
  node: DATDPNode,
  ctx: StrategyContext
): Promise<StrategyResult> {
  const start = Date.now();

  // Apply node overrides to config
  const config = { ...ctx.config };
  if (node.model) config.model = node.model;
  if (node.iterations) config.iterations = node.iterations;

  const result = await runDATDP(content, config);

  const escalateBelow = node.escalateBelow ?? 0.7;
  const confidence = result.blocked
    ? Math.min(0.5 + (result.yesVotes / config.iterations) * 0.5, 0.99)
    : Math.min(0.5 + (result.noVotes / config.iterations) * 0.5, 0.99);

  let verdict: Verdict;
  if (result.blocked) {
    verdict = "block";
  } else if (confidence < escalateBelow) {
    verdict = "escalate";
  } else {
    verdict = "pass";
  }

  ctx.trace.push({
    node: `datdp(${config.model}, n=${config.iterations})`,
    verdict,
    confidence,
    durationMs: Date.now() - start,
    data: result,
  });

  return { verdict, confidence, data: result };
}

async function executeCCFCExtract(
  content: string,
  _node: CCFCExtractNode,
  ctx: StrategyContext
): Promise<StrategyResult> {
  const start = Date.now();

  const core = await extractCore(content, ctx.config);

  ctx.trace.push({
    node: "ccfc-extract",
    verdict: "escalate",  // transforms always escalate to inner
    confidence: 1,
    durationMs: Date.now() - start,
    data: { core },
  });

  return {
    verdict: "escalate",
    confidence: 1,
    content: core,  // transformed content for nesting
    data: { core },
  };
}

async function executeCCFC(
  content: string,
  node: CCFCNode,
  ctx: StrategyContext
): Promise<StrategyResult> {
  const start = Date.now();

  // Apply node overrides to config
  const config = { ...ctx.config };
  if (node.model) config.model = node.model;
  if (node.iterations) config.iterations = node.iterations;

  // Extract core
  const core = await extractCore(content, config);

  // Build CFC sandwich: core-full-core
  const cfcContent = `${core}\n---\n${content}\n---\n${core}`;

  // Run both tracks in parallel
  const [coreResult, cfcResult] = await Promise.all([
    runDATDP(core, config),
    runDATDP(cfcContent, config),
  ]);

  // Block if either track blocks
  const blocked = coreResult.blocked || cfcResult.blocked;
  const blockedBy = coreResult.blocked && cfcResult.blocked ? "both" :
                    coreResult.blocked ? "core" :
                    cfcResult.blocked ? "cfc" : "none";

  const confidence = blocked
    ? Math.min(0.5 + (Math.max(coreResult.yesVotes, cfcResult.yesVotes) / config.iterations) * 0.5, 0.99)
    : Math.min(0.5 + (Math.max(coreResult.noVotes, cfcResult.noVotes) / config.iterations) * 0.5, 0.99);

  ctx.trace.push({
    node: `ccfc(${config.model}, n=${config.iterations})`,
    verdict: blocked ? "block" : "pass",
    confidence,
    durationMs: Date.now() - start,
    data: { core, coreResult, cfcResult, blockedBy },
  });

  return {
    verdict: blocked ? "block" : "pass",
    confidence,
    data: { core, coreResult, cfcResult, blockedBy },
  };
}

async function executeSerial(
  content: string,
  node: SerialNode,
  ctx: StrategyContext
): Promise<StrategyResult> {
  for (const step of node.steps) {
    const result = await executeNode(content, step, ctx);

    // Stop on definitive verdict
    if (result.verdict === "pass" || result.verdict === "block") {
      return result;
    }
    // Continue on escalate
  }

  // If we exhaust all steps, pass
  return { verdict: "pass", confidence: 0.5 };
}

async function executeBranch(
  content: string,
  node: BranchNode,
  ctx: StrategyContext
): Promise<StrategyResult> {
  const result = await executeNode(content, node.on, ctx);

  const nextNode =
    result.verdict === "pass" ? node.pass :
    result.verdict === "block" ? node.block :
    node.escalate;

  if (nextNode) {
    return executeNode(content, nextNode, ctx);
  }

  return result;
}

async function executeNest(
  content: string,
  node: NestNode,
  ctx: StrategyContext
): Promise<StrategyResult> {
  // Run transform
  const transformResult = await executeNode(content, node.transform, ctx);

  // Use transformed content for inner evaluation
  const innerContent = transformResult.content ?? content;
  const innerResult = await executeNode(innerContent, node.inner, ctx);

  return {
    ...innerResult,
    data: {
      transform: transformResult.data,
      inner: innerResult.data,
    },
  };
}

async function executeParallel(
  content: string,
  node: ParallelNode,
  ctx: StrategyContext
): Promise<StrategyResult> {
  const results = await Promise.all(
    node.strategies.map(s => executeNode(content, s, ctx))
  );

  const blocks = results.filter(r => r.verdict === "block");
  const passes = results.filter(r => r.verdict === "pass");

  if (node.mode === "any") {
    // Block if any block
    if (blocks.length > 0) {
      const maxConfidence = Math.max(...blocks.map(r => r.confidence));
      return { verdict: "block", confidence: maxConfidence, data: results };
    }
  } else {
    // Block only if all block
    if (blocks.length === results.length) {
      const avgConfidence = blocks.reduce((s, r) => s + r.confidence, 0) / blocks.length;
      return { verdict: "block", confidence: avgConfidence, data: results };
    }
  }

  // Pass if we have any passes
  if (passes.length > 0) {
    const maxConfidence = Math.max(...passes.map(r => r.confidence));
    return { verdict: "pass", confidence: maxConfidence, data: results };
  }

  // Otherwise escalate
  return { verdict: "escalate", confidence: 0.5, data: results };
}

// ============================================================================
// Main Executor
// ============================================================================

async function executeNode(
  content: string,
  node: StrategyNode,
  ctx: StrategyContext
): Promise<StrategyResult> {
  switch (node.type) {
    case "heuristics":
      return executeHeuristics(content, node, ctx);
    case "datdp":
      return executeDATDP(content, node, ctx);
    case "ccfc-extract":
      return executeCCFCExtract(content, node, ctx);
    case "ccfc":
      return executeCCFC(content, node, ctx);
    case "pass":
      return { verdict: "pass", confidence: 1 };
    case "block":
      return { verdict: "block", confidence: 1 };
    case "serial":
      return executeSerial(content, node, ctx);
    case "branch":
      return executeBranch(content, node, ctx);
    case "nest":
      return executeNest(content, node, ctx);
    case "parallel":
      return executeParallel(content, node, ctx);
    default:
      throw new Error(`Unknown node type: ${(node as StrategyNode).type}`);
  }
}

/**
 * Execute a strategy tree
 */
export async function execute(
  content: string,
  tree: StrategyNode,
  config: ResolvedConfig
): Promise<StrategyResult> {
  const ctx: StrategyContext = {
    config,
    originalContent: content,
    trace: [],
  };

  const result = await executeNode(content, tree, ctx);
  result.trace = ctx.trace;

  return result;
}

// ============================================================================
// Presets
// ============================================================================

/** Simple DATDP only */
export const PRESET_DATDP: StrategyNode = {
  type: "datdp",
};

/** Heuristics then DATDP */
export const PRESET_HEURISTICS_DATDP: StrategyNode = {
  type: "serial",
  steps: [
    { type: "heuristics", escalateAbove: 3, blockAbove: 10 },
    { type: "datdp" },
  ],
};

/** CCFC: extract core, evaluate both core and CFC sandwich in parallel */
export const PRESET_CCFC: StrategyNode = {
  type: "ccfc",
};

/** Escalating: cheap model first, expensive if uncertain */
export const PRESET_ESCALATION: StrategyNode = {
  type: "serial",
  steps: [
    { type: "heuristics", escalateAbove: 3 },
    { type: "datdp", iterations: 3, escalateBelow: 0.8 },
    { type: "datdp", iterations: 5 },
  ],
};

/** Parallel DATDP + CCFC, block if either blocks */
export const PRESET_PARANOID: StrategyNode = {
  type: "parallel",
  mode: "any",
  strategies: [
    { type: "datdp" },
    {
      type: "nest",
      transform: { type: "ccfc-extract" },
      inner: { type: "datdp" },
    },
  ],
};
