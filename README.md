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
npm install -g veredicto
# or: npx veredicto …

# daemon mode
veredicto serve --project path/to/tsconfig.json --port 4117
curl -s localhost:4117/v1/check -d '{
  "fixes": true,
  "candidates": [
    { "id": "patch-a", "files": { "src/report.ts": "import { add } from \"./math.js\";\n\nexport const total: number = add(1, 2);\n" } }
  ]
}'

# one-shot mode
veredicto check --project path/to/tsconfig.json --candidates candidates.json --compact
```

From a clone, the same entry points are `npm run build` then `node dist/cli.js …`. Against the bundled fixture (`--project test/fixture/tsconfig.json`) you can watch `fixedErrors` move — the fixture ships with one deliberate baseline error.

## Verdict semantics

`pass` means the candidate introduces zero new errors relative to the baseline captured at session start. That is a deliberate choice: an agent fixing one function in a repo with 400 legacy errors should not drown in them, and it should not get credit for them either. `fixedErrors` tells you when a patch actually paid down debt. `totalErrors` never lies about the whole picture.

## Numbers

Measured locally; full tables and methodology in [docs/BENCH.md](docs/BENCH.md):

| project | cold `tsc` / candidate | init (once) | warm / candidate | speedup |
| --- | --- | --- | --- | --- |
| Bundled fixture (2 files) | ~1,018 ms | ~384 ms | ~8.5 ms | ~119× |
| Synthetic 200-module project | ~424 ms | ~492 ms | ~110 ms | ~4× |

The honest claim: you stop paying process startup and full re-parse on every attempt. Init costs more on large repos; warm checks scale with what changed. Run your own:

```bash
npm run bench                              # fixture
npm run bench:large                        # generate 200 modules + bench
npm run bench -- --project path/to/tsconfig.json
```

## Limits (v0.1, on purpose)

Candidates are full-file contents, not diffs. The delta is keyed by file + code + message, so two byte-identical errors in one file collapse into one. One process, candidates checked sequentially. No auth — serve binds loopback only and refuses anything else.

## Roadmap

Unified-diff input. Parallel candidate workers. A tsgo backend when Microsoft's native port stabilizes. Same protocol over other checkers.

## Development

```bash
npm install
npm run build
npm test              # build + node:test suite (core + HTTP)
npm run bench         # cold tsc vs warm session (fixture)
npm run bench:large   # synthetic 200-module project
npm run example:agent # drop-in agent loop against the fixture
npm run lint          # Biome, every rule on, nursery included, must exit 0
npm run semgrep       # full open-registry stack, must exit 0
```

## Docs

| Doc | What |
| --- | --- |
| [PITCH.md](PITCH.md) | Full thesis — problem, insight, risks, ask |
| [ANNOUNCE.md](ANNOUNCE.md) | Short public announcement draft |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | Wire contract (HTTP + CLI + library) |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | Agent / CI integration recipe |
| [docs/BENCH.md](docs/BENCH.md) | Measured numbers + how to reproduce |
| [GOAL.md](GOAL.md) | Scope and done-criteria |
| [DEBT.md](DEBT.md) | Open debt |

## Prior art

Vercel Labs' Zero (May 2026) proved agent-first compiler output — for a new language. Cursor's shadow workspace pioneered background language-server checks inside one editor. ai-typescript-check did single-snippet TwoSlash checks in the ChatGPT-plugin era. veredicto is the neutral, project-scale piece: any agent, over the TypeScript you already have.

## License

MIT.
