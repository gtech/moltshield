/**
 * MoltShield Pre-Inference Handler
 *
 * Hooks into OpenClaw's agent:pre_inference event to evaluate ALL content
 * before it reaches the main model (Opus 4.5).
 *
 * This is the primary defense layer - catches:
 * - User message jailbreaks
 * - Tool result injections
 * - Memory/context pollution
 * - Any adversarial content regardless of source
 *
 * On detection: Rewinds to last safe state instead of hard blocking.
 */

import { evaluatePrompt, runHeuristics, shouldBlock } from "../src/evaluator.js";
import type { EvaluatorConfig } from "../src/evaluator.js";

// ============================================================================
// Types
// ============================================================================

interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_use_id?: string;
  name?: string;
}

interface PreInferenceEvent {
  type: "agent";
  action: "pre_inference";
  timestamp: number;

  /** Full context about to be sent to the main model */
  context: {
    /** Messages array (conversation history + tool results) */
    messages: Message[];
    /** System prompt */
    system?: string;
    /** Session ID for logging */
    sessionId: string;
    /** Workspace directory */
    workspaceDir: string;
    /** OpenClaw configuration */
    cfg: Record<string, unknown>;
  };

  /** Response methods */
  response: {
    /** Block the inference call entirely */
    block: (reason: string) => void;
    /** Transform messages before inference */
    transform: (messages: Message[]) => void;
    /** Add metadata annotation */
    annotate: (key: string, value: unknown) => void;
  };
}

type HookHandler = (event: PreInferenceEvent) => Promise<void> | void;

// ============================================================================
// Configuration
// ============================================================================

interface MoltShieldConfig {
  enabled: boolean;
  /** Skip DATDP, use heuristics only (for benchmarking/cost-sensitive) */
  heuristicsOnly: boolean;
  /** Heuristic score to trigger DATDP (only used if heuristicsOnly=true) */
  heuristicThreshold: number;
  /** Heuristic score to rewind immediately without DATDP */
  immediateRewindThreshold: number;
  iterations: number;
  timeout: number;
  verbose: boolean;
  trustedSources: string[];
}

function loadConfig(): MoltShieldConfig {
  return {
    enabled: process.env.MOLTSHIELD_ENABLED !== "false",
    heuristicsOnly: process.env.MOLTSHIELD_HEURISTICS_ONLY === "true",
    heuristicThreshold: parseInt(process.env.MOLTSHIELD_HEURISTIC_THRESHOLD || "3"),
    immediateRewindThreshold: parseInt(process.env.MOLTSHIELD_IMMEDIATE_REWIND || "10"),
    iterations: parseInt(process.env.MOLTSHIELD_ITERATIONS || "5"),
    timeout: parseInt(process.env.MOLTSHIELD_TIMEOUT || "5000"),
    verbose: process.env.MOLTSHIELD_VERBOSE === "true",
    trustedSources: (process.env.MOLTSHIELD_TRUSTED_SOURCES || "").split(",").filter(Boolean),
  };
}

// ============================================================================
// Content Extraction & Flagging
// ============================================================================

interface FlaggedContent {
  index: number;
  role: "user" | "tool";
  source: string;
  content: string;
}

/**
 * Extract new/untrusted content from the context that needs evaluation.
 * Returns both the combined content for evaluation AND indices of flagged messages.
 */
function extractContentToEvaluate(messages: Message[]): {
  content: string;
  sources: string[];
  flaggedIndices: FlaggedContent[];
} {
  const contentParts: string[] = [];
  const sources: string[] = [];
  const flaggedIndices: FlaggedContent[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    // Stop when we hit an assistant message (already processed context)
    if (msg.role === "assistant") {
      break;
    }

    if (msg.role === "user") {
      contentParts.unshift(msg.content);
      sources.unshift("user_message");
      flaggedIndices.unshift({
        index: i,
        role: "user",
        source: "user_message",
        content: msg.content,
      });
    } else if (msg.role === "tool") {
      contentParts.unshift(msg.content);
      const toolSource = `tool:${msg.name || "unknown"}`;
      sources.unshift(toolSource);
      flaggedIndices.unshift({
        index: i,
        role: "tool",
        source: toolSource,
        content: msg.content,
      });
    }
  }

  return {
    content: contentParts.join("\n---BOUNDARY---\n"),
    sources,
    flaggedIndices,
  };
}

