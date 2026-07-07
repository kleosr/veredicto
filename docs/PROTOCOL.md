# veredicto protocol v1

Everything is JSON. Positions are 1-based. Paths in requests may be project-relative (resolved against the tsconfig directory) or absolute.

## POST /v1/check

Request:

```json
{
  "fixes": true,
  "candidates": [
    { "id": "patch-a", "files": { "src/report.ts": "<full new file content>" } },
    { "id": "delete-x", "files": { "src/x.ts": null } }
  ]
}
```

`files` maps a path to the candidate's full content for that file. `null` deletes the file for the duration of the check. New paths are added to the program. `fixes` (optional, default `false`) requests TypeScript code-fix suggestions for new errors, capped at the first 3 new errors per candidate.

Response:

```json
{
  "project": "/abs/path/tsconfig.json",
  "baseline": { "errorCount": 1 },
  "results": [
    {
      "id": "patch-a",
      "verdict": "pass",
      "summary": { "newErrors": 0, "fixedErrors": 1, "totalErrors": 0, "checkedMs": 34 },
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

Field semantics:

- `verdict` is `pass` when the candidate introduces zero new error-category diagnostics relative to the baseline, `fail` otherwise. Warnings and suggestions are reported but never fail a candidate.
- `newDiagnostics` / `fixedDiagnostics` are the delta against the baseline, any category. `summary` counts errors only.
- A diagnostic's `position` is `null` for project-level diagnostics (file `"(project)"`).
- A repair action: `{ "forCode", "file", "fixName", "description", "edits": [{ "file", "position", "length", "newText" }] }`. Apply edits back-to-front to keep offsets valid.

Errors: malformed body or candidate shape returns `400 { "error": "<why>" }`; anything else unexpected returns `500`.

## GET /v1/health

```json
{ "ok": true, "project": "/abs/path/tsconfig.json", "files": 3, "baselineErrors": 1 }
```

## CLI

```bash
veredicto check --project <tsconfig.json> --candidates <candidates.json> [--fixes] [--compact]
veredicto serve --project <tsconfig.json> [--port 4117] [--host 127.0.0.1]
```

`candidates.json` holds the same array as the `candidates` field above. `check` exit codes: 0 all candidates pass, 2 at least one fails, 1 usage error or crash. `--compact` prints one header line per candidate plus `+`/`-` lines per changed diagnostic — for agents on a token budget.
