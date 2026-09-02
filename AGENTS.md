# AGENTS.md — veredicto agent handbook

Repo-owned instructions for coding agents working on `veredicto`.

## Rules

- Node & TypeScript: Node >=18.17 (CI tests Node 22). TypeScript with target `ES2022`, module `NodeNext`, resolution `NodeNext`. Build via `npm run build` (`tsc -p .`). Output in `dist/`.
- No product rewrites: veredicto is not a TypeScript compiler frontend. Microsoft owns parsing, binding, and type-checking via `ts.createLanguageService`; veredicto owns post-type-checking phases (delta, repairs, impact, worker fan-out). Never reimplement compiler frontend phases.
- Disk isolation: checks evaluate in-memory file overlays. Never write patches directly to project disk during check evaluations; disk is touched only when the caller flushes.
- Delta semantics: `verdict: "pass"` means candidate introduces zero new error diagnostics relative to the baseline. Warnings and pre-existing baseline errors do not fail candidates.
- Network & security: daemon server binds loopback only (`127.0.0.1`, `localhost`, `::1`). Refuse all non-loopback binds. Protocol v1 has no authentication.
- Code quality & formatting: Biome format and lint must exit 0 (`npm run lint`). Semgrep security audit must exit 0 (`npm run semgrep`). Keep functions within complexity constraints.
- Test coverage: native `node:test` runner. All tests in `test/**/*.test.mjs` must pass.
- Protocol stability: protocol v1 wire format changes must be backwards-compatible; additive fields are allowed, breaking meaning changes require bump to v2.

## Skills

Reusable task recipes belong in `.agents/skills`. This repository currently has no pre-existing `.agents/skills` recipes, so the directory is not created. Agents should follow standard workflows below.

## Workflows

### 1. Build and Test
```bash
npm run build      # tsc -p . -> dist/
npm test           # npm run build && node --test 'test/**/*.test.mjs'
```

### 2. Linting and Static Analysis
```bash
npm run lint       # biome ci . (checks formatting and lint rules)
npm run lint:fix   # biome check --write .
npm run semgrep    # bash scripts/semgrep-max.sh
```

### 3. Benchmarks and Verification
```bash
npm run bench:compare        # before/after agent loop comparison on test/fixture
npm run bench:compare:large  # before/after on synthetic layered ~92-file app
npm run bench                # cold tsc vs warm overlay microbench
npm run example:agent        # drop-in agent loop demonstration against test/fixture
```

### 4. Running Daemon and CLI
```bash
node dist/cli.js check --project test/fixture/tsconfig.json --candidates candidates.json [--fixes] [--impact] [--parallel] [--compact]
node dist/cli.js serve --project test/fixture/tsconfig.json --port 4117
```

## Memory

All versioned project memory, architecture contracts, and roadmaps are maintained as versioned markdown under `docs/` and root documentation:
- Architecture & post-checker phases: `docs/ARCHITECTURE.md`
- Protocol wire contract & JSON schema: `docs/PROTOCOL.md`, `docs/veredicto.schema.json`
- Agent loop integration guide: `docs/INTEGRATION.md`
- Benchmark numbers & reproduction: `docs/BENCH.md`
- Scope, done-criteria, and fences: `GOAL.md`
- Technical debt & deferred work: `DEBT.md`
- Full thesis & motivation: `PITCH.md`, `ANNOUNCE.md`
