# GOAL — veredicto

One sentence: a daemon + CLI that batch-verifies candidate TypeScript patches against a live project session and answers with structured verdicts (new/fixed/total errors, repair actions, semantic impact), not prose — without reimplementing the TypeScript frontend.

## v0.1.0 — done

- [x] Warm LanguageService session, overlays, delta verdicts, repairs, HTTP/CLI
- [x] Cross-file / new-file / deleted-file tests; bench; Biome; semgrep
- [x] GitHub + CI + npm `veredicto@0.1.0`
- [x] Thesis docs (PITCH, ANNOUNCE, PROTOCOL, INTEGRATION, BENCH)
- [x] Loopback-only serve

## v0.2 — agent-first post-checker phases (in progress locally)

Architecture: keep TypeScript parser + checker; add phases after typechecking. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- [x] Formal JSON Schema for CheckResponse ([docs/veredicto.schema.json](docs/veredicto.schema.json))
- [x] `protocolVersion` on responses; `impact: null` when not requested
- [x] Semantic impact: export signature diff + `findReferences` def–use fan-out (`impact: true` / `--impact`)
- [x] Repair `confidence` + `preconditions`
- [x] Speculative parallel candidates via `worker_threads` (`parallel: true` / `--parallel`)
- [x] Tests covering impact, confidence, parallel (13/13)
- [x] Publish `0.2.0` (schema, impact, confidence, parallel, before/after bench)
- [ ] Full intra-procedural reaching-definitions (beyond export+refs) — deferred
- [ ] Unified-diff input — deferred
- [ ] Span-anchored diagnostic keys — deferred (D1)

## Scope fences (still)

- Do **not** rewrite the TypeScript frontend (Dragon Book ch. 2–8 for TS)
- Do **not** add auth / non-loopback binds without a token design
- Do **not** claim a full data-flow solver; impact is checker-backed export + references

## STUCK brake

If TypeScript LanguageService overlay or reference behavior diverges from documented semantics for more than 2 hours of investigation, stop, write STUCK.md with the smallest failing repro, and cut the failing phase.
