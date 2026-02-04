# MoltShield

**Composable pre-inference defense for LLM applications**

MoltShield protects AI agents from prompt injection, jailbreaks, and adversarial content using a composable strategy tree of detection methods.

## Features

- **Composable Strategies** - Mix heuristics, DATDP, CCFC, and custom classifiers
- **Multi-Provider Support** - Anthropic, OpenAI, OpenRouter, Ollama, Groq
- **Pre & Post Inference** - Evaluate prompts before inference, exchanges after
- **Image Support** - Analyze images for adversarial content
- **Caching** - LRU caches for repeated evaluations

## Quick Start

```typescript
import { evaluatePrompt, shouldBlock } from "moltshield";

const result = await evaluatePrompt("user input here");
if (shouldBlock(result)) {
  console.log("Blocked:", result.reasoning);
}
```

## Installation

```bash
# Clone with submodules
git clone --recursive https://github.com/YOUR_USERNAME/moltshield.git
cd moltshield

# Install dependencies
pnpm install

# Build
npm run build
```

## Strategy System

MoltShield uses a composable strategy tree. Each node returns `pass`, `block`, or `escalate`.

### Built-in Strategies

```typescript
import { evaluatePrompt, PRESET_DATDP, PRESET_CCFC } from "moltshield";

// DATDP - N-iteration weighted voting (default)
const result = await evaluatePrompt(content, { strategy: PRESET_DATDP });

// CCFC - Context-Centric Few-Shot Classification
const result = await evaluatePrompt(content, { strategy: PRESET_CCFC });

// Heuristics only (fast, no LLM calls)
const result = await evaluatePrompt(content, { strategy: { type: "heuristics" } });
```

### Custom Strategy Trees

```typescript
import { execute, resolveConfig } from "moltshield";

const config = await resolveConfig({ model: "claude-sonnet-4-20250514" });

// Serial execution: stop on first block
const serial = await execute(content, {
  type: "serial",
  steps: [
    { type: "heuristics", blockAbove: 10, escalateAbove: 3 },
    { type: "datdp", iterations: 5 },
  ]
}, config);

// Branching: different paths based on verdict
const branched = await execute(content, {
  type: "branch",
  on: { type: "heuristics", escalateAbove: 3 },
  pass: { type: "pass" },
  escalate: { type: "datdp" },
  block: { type: "block" },
}, config);

// Nested (matryoshka): CCFC extract then evaluate core
const nested = await execute(content, {
  type: "nest",
  transform: { type: "ccfc-extract" },
  inner: { type: "datdp" },
}, config);
```

## Classifiers

| Classifier | Type | Description |
|------------|------|-------------|
| **Heuristics** | Pre-inference | Pattern matching for injection markers, unicode tricks, delimiter attacks |
| **DATDP** | Pre-inference | N-iteration weighted voting with evaluator LLM |
| **CCFC** | Pre-inference | Context-Centric Few-Shot Classification - extracts "core" intent |
| **Exchange** | Post-inference | Evaluates input+response pairs for manipulation |

### Post-Inference Exchange Evaluation

```typescript
import { evaluateExchange, resolveConfig } from "moltshield";

const config = await resolveConfig();
const result = await evaluateExchange(userInput, modelResponse, config);

if (!result.safe) {
  console.log("Manipulation detected:", result.reasoning);
}
```

### Image Evaluation

```typescript
import { evaluateImage, resolveConfig } from "moltshield";

const config = await resolveConfig();
const result = await evaluateImage(base64ImageData, config);

if (!result.safe) {
  console.log("Unsafe image:", result.reasoning);
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOLTSHIELD_MODEL` | auto-detected | Evaluator model (e.g., `claude-sonnet-4-20250514`) |
| `MOLTSHIELD_ITERATIONS` | `5` | DATDP voting iterations |
| `MOLTSHIELD_TASK` | `safety1` | Assessment task |
| `MOLTSHIELD_TIMEOUT` | `10000` | Timeout per evaluation (ms) |
| `MOLTSHIELD_VERBOSE` | `false` | Enable debug logging |

