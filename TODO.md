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
- [ ] Deploy to cloud instance
- [ ] Test self-patching reliability, including cron graceful failover
- [ ] **Benchmark scripts: DATDP vs CCFC vs Exchange classifier** - Create scripts to pit the three approaches against HarmBench, ZeroLeaks, and BoN benchmarks. Measure ASR, FPR, F1, latency, and cost per evaluation.
- [ ] **Migrate from skill to plugin** - Skills require self-patching; plugins have proper hooks (`before_agent_start`, `tool_result_persist`, etc.). Investigate if plugin hooks are sufficient or if we still need streamFn patch for full context access including images.
- Remove mock from self-patch-sim.ts and run on the dev test machine
- LRU cache unit test
- routing to groq and cerebras for openrouter
- send bypass notification to user 
- CCFC Extension Merge (Jim @arealjim) https://arxiv.org/html/2508.14128v1
- context length considerations, make sure context length of the main model doesn't overwhelm smaller models
- test that haiku is reached directly in max plan
- add response filtering step as per pg 13 of DATDP, as well as paraphrasing 
- consider multimodal protection
- Make sure skill install isn't heavy e.g. lazy-load submodules and depps for benchmarks
- Choose default small models for all major providers
- github actions basic sanity unit tests

- Push to clawdhub https://www.clawhub.com/

## Unordered in priority:

- diversity of small models that update in order to avoid mode collapse
- manually check change log of streamfn
- edgecase: when the response is an image
- git actions for small benchmark 
- compete against laka, prompt-guard, and hive

## Post-launch

- [ ] reputation score backoff in case of repeated attacks from one vector
- [ ] GEPA extension (https://arxiv.org/abs/2507.19457)
- [ ] Quarantine system
- [ ] Resilient ecosystem