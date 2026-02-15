# Classifier Comparison Results

**Date:** 2026-02-04 (updated 2026-02-05)
**Dataset:** 2,814 cases (2,415 injection + 399 benign)
**Sources:** InjecAgent (2,108), ZeroLeaks (264), Curated (43), NotInject (339), Curated Benign (60)

## Executive Summary

| Classifier | TPR | FPR | Precision | F1 | Latency |
|------------|-----|-----|-----------|-----|---------|
| **PG2** | 47.2% | **3.8%** | 98.7% | 0.639 | 556ms |
| **DeBERTa** | 39.6% | 36.8% | 86.7% | 0.543 | 505ms |
| **PIGuard** | **69.1%** | 11.8% | 97.3% | **0.807** | 466ms |
| **Sentinel** | 51.5% | 22.0% | 93.4% | 0.664 | 661ms |
| **Deepset** | 98.8% | 63.4% | 90.4% | 0.944 | 353ms |

**Winner: PIGuard** - Best balance of TPR (69%) and FPR (12%). Significantly outperforms PG2 (+22% TPR) while keeping false positives manageable. The ACL 2025 paper's claims about fixing over-defense hold up.

**Trade-off Spectrum:**
- Conservative: PG2 (47% TPR, 4% FPR) - minimal false positives
- **Balanced: PIGuard (69% TPR, 12% FPR)** ← recommended
- Aggressive: Deepset (99% TPR, 63% FPR) - catches everything, unusable FPR

## Detailed Results

### Meta Prompt Guard 2 (PG2)

- **Model:** `meta-llama/Llama-Prompt-Guard-2-86M`
- **Overall:** 47.2% TPR, 3.8% FPR, F1=0.639
- **Latency:** p50=556ms, p95=761ms

#### Strengths (100% TPR)
| Category | TPR | Notes |
|----------|-----|-------|
| delimiter_attack | 100% | ChatML, XML tag injection |
| instruction_override | 100% | Direct "ignore instructions" |
| persona_hijacking | 100% | DAN, jailbreak personas |

#### Weaknesses (0% TPR)
| Category | TPR | Notes |
|----------|-----|-------|
| encoding_attack | 0% | Base64, ROT13, hex encoding |
| zeroleaks-cot_hijack | 0% | Chain-of-thought manipulation |
| zeroleaks-crescendo | 0% | Gradual persuasion attacks |

#### InjecAgent Performance (~50% TPR)
| Category | N | TPR |
|----------|---|-----|
| injecagent-data_security | 374 | 50.5% |
| injecagent-financial_harm | 306 | 50.0% |
| injecagent-physical_harm | 340 | 51.2% |
| injecagent-others | 510 | 51.8% |

#### False Positive Analysis
| Benign Category | N | FPR |
|-----------------|---|-----|
| notinject-technique_queries | 87 | 13.8% |
| notinject-common_queries | 126 | 1.6% |
| notinject-multilingual | 84 | 1.2% |
| curated benign | 60 | 0% |

---

### ProtectAI DeBERTa v3

- **Model:** `protectai/deberta-v3-base-prompt-injection-v2`
- **Overall:** 39.6% TPR, 36.8% FPR, F1=0.543
- **Latency:** p50=505ms, p95=769ms

#### Strengths
| Category | TPR | Notes |
|----------|-----|-------|
| delimiter_attack | 100% | Same as PG2 |
| persona_hijacking | 100% | Same as PG2 |
| instruction_override | 100% | Same as PG2 |
| zeroleaks-encoding | 88% | **Better than PG2** |
| zeroleaks-persona | 100% | Social engineering |
| zeroleaks-social | 90.5% | Persuasion attacks |

#### Critical Weakness: False Positives
| Benign Category | N | FPR | Impact |
|-----------------|---|-----|--------|
| notinject-multilingual | 84 | **60.7%** | Blocks most non-English |
| notinject-technique_queries | 87 | **57.5%** | Blocks security questions |
| notinject-common_queries | 126 | 27.8% | Blocks normal queries |
| notinject-virtual_creation | 42 | 26.2% | Blocks creative requests |

**DeBERTa is NOT production-ready** due to blocking 37% of legitimate traffic.

#### InjecAgent Performance (~35% TPR)
| Category | N | TPR |
|----------|---|-----|
| injecagent-others | 510 | 26.3% |
| injecagent-physical_data | 374 | 29.7% |
| injecagent-data_security | 374 | 36.4% |
| injecagent-physical_harm | 340 | 40.3% |

---

### PIGuard (NEW - Recommended)

- **Model:** `leolee99/PIGuard`
- **Architecture:** DeBERTa-v3-base (200M params) with MOF training
- **Paper:** ACL 2025 - Claims 30.8% improvement over baselines
- **Overall:** 69.1% TPR, 11.8% FPR, F1=0.807
- **Latency:** p50=466ms

