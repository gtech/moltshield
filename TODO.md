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

## Pending
- [ ] Use the current default inference config structure of moltbot to find what inference provider the main model is using and configure moltshield based on it
- [x] Revisit the architecture doc
- [x] CCFC Extension Merge (Jim @arealjim) https://arxiv.org/html/2508.14128v1
- [ ] Deploy to cloud instance
- [ ] Test self-patching reliability, including cron graceful failover
- [ ] **Benchmark scripts: DATDP vs CCFC vs Exchange classifier** - Create scripts to pit the three approaches against HarmBench, ZeroLeaks, and BoN benchmarks. Measure ASR, FPR, F1, latency, and cost per evaluation.
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
- reconcile benchmarks and benchmarks-sentinel_v2
- add escalation framework
- break auth and config into plugin lifecycle?
- honestly see if those prompts work for images
- reexamine cc++ and cfcc prompts vs paper
- normalization module alongside heuristic module.
- rewrite arch docs; dedup arch from contributors.md
- TraceEntry node naming: use fixed `type` field for programmatic matching, keep descriptive `node` for display
- CCFC timeout issue in parallel benchmarks (makes 3x API calls, needs longer timeout or rate limiting)
- Add `data/` to .gitignore

- Push to clawdhub https://www.clawhub.com/

## Unordered in priority:

- diversity of small models that update in order to avoid mode collapse
- manually check change log of streamfn
- git actions for small benchmark 
- compete against laka, prompt-guard, and hive
- consider adding hive

## Post-launch

- [ ] reputation score backoff in case of repeated attacks from one vector
- [ ] GEPA extension (https://arxiv.org/abs/2507.19457)
- [ ] Quarantine system
- [ ] Resilient ecosystem