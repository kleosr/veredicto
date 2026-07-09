# DEBT — veredicto

Deferred work. Not a roadmap wish-list: only items that are true today and unpaid.

| ID | Item | Why deferred | Upgrade path |
| --- | --- | --- | --- |
| D1 | Delta keyed by `file\|code\|message` | Span anchoring needs careful baseline matching for untouched files | v0.2: span-anchored keys for files the candidate did not touch |
| D2 | Code-fix provider errors swallowed | A missing suggestion is acceptable; a crashed check is not | Surface provider failure as a non-failing diagnostic / `fixes` warning field |
| D3 | Candidates are full-file contents | Diff parsing is a product surface, not a one-liner | v0.2: unified-diff input |
| D4 | Sequential candidates in one process | Correctness first; shared LanguageService is not free-threaded | v0.2: parallel workers (process-per-worker or isolated programs) |
| D5 | CI actions still on Node-20 runtime under the hood | Pinned SHAs work; deprecation annotation only | Bump `actions/checkout` / `setup-node` / `setup-python` when Node-24-native SHAs are chosen |
| D6 | No external integrator yet | Artifact shipped; adoption is the next job | First framework / CLI agent / eval harness wired to `/v1/check` |
| D7 | Large-repo numbers are synthetic (200 modules) | Real customer repos vary | Collect `npm run bench -- --project …` reports via issues |

Resolved in this pass:

- Non-loopback `--host` without auth → **rejected** in CLI (loopback only).
- Pitch / protocol / integration / announce docs → shipped.
- Bench `--project` + synthetic large project generator → shipped.
