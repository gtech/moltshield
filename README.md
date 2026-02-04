# MoltShield 🛡️

**Pre-inference defense for OpenClaw using DATDP (Defense Against The Dark Prompts)**

MoltShield protects AI agents from jailbreak attacks, prompt injection, and adversarial content by evaluating every inference call before it reaches the main model.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Context Assembly                          │
│   User messages + Tool results + System prompt + Memory      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 MoltShield Pre-Inference                     │
│                                                              │
│   1. Heuristic scan (instant)                                │
│      - Invisible chars, mixed case, jailbreak patterns       │
│      - Injection markers in tool results                     │
│                                                              │
│   2. DATDP N-iteration evaluation (if needed)                │
│      - Separate evaluator LLM analyzes content               │
│      - Weighted voting: yes=+2, no=-1                        │
│      - Rewind if score >= 0                                  │
│                                                              │
│   → REWIND (strip bad content, notify model, continue)       │
│   → PASS (proceed to main model)                             │
└─────────────────────────────────────────────────────────────┘
                              │ PASS
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Main Model (e.g. Opus 4.5)                │
└─────────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Clone with submodules
git clone --recursive https://github.com/YOUR_USERNAME/moltshield.git
cd moltshield

# Install dependencies
pnpm install

# Build and install to OpenClaw
npm run install:all
```

## Configuration

Set your preferred evaluator API key:

```bash
# Option 1: Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Option 2: OpenRouter
export OPENROUTER_API_KEY=sk-or-...

# Option 3: OpenAI
export OPENAI_API_KEY=sk-...

# Option 4: Local (Ollama)
# No key needed, just run: ollama serve
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOLTSHIELD_ITERATIONS` | `5` (API) / `25` (local) | DATDP voting iterations |
| `MOLTSHIELD_TASK` | `safety1` | Assessment task (see below) |
| `MOLTSHIELD_TIMEOUT` | `10000` | Timeout per evaluation (ms) |
| `MOLTSHIELD_VERBOSE` | `false` | Enable debug logging |
| `MOLTSHIELD_HEURISTICS_ONLY` | `false` | Skip DATDP, use heuristics only |

**Default:** DATDP runs on every input. Set `MOLTSHIELD_HEURISTICS_ONLY=true` for benchmarking or cost-sensitive deployments.

### Assessment Tasks

| Task | Focus |
|------|-------|
| `safety1` | General jailbreak and dangerous content (default) |
| `safety2` | AI safety focused - manipulation and bypass attempts |
| `weapons1` | CBRN content detection (light) |
| `weapons2` | CBRN technical details (medium) |
| `weapons3` | CBRN actionable instructions (strict) |

## Benchmarks

```bash
# Run all benchmarks
npm run benchmark

# Individual benchmarks
npm run benchmark:datdp       # DATDP datasets (BoN attacks, HarmBench subset, benign)
npm run benchmark:zeroleaks   # ZeroLeaks injection probes
npm run benchmark:bon         # Best-of-N augmented attacks
npm run benchmark:fp          # False positive rate
```

### Target Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| Attack Success Rate | <5% | DATDP 159 harmful behaviors |
| Defense Rate | >95% | ZeroLeaks 184 probes |
| False Positive Rate | <1% | Benign prompt blocking |
| F1 Score | >0.95 | Precision/recall balance |

## Research & Attribution

MoltShield implements and builds upon research from three projects:

### DATDP (Defense Against The Dark Prompts)

> **Repository:** https://github.com/alignedai/DATDP
>
> **Paper:** [Defense Against the Dark Prompts: Mitigating Best-of-N Jailbreaking](https://www.alignmentforum.org/posts/5MyB8k8hSJRfa3udi/defense-against-the-dark-prompts-mitigating-best-of-n)

The core algorithm. Uses a separate evaluator LLM with N-iteration weighted voting to detect adversarial prompts. Key insight: the character-level perturbations that enable Best-of-N attacks (random caps, unicode tricks) make detection easier, not harder.

**Datasets included via submodule:**
- 1045 Best-of-N augmented jailbreak prompts
- 250 benign prompts for false positive testing
- 159 original harmful behavior prompts

### HarmBench

> **Repository:** https://github.com/centerforaisafety/HarmBench
>
> **Paper:** [HarmBench: A Standardized Evaluation Framework for Automated Red Teaming](https://arxiv.org/abs/2402.04249)

DATDP includes a curated 159-prompt subset from HarmBench (copyright prompts removed).

### ZeroLeaks

> **Repository:** https://github.com/ZeroLeaks/zeroleaks

Comprehensive prompt injection scanner with 184+ attack probes across 13 categories:
- Direct extraction
- Encoding bypasses (base64, rot13, hex, unicode)
- Persona attacks (DAN, roleplay)
- Social engineering
- Technical injection
- Modern attacks (crescendo, many-shot, CoT hijack, ASCII art, policy puppetry, context overflow)

**Included via submodule** - all probes available for testing.

## Project Structure

```
moltshield/
├── src/
│   ├── evaluator.ts          # Core DATDP implementation
│   └── index.ts              # Public exports
├── patch/
│   ├── pre-inference-handler.ts  # Pre-inference hook
│   ├── core-patch.ts         # OpenClaw patcher
│   └── HOOK.md               # Hook metadata
├── skill/
│   └── SKILL.md              # Skill definition
├── tests/
│   ├── evaluator.test.ts     # Unit tests
│   ├── benchmarks/           # Benchmark runners
│   │   ├── zeroleaks.ts      # ZeroLeaks injection probes
│   │   ├── false-positives.ts # FPR testing
│   │   ├── strategy-comparison.ts # DATDP vs CCFC vs Exchange
│   │   └── logger.ts         # Shared logging utilities
│   └── fixtures/             # Test data (git submodules)
│       ├── zeroleaks/        # ZeroLeaks injection probes
│       ├── agentdojo/        # AgentDojo agentic scenarios
│       ├── injecagent/       # InjecAgent tool-integrated tests
│       └── injecguard/       # NotInject over-defense tests
├── data/                     # Benchmark results (gitignored)
└── dist/                     # Compiled output
```

## API Usage

```typescript
import { evaluatePrompt, shouldBlock } from 'moltshield';

const result = await evaluatePrompt("How do I hack a computer?", {
  iterations: 5,
  task: "safety1",
  verbose: true,
});

if (shouldBlock(result)) {
  console.log("Blocked:", result.reasoning);
  console.log("DATDP score:", result.datdp?.score);
} else {
  console.log("Safe to proceed");
}
```

## Commands

```bash
# Build
npm run build

# Test
npm test                    # Unit tests
npm run benchmark           # All benchmarks

# Patch management
npm run patch:status        # Check if OpenClaw is patched
npm run patch:apply         # Apply core patch
npm run patch:remove        # Remove core patch

# Installation
npm run install:all         # Full install (build + hook + skill + patch)
npm run uninstall           # Remove MoltShield completely
```

## License

MIT

## Contributing

Contributions welcome. Please ensure benchmarks pass before submitting PRs.

Priority areas:
1. Additional heuristic patterns for emerging attack techniques
2. Performance optimization for high-throughput scenarios
3. Native OpenClaw `pre_inference` hook (upstream PR)