#### Strengths
| Category | N | TPR | Notes |
|----------|---|-----|-------|
| zeroleaks-encoding | 83 | 84% | Handles encoded payloads |
| zeroleaks-injection | 26 | 88% | Direct injection patterns |
| injecagent-physical_harm | 340 | 78% | Best on physical harm |
| injecagent-financial_harm | 306 | 71% | Good financial detection |
| injecagent-data_security | 374 | 68% | Data exfil attempts |

#### InjecAgent Performance (~68% TPR avg)
| Category | N | TPR |
|----------|---|-----|
| injecagent-physical_harm | 340 | 78% |
| injecagent-financial_harm | 306 | 71% |
| injecagent-data_security_harm | 374 | 68% |
| injecagent-financial_data | 204 | 67% |
| injecagent-others | 510 | 64% |
| injecagent-physical_data | 374 | 64% |

#### False Positive Analysis
| Benign Category | N | FPR | Notes |
|-----------------|---|-----|-------|
| notinject-technique_queries | 87 | 32% | Security questions trigger it |
| notinject-common_queries | 126 | 7% | Acceptable |
| notinject-virtual_creation | 42 | 4% | Good |
| notinject-multilingual | 84 | 0% | **Excellent** - no language bias |

**PIGuard is production-ready** with best-in-class balance. Only weakness is security-related queries (32% FPR on technique_queries).

---

### Prompt-Injection-Sentinel

- **Model:** `qualifire/prompt-injection-sentinel`
- **Architecture:** ModernBERT-large (400M params)
- **Overall:** 51.5% TPR, 22.0% FPR, F1=0.664
- **Latency:** p50=661ms (slowest due to larger model)

#### Performance Summary
Sentinel disappointed - only marginally better than PG2 on TPR while having 6x worse FPR.

| Category | N | TPR |
|----------|---|-----|
| injecagent-physical_data | 374 | 65% |
| injecagent-financial_data | 204 | 52% |
| injecagent-others | 510 | 50% |
| injecagent-financial_harm | 306 | 47% |
| injecagent-physical_harm | 340 | 40% |
| injecagent-data_security_harm | 374 | 38% |

#### Critical Weakness: Multilingual FPR
| Benign Category | N | FPR |
|-----------------|---|-----|
| notinject-multilingual | 84 | **53%** | Blocks half of non-English |
| notinject-technique_queries | 87 | 31% | Same as others |
| notinject-common_queries | 126 | 10% | Acceptable |

**Sentinel is NOT recommended** - worse than PIGuard on both TPR and FPR.

---

### Deepset DeBERTa

- **Model:** `deepset/deberta-v3-base-injection`
- **Architecture:** DeBERTa-v3-base
- **Overall:** 98.8% TPR, 63.4% FPR, F1=0.944
- **Latency:** p50=353ms (fastest)

#### Performance Summary
Catches almost everything but blocks 2/3 of legitimate traffic.

| Category | N | TPR |
|----------|---|-----|
| injecagent-* | 2108 | **100%** | Perfect on all InjecAgent |
| zeroleaks-encoding | 83 | 100% | Perfect |
| zeroleaks-direct | 33 | 42% | Only weakness |

#### Critical Weakness: Unusable FPR
| Benign Category | N | FPR |
|-----------------|---|-----|
| notinject-multilingual | 84 | **98%** | Blocks almost all non-English |
| notinject-virtual_creation | 42 | **88%** | Blocks creative requests |
| notinject-technique_queries | 87 | 57% | Blocks security questions |
| notinject-common_queries | 126 | 57% | Blocks normal queries |

**Deepset is NOT usable** - 63% FPR is catastrophic.

---

## Attack Category Analysis

### Categories Both Handle Well (>75% TPR)

| Category | PG2 | DeBERTa | Notes |
|----------|-----|---------|-------|
| delimiter_attack | 100% | 100% | ChatML, XML injection |
| instruction_override | 100% | 100% | Direct override attempts |
| persona_hijacking | 100% | 100% | DAN, jailbreak |
| system_prompt_extraction | 80% | 80% | Prompt leaking |
| harmful_content | 75% | 75% | Dangerous content |

### Categories Where DeBERTa Excels

| Category | PG2 | DeBERTa | Delta |
|----------|-----|---------|-------|
| encoding_attack | 0% | 75% | +75% |
| zeroleaks-encoding | ~30% | 88% | +58% |
| context_confusion | 50% | 75% | +25% |
| tool_result_injection | 17% | 50% | +33% |

### Categories Both Struggle With (<50% TPR)

| Category | PG2 | DeBERTa | Notes |
|----------|-----|---------|-------|
| injecagent-* | ~50% | ~35% | Tool-response injection |
| zeroleaks-hybrid | ~40% | 21% | Multi-technique attacks |
| zeroleaks-tool_exploit | ~20% | 13% | Tool abuse |
| data_exfiltration | 17% | 33% | PII extraction |

---

## Key Findings

### 1. PIGuard significantly improves on InjecAgent detection

PIGuard achieves ~68% TPR on InjecAgent (tool-response injection) vs PG2's ~50% and DeBERTa's ~35%. This is the dominant threat for agentic applications, and PIGuard handles it best.