// ============================================================================
// Rewind Logic
// ============================================================================

const SHIELD_NOTIFICATION = `[MoltShield: Potentially harmful content was detected and filtered. The conversation has been rewound to the last safe state. Please continue normally - the user may rephrase their request.]`;

const TOOL_FILTERED_MESSAGE = `[MoltShield: This tool's output was filtered for safety. The content may have contained embedded instructions or potentially harmful material.]`;

/**
 * Rewind the context to remove or sanitize flagged content.
 *
 * For user messages: Remove the message entirely, rewind to previous state
 * For tool results: Replace content with filtered message (keeps structure valid)
 */
function rewindContext(
  messages: Message[],
  flaggedIndices: FlaggedContent[],
  verbose: boolean
): Message[] {
  const result: Message[] = [];
  const flaggedIndexSet = new Set(flaggedIndices.map(f => f.index));
  const toolIndices = new Set(
    flaggedIndices.filter(f => f.role === "tool").map(f => f.index)
  );
  const userIndices = new Set(
    flaggedIndices.filter(f => f.role === "user").map(f => f.index)
  );

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (toolIndices.has(i)) {
      // Tool result: Replace content, keep structure
      if (verbose) {
        console.log(`[MoltShield] Filtering tool result at index ${i}`);
      }
      result.push({
        ...msg,
        content: TOOL_FILTERED_MESSAGE,
      });
    } else if (userIndices.has(i)) {
      // User message: Skip entirely (rewind)
      if (verbose) {
        console.log(`[MoltShield] Removing user message at index ${i}`);
      }
      // Don't add to result - effectively drops the message
    } else {
      // Safe message: Keep as-is
      result.push(msg);
    }
  }

  // Add shield notification as a system message at the end
  // This lets the model know what happened
  result.push({
    role: "user",
    content: SHIELD_NOTIFICATION,
  });

  return result;
}

/**
 * Handle edge case: First message in session is malicious
 * Returns a safe starting context
 */
function createFreshStartContext(): Message[] {
  return [
    {
      role: "user",
      content: `[MoltShield: The initial message was filtered for safety. Please start fresh - how can I help you today?]`,
    },
  ];
}

// ============================================================================
// Logging
// ============================================================================

interface EvaluationLog {
  timestamp: string;
  sessionId: string;
  sources: string[];
  heuristicScore: number;
  heuristicFlags: string[];
  datdpResult?: {
    iterations: number;
    yesVotes: number;
    noVotes: number;
    score: number;
  };
  decision: "pass" | "rewind";
  reason: string;
  contentPreview: string;
}

const evaluationLogs: EvaluationLog[] = [];

function logEvaluation(log: EvaluationLog): void {
  evaluationLogs.push(log);

  if (evaluationLogs.length > 1000) {
    evaluationLogs.shift();
  }

  if (process.env.MOLTSHIELD_VERBOSE === "true") {
    console.log(`[MoltShield] ${log.decision.toUpperCase()}: ${log.reason}`);
    if (log.heuristicFlags.length > 0) {
      console.log(`[MoltShield] Flags: ${log.heuristicFlags.join(", ")}`);
    }
  }
}

export function getRecentLogs(count: number = 100): EvaluationLog[] {
  return evaluationLogs.slice(-count);
}

// ============================================================================
// Main Handler
// ============================================================================

