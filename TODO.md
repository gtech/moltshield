# TODO

## Completed
- [x] Remove duplicate HOOK.md (deleted `hook/` directory, kept `patch/`)
- [x] Add `data/` directory for benchmark results + added to .gitignore
- [x] Integrate DATDP GitHub as submodule (`tests/fixtures/datdp/`)
- [x] Integrate ZeroLeaks GitHub as submodule (`tests/fixtures/zeroleaks/`)
- [x] Use canonical DATDP prompt structure from paper
- [x] Create DATDP benchmark using their datasets
- [x] Update README with citations to all three repos (DATDP, HarmBench, ZeroLeaks)
- [x] Research the latest from Pliny and Greyswan
- [x] Check for propper concurency in small model calls
- [x] test greyswan https://huggingface.co/collections/GraySwanAI/model-with-circuit-breakers
- [x] turn heurisics off by default
- [x] Cost-benefit analysis of heuristics, might be useless overhead
- [x] is the pre agent step hook good enough for our patch?
- CCFC timeout issue in parallel benchmarks (makes 3x API calls, needs longer timeout or rate limiting)
- Add `data/` to .gitignore

## Research Program

### Hypothesis
Cascade architecture: **Local classifier (fast) → Exchange (smart) → Escalation (expensive)**

Small local classifiers catch obvious syntactic attacks cheaply. Exchange classifier catches semantic manipulation that slips through. Escalation (expensive LLM) handles edge cases where confidence is low.

### Attack Taxonomy
Understanding what each layer catches:
- **Direct injection** (attack in user prompt) → pre-inference classifiers
- **Indirect injection** (attack in tool result/content) → exchange classifier
- **Agentic/multi-step** (attack spans turns) → requires stateful detection?

### Classifier Candidates
| Classifier | Type | Latency | Focus |
|------------|------|---------|-------|
| ProtectAI DeBERTa | Local transformer | ~350ms | Direct injection |
| Meta Prompt Guard 2 | Local (86M) | ~325ms | Direct injection |
| LlamaGuard 3 | Local (8B) or API | ~500ms+ | Harmful content |
| Lakera Guard | API | ~100ms | Injection + jailbreak |
| DATDP (Haiku) | API | ~1-2s | Semantic analysis |

### Phase 1: Pre-inference Classifier Comparison
- [ ] Benchmark: ProtectAI vs PG2 vs Lakera on ZeroLeaks + InjecAgent
- [ ] Test: OR combination (any blocks → block)
- [ ] Test: Weighted ensemble (are they deterministic anyway?)
- [ ] Test: Input normalization (case folding, invisible char strip, ROT13 decode)
- [ ] Measure: TPR/FPR per attack category, latency, cost

### Phase 2: Exchange Classifier Validation
- [ ] Validate ground truth methodology (is LLM judge accurate?)
- [ ] Benchmark exchange on INDIRECT_INJECTION_CASES (53 curated)
- [ ] Compare: pre-only vs post-only vs cascade
- [ ] Question: Does exchange catch what pre-inference misses, or different attacks entirely?

### Phase 3: Cascade Architecture Design
- [ ] When does pre-inference catch what exchange misses? (syntactic attacks)
- [ ] When does exchange catch what pre-inference misses? (semantic manipulation)
- [ ] Escalation trigger design: confidence threshold? disagreement? attack type?
- [ ] False positive handling: escalate FPs to expensive model?

### Phase 4: Agentic Scenario Testing
- [ ] AgentDojo: multi-step tool-use attacks
- [ ] InjecAgent: tool-integrated injection (1,054 cases)
- [ ] Question: Do current approaches generalize to multi-turn?

### Open Questions
- Do naive heuristics ever help, or just add latency?
- Does an OS version of Hivefence.com exist?
- Are there other small classifiers we're missing?
- What is comparative performance vs other ClawHub skills?

---

## Benchmark Framework Requirements

### Data Management
- [x] Runtime loading from submodules (ZeroLeaks, AgentDojo, InjecAgent, NotInject, BIPIA)
- [x] Subset selection: by category, by count, by ID pattern
- [x] Curated datasets in `datasets.ts` for regression testing
- [x] All results saved with full metadata (for future classifier training)
- [x] Unit tests for loaders (64 tests)

