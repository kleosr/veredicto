# Architecture — agent-first layers on TypeScript

## Precise claim (what this repo is)

veredicto is **not** a new TypeScript frontend. It keeps Microsoft's parser + binder + checker (via `ts.createLanguageService`) and adds **post-type-checking phases** whose primary reader is a machine, not a human at a terminal.

| Dragon-book phase (approx.) | Who owns it here |
| --- | --- |
| Lexical / syntax analysis | TypeScript (unchanged) |
| Semantic analysis (types) | TypeScript checker (unchanged) |
| Intermediate facts for agents | **veredicto** — verdict schema, diagnostic delta, repair actions |
| Data-flow-style impact (def–use over checker facts) | **veredicto** — `impact` phase |
| Speculative multi-candidate evaluation | **veredicto** — sequential session *or* process/worker fan-out |

Reimplementing chapters 2–8 of *Compilers: Principles, Techniques, and Tools* for TypeScript is out of scope and high risk. A greenfield language would need that stack; this project does not.

## Pipeline (one candidate)

```
on-disk project
    │
    ▼
Session init ──► baseline diagnostics (once)
    │
    ▼
apply overlays (memory only; disk untouched)
    │
    ▼
TypeScript LanguageService
    ├─ syntactic diagnostics
    └─ semantic diagnostics
    │
    ▼
Phase A — Verdict delta
    newDiagnostics / fixedDiagnostics / summary / verdict
    │
    ▼
Phase B — Repair extraction (optional, fixes:true)
    code fixes → edits + confidence + preconditions
    │
    ▼
Phase C — Semantic impact (optional, impact:true)
    export signature diff + reference (def–use) fan-out
    │
    ▼
restore overlays → baseline state
```

## Why LanguageService, not raw Program alone

Overlays, versioning, and `getCodeFixesAtPosition` / `findReferences` are LanguageService surfaces. A bare `ts.createProgram` per candidate would re-pay cold construction and lose repair/reference APIs that agents need.

## Parallelism model (v0.2)

One `LanguageService` instance is **not** safe for concurrent overlay mutate/check/restore. Parallel candidates therefore use **one Session per worker** (`worker_threads`), each with its own service and baseline. That duplicates init cost across workers but keeps warm checks inside each worker independent. Sequential mode on a single Session remains the default (lowest memory, shared baseline).

## What "agent-first" means in the wire format

Primary output is JSON. Human prose (`message`, `--compact`) is secondary. Every actionable object carries:

- stable codes (`TSxxxx`)
- precise spans (1-based position + length)
- machine-applicable edits
- optional impact (which defs/uses/types moved)
- optional fix confidence + preconditions

Contract: [PROTOCOL.md](PROTOCOL.md). Schema: [veredicto.schema.json](veredicto.schema.json).
