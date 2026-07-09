# GOAL — veredicto v0.1.0

One sentence: a daemon + CLI that batch-verifies candidate TypeScript patches against a live project session and answers with structured verdicts (new/fixed/total errors, repair actions), not prose.

## Done criteria (binary)

- [x] `npm run build` exits 0 (TypeScript 5.9.3, strict, NodeNext)
- [x] `npm test` — 9/9 node:test cases pass (core + HTTP + loopback guard, one shared session)
- [x] Cross-file regression detection proven by test: patch `math.ts`, error reported in `report.ts`
- [x] New-file and deleted-file overlays proven by test
- [x] `npm run bench` shows warm per-candidate check faster than cold `tsc --noEmit` (fixture + synthetic large project; see [docs/BENCH.md](docs/BENCH.md))
- [x] `npx @biomejs/biome ci .` exits 0 — every rule on, nursery included, suppressions only inline with a reason
- [x] `npm run semgrep` exits 0 — open-registry stack, 0 findings
- [x] Pushed to GitHub, CI green on `main`
- [x] Published to npm as `veredicto@0.1.0`
- [x] Thesis docs shipped: [PITCH.md](PITCH.md), [ANNOUNCE.md](ANNOUNCE.md), [docs/PROTOCOL.md](docs/PROTOCOL.md), [docs/INTEGRATION.md](docs/INTEGRATION.md), [docs/BENCH.md](docs/BENCH.md)
- [x] Drop-in agent example: [examples/agent-loop.mjs](examples/agent-loop.mjs)
- [x] Serve refuses non-loopback hosts (v1 has no auth)

## Scope fences (v0.1 will NOT)

- Parse unified diffs — candidates are full-file contents
- Run candidates in parallel workers
- Wrap tsgo or any non-tsc checker
- Add auth or allow non-loopback binding

## Next (not v0.1 done-criteria)

- First external integrator of `/v1/check` (framework / CLI agent / eval harness)
- Real-repo bench numbers filed as issues (`npm run bench -- --project …`)
- v0.2: unified-diff input, parallel workers, span-anchored deltas

## STUCK brake

If TypeScript LanguageService overlay behavior diverges from documented semantics for more than 2 hours of investigation, stop, write STUCK.md with the smallest failing repro, and cut scope to CLI-only.
