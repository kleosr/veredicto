# veredicto protocol v1

**Status:** stable for v0.1.x. Additive fields may appear; existing field meanings will not change without a major version bump (`/v2/...`).

Everything is JSON. Positions are **1-based** (line and column). Paths in requests may be project-relative (resolved against the directory that contains `tsconfig.json`) or absolute. Response paths are absolute.

This document is the contract. Implementations (this repo's daemon/CLI, future backends, future languages) must preserve the semantics below.

---

## Design invariants

1. **Delta verdict.** `verdict: "pass"` means the candidate introduced zero new *error*-category diagnostics relative to the session baseline. Pre-existing errors do not fail a candidate. Warnings and suggestions never fail a candidate.
2. **Disk is never written.** Candidates are overlays. After each candidate, the session restores to baseline state.
3. **Baseline is captured once** at session construction (daemon start / CLI process start), from the on-disk project.
4. **One process, sequential candidates** in v1. Parallelism is a v0.2 concern; clients must not assume concurrent `/v1/check` bodies are safe against one shared session.
5. **Loopback by default.** The reference server binds `127.0.0.1`. Non-loopback hosts are rejected without auth (v1 has no auth).

---

## GET /v1/health

No body. Always `200` when the process is up and the session constructed.

```json
{
  "ok": true,
  "project": "/abs/path/tsconfig.json",
  "files": 3,
  "baselineErrors": 1
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `ok` | boolean | Always `true` on success |
| `project` | string | Absolute path to the loaded tsconfig |
| `files` | number | Root file count in the current program (no overlays) |
| `baselineErrors` | number | Error-category diagnostics at session start |

---

## POST /v1/check

### Request

```json
{
  "fixes": true,
  "candidates": [
    {
      "id": "patch-a",
      "files": {
        "src/report.ts": "<full new file content>",
        "src/gone.ts": null
      }
    }
  ]
}
```

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `candidates` | yes | array | One or more candidates; checked in order |
| `candidates[].id` | yes | non-empty string | Client-chosen id, echoed in the result |
| `candidates[].files` | yes | object | Path → full content (`string`) or delete (`null`) |
| `fixes` | no | boolean | Default `false`. When `true`, attach repair actions for new errors (capped at the first 3 new errors per candidate) |

**Overlay rules:**

- Path present with a string → replace or create that file for the duration of the check.
- Path present with `null` → file does not exist for the duration of the check.
- Path absent → on-disk content (or absence) is used.
- New `.ts` / `.tsx` / `.mts` / `.cts` paths are added to the program roots.

Body size limit (reference server): 20 MiB.

### Response (`200`)

```json
{
  "project": "/abs/path/tsconfig.json",
  "baseline": { "errorCount": 1 },
  "results": [
    {
      "id": "patch-a",
      "verdict": "pass",
      "summary": {
        "newErrors": 0,
        "fixedErrors": 1,
        "totalErrors": 0,
        "checkedMs": 34
      },
      "newDiagnostics": [],
      "fixedDiagnostics": [
        {
          "code": "TS2322",
          "category": "error",
          "file": "/abs/path/src/report.ts",
          "position": { "line": 3, "col": 14 },
          "length": 5,
          "message": "Type 'number' is not assignable to type 'string'."
        }
      ],
      "fixes": []
    }
  ]
}
```

### Result fields

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Echo of the request id |
| `verdict` | `"pass"` \| `"fail"` | `pass` iff `summary.newErrors === 0` |
| `summary.newErrors` | number | Count of *error*-category diagnostics in the added set |
| `summary.fixedErrors` | number | Count of *error*-category diagnostics in the removed set |
| `summary.totalErrors` | number | Error-category count under the overlay (whole picture) |
| `summary.checkedMs` | number | Wall time for this candidate, rounded ms |
| `newDiagnostics` | array | Full delta added (any category) |
| `fixedDiagnostics` | array | Full delta removed (any category) |
| `fixes` | array | Repair actions when `fixes: true`, else `[]` |

### Diagnostic object

| Field | Type | Meaning |
| --- | --- | --- |
| `code` | string | Stable TypeScript code, e.g. `"TS2322"` |
| `category` | `"error"` \| `"warning"` \| `"suggestion"` \| `"message"` | Maps `ts.DiagnosticCategory` |
| `file` | string | Absolute path, or `"(project)"` for project-level diagnostics |
| `position` | `{ line, col }` \| `null` | 1-based; `null` when no span |
| `length` | number | UTF-16 code unit length of the span (TypeScript convention) |
| `message` | string | Flattened diagnostic message (single line, spaces for newlines) |

### Delta keying (v1 ceiling)

Two diagnostics are the same for delta purposes when
`file + "|" + code + "|" + message` match.

Consequences:

- A diagnostic that only moves (same file/code/message, different span) is **not** reported as new.
- Two byte-identical errors in one file collapse to one key.
- v0.2 target: span-anchored keys for files the candidate did not touch.

### Repair action object

Returned only when `fixes: true`. Built from `ts.LanguageService.getCodeFixesAtPosition` for each of the first 3 new errors.

```json
{
  "forCode": "TS2322",
  "file": "/abs/path/src/report.ts",
  "fixName": "fixOverrideModifier",
  "description": "…",
  "edits": [
    {
      "file": "/abs/path/src/report.ts",
      "position": { "line": 3, "col": 14 },
      "length": 5,
      "newText": "number"
    }
  ]
}
```

Apply `edits` **back-to-front** (highest offset first) so earlier offsets stay valid. Code-fix providers can fail on exotic spans; a missing suggestion yields an empty `fixes` list for that diagnostic — the check itself must not crash.

### Errors

| Status | Body | When |
| --- | --- | --- |
| `400` | `{ "error": "<why>" }` | Malformed JSON, bad candidate shape, body too large |
| `404` | `{ "error": "not found" }` | Unknown path |
| `500` | `{ "error": "<why>" }` | Unexpected server failure |

---

## CLI (same semantics)

```bash
veredicto check --project <tsconfig.json> --candidates <candidates.json> [--fixes] [--compact]
veredicto serve --project <tsconfig.json> [--port 4117]
```

- `candidates.json` is the `candidates` array (not wrapped in `{ "candidates": … }`).
- `check` exit codes: **0** all pass, **2** at least one fail, **1** usage error or crash.
- `--compact` prints one header line per candidate plus `+` / `-` lines per changed diagnostic (token-budget mode). Not a substitute for the JSON contract.
- `serve` binds `127.0.0.1` only. There is no `--host` in v1.

---

## Library surface (Node)

```ts
import { Session } from "veredicto";

const session = new Session("/abs/path/tsconfig.json");
const response = session.checkAll(candidates, { withFixes: true });
```

`Session` and the types in `verdict` are the public API. Semver applies to exported names and protocol field meanings together.

---

## Versioning

- Path prefix `/v1/` is frozen for the semantics in this document.
- Breaking changes require `/v2/` and a major package version.
- Additive optional response fields are allowed in v1 without a bump.
- Clients should ignore unknown fields (forward compatible).

---

## Out of scope for v1 (explicit)

- Unified-diff / patch input (full-file contents only)
- Parallel candidate workers
- Authentication / non-loopback binding
- Non-TypeScript checkers
- Guaranteeing a code fix for every new error