| Classifier | InjecAgent TPR |
|------------|----------------|
| PIGuard | 68% |
| PG2 | 50% |
| Sentinel | 49% |
| DeBERTa | 35% |
| Deepset | 100% (but 63% FPR) |

### 2. PIGuard solves the over-defense problem

The ACL 2025 paper claimed PIGuard fixes "over-defense" (high FPR). Our results confirm:
- PIGuard: 69% TPR, 12% FPR
- DeBERTa: 40% TPR, 37% FPR
- Deepset: 99% TPR, 63% FPR

PIGuard achieves higher TPR with much lower FPR than other DeBERTa variants.

### 3. Multilingual handling varies dramatically

| Classifier | Multilingual FPR | Notes |
|------------|------------------|-------|
| PIGuard | **0%** | No language bias |
| PG2 | 1% | Minimal |
| Sentinel | 53% | Blocks half |
| DeBERTa | 61% | Blocks most |
| Deepset | 98% | Blocks almost all |

PIGuard is the only DeBERTa-based model without multilingual bias.

### 4. Encoding bypasses still defeat PG2

PG2 has 0% TPR on encoded payloads. PIGuard catches 84% of encoded attacks.

| Classifier | Encoding Attack TPR |
|------------|---------------------|
| PIGuard | 84% |
| Deepset | 100% |
| DeBERTa | 88% |
| Sentinel | 77% |
| PG2 | 0% |

### 5. Model size doesn't correlate with performance

Sentinel (400M params) performed worse than PIGuard (200M params). Deepset (same arch as DeBERTa) was more aggressive with no accuracy benefit.

---

## Recommendations

### For Production Deployment

1. **Use PIGuard as primary classifier** (NEW)
   - Best balance: 69% TPR with 12% FPR
   - 466ms latency is production-ready
   - Handles InjecAgent-style attacks well (~68% TPR)
   - No multilingual bias (0% FPR on non-English)

2. **Use PG2 for ultra-conservative deployments**
   - Only 4% FPR if false positives are unacceptable
   - Accept ~47% miss rate on attacks
   - Good for low-risk applications

3. **Add LLM-based classifier for high-value contexts**
   - DATDP or CCFC for tool-calling agents
   - Escalate when PIGuard confidence is uncertain
   - Worth the ~2-3s latency for sensitive operations

4. **Do NOT use DeBERTa, Sentinel, or Deepset in production**
   - DeBERTa: 37% FPR - blocks 1/3 of traffic
   - Sentinel: 22% FPR with only 51% TPR - worst of both worlds
   - Deepset: 63% FPR - blocks 2/3 of traffic

### For Improving Detection

1. **Train on InjecAgent patterns** - Current models weren't trained on tool-response injection
2. **Add encoding pre-processing** - Decode base64/rot13 before classification
3. **Heuristics for encoded payloads** - Pattern match encoded injection markers

### Cascade Architecture

```
Input
  │
  ├─► Heuristics (instant)
  │     └─ Block: delimiter injection, obvious patterns
  │
  ├─► PIGuard (500ms)
  │     └─ Block: injection patterns, tool injection
  │     └─ Escalate: low confidence
  │
  └─► DATDP/CCFC (2-3s) [if escalated or high-value]
        └─ Block: sophisticated attacks, edge cases
```

**Alternative (ultra-conservative):** Replace PIGuard with PG2 if 12% FPR is too high.

---

## Comparison with Previous Run (50 cases)

| Metric | 50 cases | 2,814 cases | Notes |
|--------|----------|-------------|-------|
| PG2 TPR | 14.0% | 47.2% | Previous run had unlucky sample |
| PG2 FPR | 2.0% | 3.8% | Consistent |
| DeBERTa TPR | 36.0% | 39.6% | Consistent |
| DeBERTa FPR | 36.0% | 36.8% | Consistent |

The larger sample confirms DeBERTa's FPR issue and reveals PG2 is better than the small sample suggested.

---

## Raw Data

**Benchmark files:**
- `data/PG2-2026-02-04T*.json`
- `data/DeBERTa-2026-02-04T*.json`
- `data/PIGuard-2026-02-04T22-27-47.json`
- `data/Sentinel-2026-02-04T22-59-32.json`
- `data/Deepset-2026-02-04T23-17-02.json`

**Dataset Composition:**
- InjecAgent: 2,108 cases (74.9%)
- NotInject benign: 339 cases (12.0%)
- ZeroLeaks: 264 cases (9.4%)
- Curated injection: 43 cases (1.5%)
- Curated benign: 60 cases (2.1%)

**Models tested:**
| Model | HuggingFace ID | Params |
|-------|----------------|--------|
| PG2 | `meta-llama/Llama-Prompt-Guard-2-86M` | 86M |
| DeBERTa | `protectai/deberta-v3-base-prompt-injection-v2` | 184M |
| PIGuard | `leolee99/PIGuard` | 200M |
| Sentinel | `qualifire/prompt-injection-sentinel` | 400M |
| Deepset | `deepset/deberta-v3-base-injection` | 184M |
