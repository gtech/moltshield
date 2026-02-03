/**
 * MoltShield Type Definitions
 *
 * Shared interfaces and types used across all modules.
 */

// ============================================================================
// Evaluation Results
// ============================================================================

export interface EvaluationResult {
  safe: boolean;
  confidence: number;
  flags: string[];
  reasoning: string;
  /** DATDP voting details */
  datdp?: {
    iterations: number;
    yesVotes: number;
    noVotes: number;
    unclearVotes: number;
    score: number;
  };
  /** Cache hit indicator */
  cached?: boolean;
  /** CCFC dual-track evaluation details */
  ccfc?: {
    coreExtract: string;
    coreOnlyResult: { blocked: boolean; score: number; yesVotes: number; noVotes: number };
    cfcResult: { blocked: boolean; score: number; yesVotes: number; noVotes: number };
    blockedBy: "core" | "cfc" | "both" | "none";
  };
}

export interface ImageEvaluationResult {
  safe: boolean;
  confidence: number;
  flags: string[];
  reasoning: string;
  /** Detected text in image (if any) */
  detectedText?: string;
  /** Cache hit indicator */
  cached?: boolean;
}

export interface ExchangeEvaluationResult {
  safe: boolean;
  confidence: number;
  flags: string[];
  reasoning: string;
  /** Raw classifier response */
  rawResponse?: string;
  /** Parsed verdict details */
  verdict?: {
    manipulated: boolean;
    confidence: "low" | "medium" | "high";
    reason: string;
  };
  /** Cache hit indicator */
  cached?: boolean;
}

// ============================================================================
// DATDP Types
// ============================================================================

export type AssessmentTask = "safety1" | "safety2" | "weapons1" | "weapons2" | "weapons3";

export interface DATDPResult {
  blocked: boolean;
  yesVotes: number;
  noVotes: number;
  unclearVotes: number;
  score: number;
  reasoning: string;
}

// ============================================================================
// Configuration
// ============================================================================

export interface EvaluatorConfig {
  /** Anthropic API key for Claude Haiku (preferred) */
  anthropicApiKey?: string;
  /** OpenRouter API key (fallback) */
  openRouterApiKey?: string;
  /** OpenAI API key (fallback) */
  openaiApiKey?: string;
  /** Override model name (e.g., "z-ai/glm-4.7-flash" for OpenRouter) */
  model?: string;
  /** Override vision model name (for image evaluation) */
  visionModel?: string;
  /** Force local model via Ollama */
  useLocalModel?: boolean;
  /** Local model name (default: llama3) */
  localModel?: string;
  /** Local vision model name (default: llava) */
  localVisionModel?: string;
  /** Ollama host (default: http://localhost:11434) */
  ollamaHost?: string;
  /** Number of DATDP iterations (default: 5 for API, 25 for local per paper) */
  iterations?: number;
  /** Assessment task type (default: safety1) */
  task?: AssessmentTask;
  /** Custom preamble (overrides task) */
  preamble?: string;
  /** Custom instruction (overrides task) */
  instruction?: string;
  /** Custom forbidden task definition (overrides task) */
  forbiddenTask?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Timeout in ms for each evaluation call (default: 10000) */
  timeout?: number;
  /** Timeout in ms for image evaluation (default: 30000 - images are slower) */
  imageTimeout?: number;
  /** Disable cache (default: false) */
  noCache?: boolean;
  /** DATDP block threshold - block if score >= threshold (default: 0, paper default) */
  blockThreshold?: number;
  /** Skip heuristic checks, use LLM only (default: true - heuristics off by default) */
  skipHeuristics?: boolean;
  /** Enable CCFC dual-track evaluation (default: false) */
  useCCFC?: boolean;
  /** Use OpenClaw's stored auth (Max plan OAuth) */
  useOpenClawAuth?: boolean;
  /** OpenClaw agent directory (default: ~/.openclaw/agents/default) */
  openclawAgentDir?: string;
  /** OpenRouter provider order (e.g., ["Groq", "Cerebras", "Together"]) */
  providerOrder?: string[];
  /** OpenRouter allow fallbacks if preferred provider unavailable (default: true) */
  allowFallbacks?: boolean;
}

export interface ResolvedConfig {
  evaluator: "anthropic" | "openrouter" | "openai" | "ollama" | "heuristics";
  apiKey: string;
  model: string;
  visionModel: string;
  endpoint: string;
  iterations: number;
  preamble: string;
  instruction: string;
  forbiddenTask: string;
  verbose: boolean;
  timeout: number;
  imageTimeout: number;
  noCache: boolean;
  blockThreshold: number;
  skipHeuristics: boolean;
  useCCFC: boolean;
  providerOrder?: string[];
  allowFallbacks: boolean;
}
