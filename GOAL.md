# GOAL — veredicto v0.1.0

One sentence: a daemon + CLI that batch-verifies candidate TypeScript patches against a live project session and answers with structured verdicts (new/fixed/total errors, repair actions), not prose.

## Done criteria (binary)

- [x] `npm run build` exits 0 (TypeScript 5.9.3, strict, NodeNext)
- [x] `npm test` — 8/8 node:test cases pass (core + HTTP, one shared session)
- [x] Cross-file regression detection proven by test: patch `math.ts`, error reported in `report.ts`
- [x] New-file and deleted-file overlays proven by test
- [x] `npm run bench` shows warm per-candidate check faster than cold `tsc --noEmit` (34.9 ms vs 6,640 ms avg in the build container)
- [x] `npx @biomejs/biome ci .` exits 0 — every rule on, nursery included, suppressions only inline with a reason
- [x] `npm run semgrep` exits 0 — 159 rules (security-audit, OWASP Top 10, secrets, Trail of Bits, TS/JS packs), 0 findings
- [x] Pushed to GitHub, CI green on `main`

## Scope fences (v0.1 will NOT)

- Parse unified diffs — candidates are full-file contents
- Run candidates in parallel workers
- Wrap tsgo or any non-tsc checker
- Add auth or allow non-loopback binding

## STUCK brake

If TypeScript LanguageService overlay behavior diverges from documented semantics for more than 2 hours of investigation, stop, write STUCK.md with the smallest failing repro, and cut scope to CLI-only.
