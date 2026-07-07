# veredicto

Verdicts, not prose. An agent-native TypeScript checker: batch-verify candidate patches against a live project session and get structured JSON back — new errors, fixed errors, repair actions — instead of error text written for a human squinting at a terminal.

## Why this exists

Every serious coding agent runs the same loop: write a patch, run the checker, parse prose-shaped errors, guess a fix, repeat. Two things are broken in that loop. The checker restarts from zero on every attempt, and its output format was designed for people, not programs.

The industry noticed in 2026. Vercel Labs shipped Zero in May — a brand-new systems language whose compiler emits structured JSON with stable error codes and typed repair IDs. Right interface, wrong side of the adoption valley: nobody's codebase is written in Zero. Researchers made the same point from the other end — compiler feedback quality is a fundamental bottleneck for coding agents (arXiv 2604.13927).

veredicto takes the agent-first interface to the language agents already write all day. Point it at your `tsconfig.json`, keep a warm session, and throw N candidate patches at it. Each candidate is judged against the project baseline: pass if it introduces no new errors, fail with structured diagnostics plus TypeScript's own code-fix suggestions mapped to precise, editable spans.

## What it does

- Holds one live TypeScript language service over your real project. Your `tsconfig.json` is respected, not approximated.
- Accepts candidates as in-memory file overlays: replace a file, add a new one, or delete one (`null`). Disk is never touched.
- Computes the delta against the baseline: `newErrors`, `fixedErrors`, `totalErrors`. Pre-existing debt does not fail your patch; only regressions do.
- Catches cross-file damage: patch `math.ts`, and the break it causes in `report.ts` shows up in the verdict.
- Returns TypeScript code fixes for new errors as structured repair actions (`file`, `position`, `length`, `newText`).
- Speaks HTTP (`POST /v1/check`, `GET /v1/health`) and CLI, with agent-friendly exit codes: 0 all pass, 2 any fail, 1 usage or crash.
- Has a `--compact` mode when tokens are the budget.

## Quickstart

```bash
npm install
npm run build

# daemon mode
node dist/cli.js serve --project path/to/tsconfig.json --port 4117
curl -s localhost:4117/v1/check -d '{
  "fixes": true,
  "candidates": [
    { "id": "patch-a", "files": { "src/report.ts": "import { add } from \"./math.js\";\n\nexport const total: number = add(1, 2);\n" } }
  ]
}'

# one-shot mode
node dist/cli.js check --project path/to/tsconfig.json --candidates candidates.json --compact
```

Try it against the bundled fixture first: `--project test/fixture/tsconfig.json`. The fixture ships with one deliberate baseline error so you can watch `fixedErrors` move.

## Verdict semantics

`pass` means the candidate introduces zero new errors relative to the baseline captured at session start. That is a deliberate choice: an agent fixing one function in a repo with 400 legacy errors should not drown in them, and it should not get credit for them either. `fixedErrors` tells you when a patch actually paid down debt. `totalErrors` never lies about the whole picture.

## Numbers

Measured in a slow build container on the bundled 3-file fixture, 5 runs each:

| what | cost |
| --- | --- |
| cold `tsc --noEmit`, per candidate | ~6,640 ms |
| veredicto session init (incl. baseline check), once | ~2,090 ms |
| veredicto warm check, per candidate | ~34.9 ms |

That is a ~190x per-candidate speedup after init — on a toy project, so read it narrowly. The honest claim: you stop paying process startup and full re-parse on every attempt. On a large repo, init costs more and warm checks scale with what actually changed. Run `npm run bench` on your own machine before quoting numbers.

## Limits (v0.1, on purpose)

Candidates are full-file contents, not diffs. The delta is keyed by file + code + message, so two byte-identical errors in one file collapse into one. One process, candidates checked sequentially. No auth — it binds `127.0.0.1` and should stay there.

## Roadmap

Unified-diff input. Parallel candidate workers. A tsgo backend when Microsoft's native port stabilizes. npm publish.

## Development

```bash
npm test          # build + node:test suite (core + HTTP)
npm run bench     # cold tsc vs warm session, real numbers
npm run lint      # Biome, every rule on, nursery included, must exit 0
npm run semgrep   # full open-registry stack, must exit 0
```

Protocol details live in [docs/PROTOCOL.md](docs/PROTOCOL.md). Scope and done-criteria live in [GOAL.md](GOAL.md).

## Prior art

Vercel Labs' Zero (May 2026) proved agent-first compiler output — for a new language. Cursor's shadow workspace pioneered background language-server checks inside one editor. ai-typescript-check did single-snippet TwoSlash checks in the ChatGPT-plugin era. veredicto is the neutral, project-scale piece: any agent, over the TypeScript you already have.

## License

MIT.