const handler: HookHandler = async (event) => {
  if (event.type !== "agent" || event.action !== "pre_inference") {
    return;
  }

  const config = loadConfig();

  if (!config.enabled) {
    return;
  }

  const { messages, sessionId } = event.context;

  // Extract content that needs evaluation
  const { content, sources, flaggedIndices } = extractContentToEvaluate(messages);

  // Skip if no new content to evaluate
  if (!content.trim()) {
    return;
  }

  // Skip if all sources are trusted
  const untrustedSources = sources.filter(
    s => !config.trustedSources.some(ts => s.includes(ts))
  );
  if (untrustedSources.length === 0) {
    return;
  }

  // Run heuristics first (fast)
  const heuristics = runHeuristics(content);

  // Helper to perform rewind
  const performRewind = (reason: string, datdpResult?: EvaluationLog["datdpResult"]) => {
    logEvaluation({
      timestamp: new Date().toISOString(),
      sessionId,
      sources,
      heuristicScore: heuristics.score,
      heuristicFlags: heuristics.flags,
      datdpResult,
      decision: "rewind",
      reason,
      contentPreview: content.slice(0, 200),
    });

    // Check if this is the first message (nothing to rewind to)
    const hasHistory = messages.some(
      (m, i) => m.role === "assistant" && i < messages.length - 1
    );

    let cleanMessages: Message[];
    if (!hasHistory && flaggedIndices.some(f => f.role === "user")) {
      // First message is malicious - fresh start
      cleanMessages = createFreshStartContext();
    } else {
      // Rewind to safe state
      cleanMessages = rewindContext(messages, flaggedIndices, config.verbose);
    }

    event.response.transform(cleanMessages);
    event.response.annotate("moltshield_rewind", {
      reason,
      heuristicScore: heuristics.score,
      flags: heuristics.flags,
      datdp: datdpResult,
      filteredSources: sources,
    });
  };

  // Immediate rewind for very high heuristic scores (obvious attacks)
  if (heuristics.score >= config.immediateRewindThreshold) {
    performRewind(`Heuristic score ${heuristics.score} >= ${config.immediateRewindThreshold}`);
    return;
  }

  // Heuristics-only mode: skip DATDP, use thresholds (for benchmarking/cost-sensitive)
  if (config.heuristicsOnly) {
    if (heuristics.score >= config.heuristicThreshold) {
      performRewind(`Heuristics-only mode: score ${heuristics.score} >= ${config.heuristicThreshold}`);
    } else {
      event.response.annotate("moltshield_passed", {
        heuristicScore: heuristics.score,
        flags: heuristics.flags,
        mode: "heuristics_only",
      });
      logEvaluation({
        timestamp: new Date().toISOString(),
        sessionId,
        sources,
        heuristicScore: heuristics.score,
        heuristicFlags: heuristics.flags,
        decision: "pass",
        reason: "Heuristics-only mode: low score",
        contentPreview: content.slice(0, 200),
      });
    }
    return;
  }

  // Default: Always run DATDP evaluation
  try {
    const evaluatorConfig: EvaluatorConfig = {
      iterations: config.iterations,
      timeout: config.timeout,
      verbose: config.verbose,
    };

    const result = await evaluatePrompt(content, evaluatorConfig);

    if (shouldBlock(result)) {
      performRewind(
        `DATDP detected threat: ${result.reasoning?.slice(0, 100)}`,
        result.datdp
      );
      return;
    }

    // DATDP passed - annotate and continue
    event.response.annotate("moltshield_evaluated", {
      heuristicScore: heuristics.score,
      datdp: result.datdp,
      safe: result.safe,
    });

    logEvaluation({
      timestamp: new Date().toISOString(),
      sessionId,
      sources,
      heuristicScore: heuristics.score,
      heuristicFlags: heuristics.flags,
      datdpResult: result.datdp,
      decision: "pass",
      reason: "DATDP approved",
      contentPreview: content.slice(0, 200),
    });

  } catch (error) {
    // On DATDP failure: rewind to be safe (fail closed)
    performRewind(`DATDP evaluation failed: ${error}`);
    return;
  }
};

export default handler;

// Export utilities for testing
export {
  extractContentToEvaluate,
  rewindContext,
  loadConfig,
  FlaggedContent,
  Message,
};
