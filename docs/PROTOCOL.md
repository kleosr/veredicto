# veredicto protocol v1

**Status:** stable for v0.1.x with additive agent-first fields. Existing field meanings will not change without a `protocolVersion` / path bump (`/v2/...`).

Formal JSON Schema: [veredicto.schema.json](veredicto.schema.json). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).

Everything is JSON. Positions are **1-based** (line and column). Paths in requests may be project-relative (resolved against the directory that contains `tsconfig.json`) or absolute. Response paths are absolute.

---

## Design invariants

1. **Delta verdict.** `verdict: "pass"` means the candidate introduced zero new *error*-category diagnostics relative to the session baseline. Pre-existing errors do not fail a candidate. Warnings and suggestions never fail a candidate.
2. **Disk is never written.** Candidates are overlays. After each candidate, the session restores to baseline state.
3. **Baseline is captured once** at session construction (daemon start / CLI process start), from the on-disk project.
4. **Sequential by default.** One shared `LanguageService` mutates overlays serially. Optional `parallel: true` fans out to `worker_threads` (one Session per worker) — never concurrent overlays on one service.
5. **Loopback by default.** The reference server binds `127.0.0.1`. Non-loopback hosts are rejected without auth (v1 has no auth).
6. **TypeScript owns parse + types.** veredicto adds post-checker phases (delta, repairs, impact). It does not reimplement the TypeScript frontend.

---

## GET /v1/health

```json
{
  "ok": true,
  "protocolVersion": 1,
  "project": "/abs/path/tsconfig.json",
  "files": 3,
  "baselineErrors": 1
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `ok` | boolean | Always `true` on success |
| `protocolVersion` | number | Wire version (`1`) |
| `project` | string | Absolute path to the loaded tsconfig |
| `files` | number | Root file count in the current program (no overlays) |
| `baselineErrors` | number | Error-category diagnostics at session start |

---

## POST /v1/check

### Request

```json
{
  "fixes": true,
  "impact": true,
  "parallel": false,
  "workers": 2,
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
| `candidates` | yes | array | One or more candidates |
| `candidates[].id` | yes | non-empty string | Client-chosen id, echoed in the result |
| `candidates[].files` | yes | object | Path → full content (`string`) or delete (`null`) |
| `fixes` | no | boolean | Default `false`. Repair actions for new errors (first 3 new errors) |
| `impact` | no | boolean | Default `false`. Semantic impact (export signature + reference fan-out) |
| `parallel` | no | boolean | Default `false`. Use worker_threads (one Session per worker) |
| `workers` | no | positive int | Max workers when `parallel: true` |

**Overlay rules:**

- Path present with a string → replace or create that file for the duration of the check.
- Path present with `null` → file does not exist for the duration of the check.
- Path absent → on-disk content (or absence) is used.
- New `.ts` / `.tsx` / `.mts` / `.cts` paths are added to the program roots.

Body size limit (reference server): 20 MiB.

### Response (`200`)

```json
{
  "protocolVersion": 1,
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
      "fixes": [],
      "impact": {
        "touchedFiles": ["/abs/path/src/report.ts"],
        "changedExports": []
      }
    }
  ]
}
```

When `impact` was not requested, `impact` is `null`.

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
| `impact` | object \| `null` | Semantic impact when `impact: true`, else `null` |

### Diagnostic object

| Field | Type | Meaning |
| --- | --- | --- |
| `code` | string | Stable TypeScript code, e.g. `"TS2322"` |
| `category` | `"error"` \| `"warning"` \| `"suggestion"` \| `"message"` | Maps `ts.DiagnosticCategory` |
| `file` | string | Absolute path, or `"(project)"` for project-level diagnostics |
| `position` | `{ line, col }` \| `null` | 1-based; `null` when no span |
| `length` | number | UTF-16 code unit length of the span (TypeScript convention) |
| `message` | string | Flattened diagnostic message |

### Delta keying (v1 ceiling)

Two diagnostics are the same for delta purposes when
`file + "|" + code + "|" + message` match.

### Repair action object

Returned when `fixes: true`. Built from `getCodeFixesAtPosition` for each of the first 3 new errors.

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
  ],
  "confidence": "high",
  "preconditions": [
    "diagnostic.code === \"TS2322\"",
    "edits.length === 1",
    "span.file === \"/abs/path/src/report.ts\"",
    "span.line === 3",
    "span.col === 14",
    "span.length === 5",
    "fixName === \"fixOverrideModifier\""
  ]
}
```

| Field | Meaning |
| --- | --- |
| `confidence` | `"high"` \| `"medium"` \| `"low"` — heuristic from fixName / multi-file / commands |
| `preconditions` | Strings an agent should treat as checks before applying edits |

Apply `edits` **back-to-front**. Missing suggestions yield empty `fixes` for that diagnostic — the check must not crash.

### Semantic impact object

Returned when `impact: true`. Post-checker phase over TypeScript's type checker + `findReferences` (def–use fan-out). Not a full data-flow solver; export signature diff is the stable core.

```json
{
  "touchedFiles": ["/abs/path/src/math.ts"],
  "changedExports": [
    {
      "file": "/abs/path/src/math.ts",
      "name": "add",
      "kind": "typeChanged",
      "before": "(a: number, b: number) => number",
      "after": "(a: number, b: string) => number",
      "references": [
        {
          "file": "/abs/path/src/report.ts",
          "name": "add",
          "position": { "line": 3, "col": 30 },
          "length": 3
        }
      ]
    }
  ]
}
```

| `kind` | Meaning |
| --- | --- |
| `added` | Export present under overlay, absent at baseline |
| `removed` | Export present at baseline, absent under overlay |
| `typeChanged` | Same export name, different checker `typeToString` |

`references` lists non-definition use sites under the overlay (empty when `kind === "removed"`).

### Errors

| Status | Body | When |
| --- | --- | --- |
| `400` | `{ "error": "<why>" }` | Malformed JSON, bad candidate shape, bad `workers`, body too large |
| `404` | `{ "error": "not found" }` | Unknown path |
| `500` | `{ "error": "<why>" }` | Unexpected server failure |

---

## CLI (same semantics)

```bash
veredicto check --project <tsconfig.json> --candidates <candidates.json> \
  [--fixes] [--impact] [--parallel] [--workers <n>] [--compact]
veredicto serve --project <tsconfig.json> [--port 4117]
```

- `candidates.json` is the `candidates` array (not wrapped).
- `check` exit codes: **0** all pass, **2** at least one fail, **1** usage/crash.
- `--compact` is secondary (token budget); JSON is the contract.
- `serve` binds loopback only.

---

## Library surface (Node)

```ts
import { Session, checkAllParallel } from "veredicto";

const session = new Session("/abs/path/tsconfig.json");
const sequential = session.checkAll(candidates, { withFixes: true, withImpact: true });
const parallel = await checkAllParallel("/abs/path/tsconfig.json", candidates, {
  withFixes: true,
  withImpact: true,
  workers: 2,
});
```

---

## Versioning

- `protocolVersion: 1` and path `/v1/` share semantics.
- Breaking changes require `/v2/` and a major package version.
- Additive optional fields are allowed; clients should ignore unknown fields.

---

## Out of scope for this protocol revision

- Unified-diff / patch input (full-file contents only)
- Full intra-procedural reaching-definitions solver (export + references is the v0.2 impact core)
- Authentication / non-loopback binding
- Non-TypeScript checkers
- Guaranteeing a code fix for every new error