**Dataset totals:**
| Source | Injection | Benign | Notes |
|--------|-----------|--------|-------|
| Curated | 43 | 60 | Hand-crafted scenarios |
| ZeroLeaks | 264 | - | 16 attack categories |
| InjecAgent | 2,108 | - | Tool-integrated attacks |
| AgentDojo | 457-5000+ | 337 | Multi-turn agentic (depends on model/attack types) |
| NotInject | - | 339 | Benign with trigger words |
| BIPIA | 50 | 25 | Code/text injection |

### Execution
- [x] Parallel execution with configurable concurrency
- [ ] LPU/fast inference routing (Groq, Cerebras via OpenRouter)
- [x] Timeout and retry handling
- [x] Progress reporting

### Metrics & Reporting
- [x] Per-category breakdown (TPR for delimiter vs exfil vs persona)
- [x] Cost tracking (input/output tokens, dollars)
- [x] Latency percentiles (p50, p95, p99)
- [x] Confusion matrix and F1 per attack type
- [x] JSON + human-readable output

### Composability
- [x] Test single classifier in isolation (harness.ts)
- [ ] Test A→B serial cascade (escalation)
- [ ] Test A∥B parallel (any/all blocking modes)
- [ ] Test full pipeline: heuristics → classifier → exchange → escalate

---

## Attack Taxonomy & Future Coverage

See `tests/benchmarks/attack-taxonomy.ts` for full documentation.

### Current Coverage Gaps
- [ ] AgentDojo: Load all attack types (not just important_instructions)
- [ ] Multi-turn attack evaluation framework
- [ ] Encoding augmentation pipeline (apply ZeroLeaks encodings to any payload)
- [ ] Attack-type-specific metrics in benchmark reports

### AgentDojo Attack Types Available
| Attack Type | gpt-4o | claude-3 | Notes |
|-------------|--------|----------|-------|
| important_instructions | ✓ 565 | ✓ 80 | Primary attack |
| direct | ✓ 569 | - | "TODO: {goal}" |
| ignore_previous | ✓ 565 | - | Classic override |
| tool_knowledge | ✓ 567 | - | Includes tool schemas |
| injecagent | ✓ 570 | - | InjecAgent-style |
| variants (no_names, etc) | ✓ 2000+ | - | Parameterization tests |

### Future Work (Post-MVP)
- Community-maintained classifier registry
- CFCC for escalated models
- Stateful detection for multi-turn attacks
- Adaptive thresholds based on user/session risk score

## Pending
- [ ] Use the current default inference config structure of moltbot to find what inference provider the main model is using and configure moltshield based on it
- [x] Revisit the architecture doc
- [x] CCFC Extension Merge (Jim @arealjim) https://arxiv.org/html/2508.14128v1
- [ ] Deploy to cloud instance
- [ ] Test self-patching reliability, including cron graceful failover
- [ ] **Benchmark scripts** - See Research Program above for full benchmark plan
- [ ] **Migrate from skill to plugin** - Skills require self-patching; plugins have proper hooks (`before_agent_start`, `tool_result_persist`, etc.). Investigate if plugin hooks are sufficient or if we still need streamFn patch for full context access including images.
- Remove mock from self-patch-sim.ts and run on the dev test machine
- LRU cache unit test
- routing to groq and cerebras for openrouter
- send bypass notification to user 
- context length considerations, make sure context length of the main model doesn't overwhelm smaller models
- test that haiku is reached directly in max plan
- add response filtering step as per pg 13 of DATDP, as well as paraphrasing 
- consider multimodal protection
- Make sure skill install isn't heavy e.g. lazy-load submodules and depps for benchmarks
- Choose default small models for all major providers
- github actions basic sanity unit tests
- [x] reconcile benchmarks and benchmarks-sentinel_v2 (cleaned up, kept sentinel_v2 for classifier diversity research)
- add escalation framework
- break auth and config into plugin lifecycle?
- honestly see if those prompts work for images
- reexamine cc++ and cfcc prompts vs paper
- normalization module alongside heuristic module.
- TraceEntry node naming: use fixed `type` field for programmatic matching, keep descriptive `node` for display
- [x] Are DATDP, CFCC, and Exchange differentiated? (covered in Research Program Phase 2-3)

- Push to clawdhub https://www.clawhub.com/

## Unordered in priority:

- manually check change log of streamfn
- git actions for small benchmark 

## Post-launch

- [ ] reputation score backoff in case of repeated attacks from one vector
- [ ] GEPA extension (https://arxiv.org/abs/2507.19457)
- [ ] Quarantine system
- [ ] Resilient ecosystem