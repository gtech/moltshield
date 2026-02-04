# Contributing to MoltShield

Thanks for your interest in improving LLM safety!

## Quick Start for Contributors

```bash
# Clone with submodules
git clone --recursive https://github.com/YOUR_USERNAME/moltshield.git
cd moltshield

# Install dependencies
pnpm install

# Build
npm run build

# Run tests
npm test

# Run benchmarks (requires API key for full results)
npm run benchmark
```

## Project Structure

```
moltshield/
├── src/
│   ├── evaluator.ts      # Core DATDP implementation
│   └── index.ts          # Public exports
├── patch/
│   ├── pre-inference-handler.ts  # Pre-inference hook handler
│   ├── core-patch.ts     # OpenClaw patcher (adds pre_inference event)
│   └── HOOK.md           # Hook metadata
├── skill/
│   └── SKILL.md          # Skill definition (self-patch instructions)
├── tests/
│   ├── evaluator.test.ts # Unit tests
│   ├── benchmarks/       # Benchmark runners
│   │   ├── zeroleaks.ts  # ZeroLeaks injection probes
│   │   ├── false-positives.ts # FPR testing
│   │   └── strategy-comparison.ts # Strategy comparison
│   └── fixtures/         # Test data (git submodules)
│       ├── zeroleaks/    # Injection probes
│       ├── agentdojo/    # Agentic scenarios
│       ├── injecagent/   # Tool-integrated tests
│       └── injecguard/   # Over-defense tests
└── data/                 # Benchmark results (gitignored)
```

## Key Concepts

### DATDP Algorithm

The core algorithm from the [DATDP paper](https://github.com/alignedai/DATDP):

1. A separate evaluator LLM analyzes each prompt
2. Runs N iterations (default 5 for API, 25 for local)
3. Weighted voting: `yes` (dangerous) = +2, `no` (safe) = -1
4. Block if score >= 0

### Pre-Inference Hook

MoltShield patches OpenClaw to emit `agent:pre_inference` events before any inference call. This allows evaluation of:
- User messages
- Tool results (indirect injection defense)
- Memory/context content

### Heuristics

Fast checks that run before LLM evaluation (to be tested, may be scrapped):
- Invisible characters (zero-width spaces)
- Excessive mixed case (Best-of-N signature)
- Jailbreak patterns ("ignore previous", "you are now DAN")
- Injection markers (`<|im_start|>`, `[INST]`)
- Base64 encoded content
- Unicode confusables (Cyrillic homoglyphs)

## How to Contribute

### TODO.md has the master todo list



### Improving Detection

1. Add test cases to `tests/evaluator.test.ts`
2. Run benchmarks to measure impact
3. Document what attacks your change catches

### Adding Benchmark Datasets

1. Add dataset to `tests/fixtures/` (prefer git submodules)
2. Create benchmark runner in `tests/benchmarks/`
3. Add npm script to `package.json`

### Upstream: Native Pre-Inference Hook

The highest-impact contribution is getting a native `pre_inference` hook into OpenClaw core, eliminating the need for our patching mechanism.

**Proposed event structure:**

```typescript
interface PreInferenceEvent {
  type: "agent";
  action: "pre_inference";
  context: {
    messages: Message[];
    system?: string;
    sessionId: string;
  };
  response: {
    block: (reason: string) => void;
    transform: (messages: Message[]) => void;
    annotate: (key: string, value: unknown) => void;
  };
}
```

### Adding Heuristic Patterns

Edit `src/evaluator.ts`:

```typescript
// Add to JAILBREAK_PATTERNS
{ pattern: /your_pattern_here/i, weight: 5 },

// Or add to INJECTION_MARKERS
/your_injection_marker/i,
```

Test your pattern:
```bash
npm test
npm run benchmark:fp  # Check false positive rate
```

## Testing Requirements

Before submitting a PR:

1. `npm test` passes (18/20 minimum with heuristics-only)
2. `npm run build` succeeds
3. No new TypeScript errors
4. Benchmark results don't regress significantly

## Code Style

- TypeScript with strict mode
- No unnecessary dependencies in core evaluator
- Document public APIs with JSDoc comments
- Keep the library usable standalone (not just as OpenClaw hook)

## Questions?

Open an issue or discussion. Happy to help contributors get started!