### API Keys (in priority order)

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # Anthropic
export OPENROUTER_API_KEY=sk-or-...    # OpenRouter
export OPENAI_API_KEY=sk-...           # OpenAI
export GROQ_API_KEY=gsk_...            # Groq
# Or run Ollama locally (no key needed)
```

### Assessment Tasks

| Task | Focus |
|------|-------|
| `safety1` | General jailbreak and dangerous content (default) |
| `safety2` | AI safety - manipulation and bypass attempts |
| `injection1` | Prompt injection detection |
| `weapons1-3` | CBRN content (light → strict) |

## Benchmarks

MoltShield includes a comprehensive benchmarking framework with 2800+ test cases.

```bash
# Run classifier comparison (PG2, DeBERTa)
npx tsx tests/benchmarks/experiments/classifier-comparison.ts

# Run LLM classifier comparison (DATDP, CCFC)
npx tsx tests/benchmarks/experiments/llm-classifier-comparison.ts

# Run strategy comparison
npx tsx tests/benchmarks/experiments/strategy-comparison.ts

# Run exchange benchmark
npx tsx tests/benchmarks/experiments/exchange-benchmark.ts
```

### Datasets

| Dataset | Cases | Type | Source |
|---------|-------|------|--------|
| Curated | 103 | Injection + Benign | Hand-crafted scenarios |
| ZeroLeaks | 264 | Injection | Encoding/obfuscation attacks |
| InjecAgent | 2108 | Injection | Tool-response injections |
| NotInject | 339 | Benign | Over-defense testing |
| AgentDojo | 80+ | Injection | Agentic scenarios |
| BIPIA | 125 | Mixed | Text and code injection |

### Using the Benchmark Framework

```typescript
import { runBenchmark, printResults, loadAllInjection, loadAllBenign } from "moltshield/tests/benchmarks/framework";

const testCases = [...await loadAllInjection(), ...await loadAllBenign()];

const result = await runBenchmark(testCases, {
  name: "MyClassifier",
  classifier: async (input) => ({ blocked: false, confidence: 0.5 }),
  concurrency: 10,
});

printResults(result);
```

## Project Structure

```
moltshield/
├── src/
│   ├── index.ts           # Public exports
│   ├── evaluator.ts       # Main API (evaluatePrompt, shouldBlock)
│   ├── strategy.ts        # Composable strategy tree
│   ├── heuristics.ts      # Pattern-based detection
│   ├── datdp.ts           # DATDP N-iteration voting
│   ├── ccfc.ts            # Context-Centric Few-Shot Classification
│   ├── exchange.ts        # Post-inference exchange evaluation
│   ├── image.ts           # Image evaluation
│   ├── providers.ts       # Multi-provider LLM support
│   ├── config.ts          # Configuration resolution
│   ├── cache.ts           # LRU caching
│   └── types.ts           # Shared types
├── tests/
│   ├── unit/              # Unit tests
│   ├── benchmarks/
│   │   ├── framework/     # Benchmark harness, loaders, datasets
│   │   └── experiments/   # Benchmark scripts
│   └── fixtures/          # Test data (git submodules)
│       ├── zeroleaks/     # ZeroLeaks injection probes
│       ├── agentdojo/     # AgentDojo scenarios
│       ├── injecagent/    # InjecAgent tool injections
│       └── injecguard/    # NotInject benign cases
├── results/               # Benchmark results
└── data/                  # Runtime output (gitignored)
```

## Research & Attribution

### DATDP (Defense Against The Dark Prompts)
- **Paper:** [Defense Against the Dark Prompts](https://www.alignmentforum.org/posts/5MyB8k8hSJRfa3udi/defense-against-the-dark-prompts-mitigating-best-of-n)
- **Repository:** https://github.com/alignedai/DATDP

### InjecAgent
- **Paper:** [InjecAgent: Benchmarking Indirect Prompt Injections in Tool-Integrated LLM Agents](https://arxiv.org/abs/2403.02691)
- **Repository:** https://github.com/uiuc-kang-lab/InjecAgent

### AgentDojo
- **Paper:** [AgentDojo: Benchmarking Agent Security](https://arxiv.org/abs/2406.13352)
- **Repository:** https://github.com/ethz-spylab/agentdojo

### NotInject (from InjecGuard)
- **Paper:** [InjecGuard: Preventing Prompt Injection Attacks](https://arxiv.org/abs/2410.22770)
- **Repository:** https://github.com/SaFoLab-WISC/InjecGuard

### ZeroLeaks
- **Repository:** https://github.com/ZeroLeaks/zeroleaks

## License

MIT

## Contributing

Contributions welcome. Run benchmarks before submitting PRs:

```bash
npm test
npx tsx tests/benchmarks/experiments/classifier-comparison.ts 100
```
