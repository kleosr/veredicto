# Integrating veredicto into an agent loop

This is the drop-in recipe. Goal: replace "spawn `tsc`, scrape stderr" with one warm session and structured verdicts.

## Minimal loop

```
baseline session (once)
  └─ for each candidate patch:
       POST /v1/check  { candidates: [{ id, files }], fixes: true }
         ├─ verdict === "pass"  → accept (optionally prefer higher fixedErrors)
         └─ verdict === "fail"  → feed newDiagnostics (+ fixes) back to the model
```

Disk is never written by veredicto. Your agent decides when (if ever) to flush a winning overlay to disk.

## One-shot CLI

Useful for scripts and eval harnesses that already materialize full-file candidates as JSON:

```bash
veredicto check \
  --project ./tsconfig.json \
  --candidates ./candidates.json \
  --fixes \
  --compact
```

Exit codes: `0` all pass, `2` any fail, `1` usage/crash. Agents can branch on `$?` without parsing JSON; use JSON (omit `--compact`) when they need diagnostics.

`candidates.json`:

```json
[
  {
    "id": "attempt-3",
    "files": {
      "src/math.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n"
    }
  }
]
```

## Daemon + HTTP (recommended for multi-attempt loops)

Start once per project:

```bash
veredicto serve --project ./tsconfig.json --port 4117
```

Health:

```bash
curl -s http://127.0.0.1:4117/v1/health
```

Check:

```bash
curl -s http://127.0.0.1:4117/v1/check \
  -H 'content-type: application/json' \
  -d @- <<'EOF'
{
  "fixes": true,
  "candidates": [
    {
      "id": "attempt-3",
      "files": {
        "src/report.ts": "import { add } from \"./math.js\";\n\nexport const total: number = add(1, 2);\n"
      }
    }
  ]
}
EOF
```

## Node library

```js
import { Session } from "veredicto";

const session = new Session(new URL("./tsconfig.json", import.meta.url).pathname);
const { results } = session.checkAll(
  [{ id: "a", files: { "src/x.ts": "export const n: number = 1;\n" } }],
  { withFixes: true },
);

for (const result of results) {
  if (result.verdict === "pass") {
    // accept; prefer higher result.summary.fixedErrors among passers
  } else {
    // give result.newDiagnostics (and result.fixes) to the model
  }
}
```

Runnable example: [examples/agent-loop.mjs](../examples/agent-loop.mjs).

```bash
node examples/agent-loop.mjs
```

## How to feed failures back to a model

Keep the prompt short. Prefer structured fields over prose:

```
Candidate attempt-3 FAILED.
newErrors=2 fixedErrors=0 totalErrors=3

New diagnostics:
- src/report.ts:3:14 TS2322 Type 'number' is not assignable to type 'string'.
- src/math.ts:1:17 TS2305 Module '"./math"' has no exported member 'add'.

Suggested repairs (apply back-to-front):
- TS2322 @ src/report.ts:3:14 len=6 → "number"
```

Or pass the JSON `results[0]` object directly as a tool result — that is the intended path. `--compact` exists when you must stay in text.

## Ranking multiple candidates

When you batch N candidates in one request:

1. Prefer `verdict === "pass"`.
2. Among passers, prefer higher `summary.fixedErrors` (real debt paid down).
3. Among failures, prefer lower `summary.newErrors`, then use `fixes` as hints for the next generation round.
4. Never treat a drop in `totalErrors` alone as success if `newErrors > 0` — that can be noise from unrelated baseline movement (v1 delta keying is file+code+message).

## Claude Code / OpenCode / custom agents

Expose a single tool, e.g. `veredicto_check`:

| Arg | Type | Notes |
| --- | --- | --- |
| `candidates` | array | Same shape as protocol |
| `fixes` | boolean | Default `true` for repair loops |

Implementation options:

1. **HTTP** — keep `veredicto serve` running for the workspace; tool does `fetch("http://127.0.0.1:4117/v1/check", …)`.
2. **Library** — long-lived agent process holds one `Session` and calls `checkAll`.
3. **CLI subprocess** — fine for evals; pay init cost each process (use daemon for interactive loops).

Do not shell out to `tsc` and scrape. That is the loop this tool replaces.

## CI / eval harnesses

```bash
veredicto check --project "$TSCONFIG" --candidates "$CANDIDATES" > verdict.json
code=$?
# code 0 or 2 are both "ran successfully"; branch on verdicts inside JSON
```

For thousands of patches/hour: one daemon per project under test, POST batches, record `summary.checkedMs`. Parallel workers are v0.2 — today, scale out with one process per project, not per candidate.

## What not to do

- Don't bind the daemon off loopback (v1 rejects non-loopback hosts).
- Don't assume two identical errors in one file are counted twice (delta key ceiling).
- Don't treat warnings as failures — only `category: "error"` affects `verdict`.
- Don't skip reading [PROTOCOL.md](PROTOCOL.md) before encoding a client; field meanings are the contract.
