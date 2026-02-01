---
name: moltshield
description: "DATDP pre-inference evaluation - filters jailbreaks and injections before main model"
metadata: { "openclaw": { "emoji": "🛡️", "events": ["agent:pre_inference"], "priority": 1000, "critical": true } }
---

# MoltShield Pre-Inference Hook

Evaluates ALL content before it reaches the main model, providing defense against:

- User message jailbreaks (DAN, instruction override, etc.)
- Best-of-N augmented attacks (random caps, unicode tricks)
- Tool result injection (malicious web pages, file contents)
- Memory/context pollution
- Social engineering patterns

## How It Works

```
Context Assembly → MoltShield Hook → Main Model
                       │
              ┌────────┴────────┐
              │ 1. Heuristics   │ (instant)
              │ 2. DATDP N=5    │ (if suspicious)
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │ REWIND or PASS  │
              └─────────────────┘
```

On detection: Rewinds to last safe state (strips malicious content, notifies model).

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MOLTSHIELD_ENABLED` | `true` | Enable/disable the shield |
| `MOLTSHIELD_HEURISTICS_ONLY` | `false` | Skip DATDP, use heuristics only (for benchmarking) |
| `MOLTSHIELD_IMMEDIATE_REWIND` | `10` | Heuristic score to rewind immediately |
| `MOLTSHIELD_ITERATIONS` | `5` | DATDP voting iterations |
| `MOLTSHIELD_TIMEOUT` | `5000` | Timeout per eval (ms) |
| `MOLTSHIELD_VERBOSE` | `false` | Enable logging |
| `MOLTSHIELD_TRUSTED_SOURCES` | `` | Comma-separated trusted tool names |

**Default behavior:** Always runs DATDP on every input (small model calls are cheap).
Set `MOLTSHIELD_HEURISTICS_ONLY=true` to skip DATDP for cost-sensitive deployments.

## Evaluator Auto-Detection

MoltShield automatically detects available evaluators in this order:

1. **Anthropic Claude Haiku** - if `ANTHROPIC_API_KEY` set
2. **OpenRouter** - if `OPENROUTER_API_KEY` set
3. **OpenAI GPT-4o-mini** - if `OPENAI_API_KEY` set
4. **Local Ollama** - if Ollama running at localhost:11434
5. **Heuristics only** - fallback if no LLM available

## Events

- `agent:pre_inference` - Fires right before any inference call to main model

## Priority

Priority `1000` ensures MoltShield runs before any other pre-inference hooks.

## Installation

This hook is automatically installed by the MoltShield skill's self-patch mechanism.
See `skill/SKILL.md` for installation instructions.
