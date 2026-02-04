# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is MoltShield?

MoltShield is a pre-inference defense system that protects AI agents from prompt injection attacks. It evaluates content before it reaches the main model using multiple detection strategies.

## Commands

```bash
# Build
npm run build                 # TypeScript compilation to dist/

# Test
npm test                      # Unit tests (npx tsx tests/evaluator.test.ts)

# Benchmarks (require API keys in .env)
npm run benchmark             # All benchmarks (zeroleaks + fp)
npm run benchmark:zeroleaks   # ZeroLeaks injection probes
npm run benchmark:fp          # False positive rate
npm run benchmark:strategy    # Strategy comparison (DATDP vs CCFC vs Exchange)

# Run single benchmark
npx tsx tests/benchmarks/zeroleaks.ts
npx tsx tests/benchmarks/strategy-comparison.ts
```

## Architecture

### Strategy Tree System (`src/strategy.ts`)

The evaluator uses a composable strategy tree pattern. Each node returns a `Verdict`: `pass`, `block`, or `escalate`.

**Node types:**
- `heuristics` - Fast pattern matching (invisible chars, mixed case, injection markers)
- `datdp` - LLM-based N-iteration weighted voting (yes=+2, no=-1)
- `ccfc` - Core extraction + dual-track DATDP evaluation
- `serial` - Run steps until pass/block (escalate continues)
- `branch` - Conditional routing based on verdict
- `nest` - Transform content, then evaluate transformed version
- `parallel` - Run strategies concurrently with any/all blocking

**Presets in `src/strategy.ts`:**
- `PRESET_DATDP` - Just DATDP voting
- `PRESET_CCFC` - Extract core request, evaluate both
- `PRESET_HEURISTICS_DATDP` - Heuristics first, then DATDP
- `PRESET_ESCALATION` - Cheap model first, expensive if uncertain
- `PRESET_PARANOID` - Parallel DATDP + CCFC

### Module Structure

- `evaluator.ts` - Main entry (`evaluatePrompt`, `shouldBlock`)
- `strategy.ts` - Tree executor and node implementations
- `heuristics.ts` - Pattern-based detection (fast, no API calls)
- `datdp.ts` - DATDP voting algorithm with LLM calls
- `ccfc.ts` - Core extraction for CCFC dual-track
- `exchange.ts` - Post-inference response evaluation
- `image.ts` - Image content evaluation
- `providers.ts` - LLM provider abstraction (Anthropic/OpenRouter/OpenAI/Ollama)
- `config.ts` - Config resolution and assessment task definitions
- `cache.ts` - LRU cache for evaluation results

### Key Types (`src/types.ts`)

```typescript
interface EvaluationResult {
  safe: boolean;
  confidence: number;
  flags: string[];
  reasoning: string;
  datdp?: { iterations, yesVotes, noVotes, unclearVotes, score };
  ccfc?: { coreExtract, coreOnlyResult, cfcResult, blockedBy };
}

type Verdict = "pass" | "block" | "escalate";
type AssessmentTask = "safety1" | "safety2" | "weapons1" | "weapons2" | "weapons3";
```

## Environment Variables

Required (one of):
- `ANTHROPIC_API_KEY` - Claude Haiku
- `OPENROUTER_API_KEY` - OpenRouter fallback
- `OPENAI_API_KEY` - OpenAI fallback

Optional:
- `MOLTSHIELD_ITERATIONS` - DATDP voting iterations (default: 5 API, 25 local)
- `MOLTSHIELD_TASK` - Assessment task (default: safety1)
- `MOLTSHIELD_VERBOSE` - Enable debug logging
- `MOLTSHIELD_HEURISTICS_ONLY` - Skip LLM, heuristics only

## Test Fixtures (Git Submodules)

- `tests/fixtures/zeroleaks/` - ZeroLeaks injection probes (184+ across 13 categories)
- `tests/fixtures/agentdojo/` - AgentDojo multi-step agentic scenarios (97 tasks, 629 adversarial)
- `tests/fixtures/injecagent/` - InjecAgent tool-integrated injection tests (1,054 cases)
- `tests/fixtures/injecguard/` - NotInject over-defense testing (339 benign with trigger words)

Initialize with: `git submodule update --init --recursive`

Please do not recommend anthropic models indescriminantly. They are expensive (especially for experiments) and should be restricted to when the end user has chosen the anthropic API or subscription plan