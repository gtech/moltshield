# Classifier Comparison Results

**Date:** 2026-02-04
**Dataset:** 2,814 cases (2,415 injection + 399 benign)
**Sources:** InjecAgent (2,108), ZeroLeaks (264), Curated (43), NotInject (339), Curated Benign (60)

## Executive Summary

| Classifier | TPR | FPR | Precision | F1 | Latency |
|------------|-----|-----|-----------|-----|---------|
| **PG2** | 47.2% | **3.8%** | 98.7% | 0.639 | 556ms |
| **DeBERTa** | 39.6% | 36.8% | 86.7% | 0.543 | 505ms |

**Winner: PG2** - Despite lower TPR, PG2's dramatically lower FPR (3.8% vs 36.8%) makes it production-viable. DeBERTa blocks over 1/3 of legitimate queries.

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

### 1. Neither classifier handles indirect injection reliably

InjecAgent (tool-response injection) makes up 75% of our attack dataset. Both classifiers achieve only 35-50% TPR on these attacks. This is the dominant threat for agentic applications.

### 2. PG2 is production-viable, DeBERTa is not

PG2's 3.8% FPR is acceptable for production. DeBERTa's 36.8% FPR would block over 1/3 of legitimate traffic - unacceptable for any real application.

### 3. Encoding bypasses defeat PG2 completely

PG2 has 0% TPR on base64, ROT13, and hex-encoded payloads. DeBERTa catches 75-88% of these. If encoding attacks are a concern, DeBERTa's patterns are more robust (but FPR is a dealbreaker).

### 4. Both excel at obvious injection patterns

Direct instruction override, delimiter injection, and persona hijacking are well-detected (100% TPR). These patterns are well-represented in training data.

### 5. Subtle attacks defeat both classifiers

- Crescendo (gradual persuasion): 0-28% TPR
- CoT hijacking: 0-50% TPR
- Policy puppetry: ~28% TPR

---

## Recommendations

### For Production Deployment

1. **Use PG2 as fast first-pass filter**
   - Catches obvious attacks with minimal false positives
   - 556ms latency is acceptable for most applications
   - Accept ~50% miss rate on sophisticated attacks

2. **Add LLM-based classifier for high-value contexts**
   - DATDP or CCFC for tool-calling agents
   - Escalate when PG2 confidence is uncertain
   - Worth the ~2-3s latency for sensitive operations

3. **Do NOT use DeBERTa in production**
   - 36.8% FPR is catastrophic for user experience
   - Would need significant threshold tuning

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
  ├─► PG2 (500ms)
  │     └─ Block: direct injection, persona hijacking
  │     └─ Escalate: low confidence
  │
  └─► DATDP/CCFC (2-3s) [if escalated or high-value]
        └─ Block: tool injection, sophisticated attacks
```

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

Full benchmark output: `data/classifier-comparison-2026-02-04T21-*.json`

**Dataset Composition:**
- InjecAgent: 2,108 cases (74.9%)
- NotInject benign: 339 cases (12.0%)
- ZeroLeaks: 264 cases (9.4%)
- Curated injection: 43 cases (1.5%)
- Curated benign: 60 cases (2.1%)
