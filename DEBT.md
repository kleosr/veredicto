# DEBT — veredicto

Deferred work. Not a roadmap wish-list: only items that are true today and unpaid.

| ID | Item | Why deferred | Upgrade path |
| --- | --- | --- | --- |
| D1 | Touched-file delta still keyed by `file\|code\|message` | A line shift in an edited file must not look like a new error | Two byte-identical errors in one edited file still collapse |
| D2 | Code-fix provider errors swallowed | A missing suggestion is acceptable; a crashed check is not | Surface provider failure as a non-failing field |
| D3 | Candidates are full-file contents | Diff parsing is a product surface | Unified-diff input |
| D5 | CI actions still on Node-20 runtime under the hood | Pinned SHAs work; deprecation annotation only | Bump action SHAs when Node-24-native chosen |
| D6 | No external integrator yet | Artifact shipped; adoption is the next job | First framework / CLI agent / eval harness |
| D7 | Large-repo numbers are synthetic (200 modules) | Real customer repos vary | Collect `npm run bench -- --project …` reports |
| D8 | Impact is export-signature + references, not full RD/DU | Full reaching-definitions is a larger analysis pass | Intra-procedural RD over checker CFG facts where available |
| D9 | Fix confidence is heuristic | TypeScript does not expose a stable safety enum for all fixes | Prefer `fixId` / preferred lists as TS evolves; keep preconditions |

Resolved recently:

- Untouched-file diagnostic keys include the span. Edited files stay on `file|code|message`.
- Parallel workers keep their Session for the life of the process. The first batch pays init; later batches reuse it.
- Non-loopback `--host` without auth → rejected.
- Thesis docs + large bench generator → shipped.
- Parallel candidate workers (process isolation via worker_threads) → shipped.
- Repair confidence + preconditions → shipped.
- Semantic impact (export + refs) → shipped.
- Formal JSON Schema → shipped.
