/**
 * MoltShield DATDP Algorithm
 *
 * Defense Against The Dark Prompts - N-iteration weighted voting.
 * Based on: https://github.com/alignedai/DATDP
 */

import type { ResolvedConfig, DATDPResult } from "./types.js";
import { callLLM } from "./providers.js";

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the DATDP system prompt using the canonical structure from the paper
 */
export function buildSystemPrompt(config: ResolvedConfig): string {
  const { preamble, instruction, forbiddenTask } = config;

  return `${preamble} ${instruction} ${forbiddenTask}.
Begin by explaining your reasoning, step by step, then end your response with 'yes' (if ${instruction} ${forbiddenTask}) or 'no' (if it does not).
MAKE SURE TO END YOUR ANSWER WITH 'yes' OR 'no'!
Again: MAKE SURE TO END YOUR ANSWER WITH 'yes' OR 'no'!`;
}

/**
 * Build the user prompt using the canonical structure from the paper
 */
export function buildUserPrompt(content: string): string {
  return `User prompt to assess follows:

>"${content}"<`;
}

// ============================================================================
// Verdict Extraction
// ============================================================================

/**
 * Extract verdict from LLM response using the paper's algorithm:
 * - Extract last word (alphanumeric only)
 * - "yes" = 1, "no" = 0, unclear = 0.5
 */
export function getIndividualVerdict(answerString: string): number {
  const response = answerString
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .pop()
    ?.toLowerCase()
    .trim();

  if (response === "yes") return 1;
  if (response === "no") return 0;
  return 0.5;
}

/**
 * Calculate final answer using paper's weighted voting:
 * - Rejections (yes) weighted 2x acceptances (no)
 * - Block if score >= threshold (default 0)
 */
export function getFinalAnswer(verdictArray: number[], threshold: number = 0): { blocked: boolean; score: number } {
  const yesCount = verdictArray.filter(v => v === 1).length;
  const noCount = verdictArray.filter(v => v === 0).length;

  const score = (yesCount * 2) - noCount;
  const blocked = score >= threshold;

  return { blocked, score };
}

// ============================================================================
// DATDP Algorithm
// ============================================================================

/**
 * Run DATDP N-iteration evaluation
 */
export async function runDATDP(
  content: string,
  config: ResolvedConfig
): Promise<DATDPResult> {
  const systemPrompt = buildSystemPrompt(config);
  const userPrompt = buildUserPrompt(content);

  // Run N iterations in parallel for lower latency
  const iterationPromises = Array.from({ length: config.iterations }, async (_, i) => {
    try {
      const response = await callLLM(systemPrompt, userPrompt, config);
      const verdict = getIndividualVerdict(response);

      if (config.verbose) {
        const voteStr = verdict === 1 ? "yes" : verdict === 0 ? "no" : "unclear";
        console.log(`[MoltShield] DATDP iteration ${i + 1}/${config.iterations}: ${voteStr}`);
      }

      return { verdict, response };
    } catch (error) {
      if (config.verbose) {
        console.error(`[MoltShield] DATDP iteration ${i + 1} failed:`, error);
      }
      return { verdict: 0.5, response: "" };
    }
  });

  const results = await Promise.all(iterationPromises);
  const verdicts = results.map(r => r.verdict);
  const reasoning = results.find(r => r.response)?.response.slice(0, 500) ?? "";

  const yesVotes = verdicts.filter(v => v === 1).length;
  const noVotes = verdicts.filter(v => v === 0).length;
  const unclearVotes = verdicts.filter(v => v === 0.5).length;

  const { blocked, score } = getFinalAnswer(verdicts, config.blockThreshold);

  return { blocked, yesVotes, noVotes, unclearVotes, score, reasoning };
}
