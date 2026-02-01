# TODO

## Completed
- [x] Remove duplicate HOOK.md (deleted `hook/` directory, kept `patch/`)
- [x] Add `data/` directory for benchmark results + added to .gitignore
- [x] Integrate DATDP GitHub as submodule (`tests/fixtures/datdp/`)
- [x] Integrate ZeroLeaks GitHub as submodule (`tests/fixtures/zeroleaks/`)
- [x] Use canonical DATDP prompt structure from paper
- [x] Create DATDP benchmark using their datasets
- [x] Update README with citations to all three repos (DATDP, HarmBench, ZeroLeaks)

## Pending
- [ ] Use the current default inference config structure of moltbot to find what inference provider the main model is using and configure moltshield based on it
- [ ] Revisit the architecture doc
- [ ] Have claude give thorough walkthrough of codebase (add comments as we go and revisit arch doc)
- [ ] Deploy to my fresh laptop with new moltbot install
- [ ] Run full benchmarks with LLM evaluation (requires API key)
- [ ] Test self-patching reliability (100 simulation runs)

## Unordered in priority:

- [ ] Integrate shiledgemma 2
- [ ] GEPA extension (https://arxiv.org/abs/2507.19457)
- Research the latest from Pliny and Greyswan
- Check for propper concurency in small model calls
- Make sure skill install isn't heavy e.g. lazy-load submodules and depps for benchmarks
- Remove mock from self-patch-sim.ts and run on the dev test machine
- Quarantine system
- Choose default small models for all major providers
- Push to molthub