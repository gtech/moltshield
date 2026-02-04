# Classifier Comparison Results

**Date:** 2026-02-04
**Dataset:** 50 cases (25 injection, 25 benign) sampled from InjecAgent, ZeroLeaks, NotInject, and curated datasets
**Evaluator Model:** openai/gpt-oss-120b

## Summary

| Classifier | Type | TPR | FPR | F1 | p50 Latency |
|------------|------|-----|-----|-----|-------------|
| **PG2** | Local transformer | 14.0% | 2.0% | 0.241 | 367ms |
| **DeBERTa** | Local transformer | 36.0% | 36.0% | 0.419 | 299ms |
| **DATDP** | LLM pre-inference | 88.0% | 4.0% | 0.917 | 1,399ms |
| **CCFC** | LLM pre-inference | **96.0%** | 4.0% | **0.960** | 2,499ms |
| **Exchange** | LLM post-inference | 0.0% | 0.0% | 0.000 | ~2,000ms |

## Pre-inference Classifiers

### Local Transformer Models

**Meta Prompt Guard 2 (PG2)**
- Model: `meta-llama/Llama-Prompt-Guard-2-86M`
- Very conservative - low FPR (2%) but misses 86% of attacks
- Fast inference (~300-400ms)
- Weak on: tool-based injections, encoding attacks, data exfiltration

**ProtectAI DeBERTa v3**
- Model: `protectai/deberta-v3-base-prompt-injection-v2`
- More aggressive - catches more attacks but high FPR (36%)
- Fast inference (~250-300ms)
- Better than PG2 on encoding attacks and ZeroLeaks probes
- High false positive rate on NotInject benign cases (multilingual, technique queries)

### LLM-based Classifiers

**DATDP (Data-Agnostic Trojaned Prompt Detection)**
- 88% TPR with only 4% FPR
- ~1.4s latency per classification
- Strong on tool-based injections (InjecAgent)
- Some false negatives on financial harm category (62.5% TPR)

**CCFC (Constitutional Classifier with Focus Core)**
- Best overall: 96% TPR, 4% FPR, F1=0.960
- ~2.5s latency per classification
- Near-perfect on most categories
- Only weakness: 1 timeout on long benign input

## Post-inference Classifier

**Exchange Classifier**
- Evaluates input+response pairs to detect manipulation
- Ground truth: Only 8/25 injection attempts actually manipulated the model (GPT-4o-mini resisted 68%)
- Results: 0% TPR - failed to detect any of the 8 manipulated responses
- 0% FPR - correctly passed all clean responses
- **Needs investigation** - may require prompt tuning or different evaluation approach

## Per-Category Performance

### Categories where local classifiers fail

| Category | PG2 TPR | DeBERTa TPR | DATDP TPR | CCFC TPR |
|----------|---------|-------------|-----------|----------|
| injecagent-data_security | 28.6% | 14.3% | 100% | 100% |
| injecagent-financial_harm | 0% | 0% | 62.5% | 87.5% |
| injecagent-physical_harm | 0% | 0% | 100% | 100% |
| zeroleaks-encoding | 0% | 100% | 100% | 100% |
| tool_result_injection | 16.7% | 50% | 100% | 100% |

### Categories where all classifiers succeed

| Category | PG2 | DeBERTa | DATDP | CCFC |
|----------|-----|---------|-------|------|
| delimiter_attack | 100% | 100% | - | - |
| instruction_override | 100% | 100% | - | - |
| persona_hijacking | 100% | 100% | 100% | 100% |
| system_prompt_extraction | 80% | 80% | 100% | 100% |

## Key Findings

1. **LLM classifiers vastly outperform local transformers** on tool-based injection attacks (InjecAgent dataset). Local models weren't trained on this attack pattern.

2. **CCFC is the best single classifier** with 96% TPR and only 4% FPR, but at ~2.5s latency cost.

3. **Local classifiers are 5-10x faster** but miss most sophisticated attacks. PG2 is extremely conservative (good for low-FPR requirements).

4. **Cascade architecture recommended:**
   - Fast local classifier first (PG2 for low-FPR, DeBERTa for balanced)
   - Escalate to CCFC for uncertain cases or high-value contexts
   - Exchange classifier needs further development

5. **DeBERTa's high FPR (36%)** is problematic - it flags many legitimate multilingual and technical queries as injections.

## Recommendations

1. **For production use:** CCFC as primary, with local classifier for latency-sensitive paths
2. **For low-latency requirements:** PG2 (accept lower TPR) or DeBERTa with higher threshold
3. **Investigate Exchange classifier:** The 0% TPR suggests prompt engineering or architectural changes needed
4. **Train local models on tool-based injections:** Current models miss InjecAgent-style attacks entirely

## Raw Data

Detailed JSON results saved to:
- `data/PG2-2026-02-04T19-48-32.json`
- `data/DeBERTa-2026-02-04T19-49-14.json`
- `data/DATDP-2026-02-04T19-55-50.json`
- `data/CCFC-2026-02-04T19-57-28.json`
- `data/exchange-benchmark-2026-02-04T19-54-48.json`
