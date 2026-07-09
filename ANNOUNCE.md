# Announcing veredicto — structured TypeScript verdicts for coding agents

*Draft. Paste into a blog, HN, Discord, or X thread. Edit the first line to match the channel.*

---

AI agents write a huge share of new TypeScript. The typechecker still answers them in prose meant for a human staring at a terminal.

**veredicto** is a small open-source daemon + CLI that keeps a warm TypeScript language service over your real project and batch-checks candidate patches as in-memory overlays. You get structured JSON back: pass/fail relative to baseline, what broke, what got fixed, TypeScript code fixes with confidence/preconditions, and optional semantic impact (export signature + reference fan-out) — in tens of milliseconds after init, not seconds of cold `tsc` per attempt.

```bash
npm install -g veredicto
veredicto serve --project ./tsconfig.json --port 4117
```

```bash
curl -s localhost:4117/v1/check -d '{
  "fixes": true,
  "candidates": [
    { "id": "patch-a", "files": { "src/report.ts": "…" } }
  ]
}'
```

### Why this exists

Every agent loop is the same: patch → checker → parse error → retry. Two things are broken.

1. **Cost.** Cold `tsc --noEmit` restarts from zero every time. Honest before/after agent loop (write disk → spawn tsc → restore vs warm Session): on a 92-file layered app with 20 candidates, **~7.5 s → ~1.3 s (~5.9× full-loop)**; fixture 10 candidates ~22×. See [docs/BENCH.md](docs/BENCH.md).
2. **Format.** Prose diagnostics burn tokens and force guessing. [arXiv 2604.13927](https://arxiv.org/abs/2604.13927) calls compiler feedback a fundamental bottleneck and asks for a co-designed interface. Vercel Labs' [Zero](https://github.com/vercel-labs/zero) (May 2026) proved the agent-first JSON shape — for a brand-new language. veredicto brings that interface to the TypeScript you already have.

### The three decisions

- **Delta, not absolute.** `pass` = zero *new* errors. Legacy debt doesn't drown the agent; `fixedErrors` measures real cleanup.
- **One warm session.** Incremental analysis is the product.
- **Neutral protocol.** No editor lock-in. HTTP + CLI over loopback. Same face for Claude Code, OpenCode, CI, or evals.

### Honest limits (v0.1)

Full-file candidates (not diffs yet). Sequential checks. Delta keyed by file+code+message. Loopback only, no auth. Toy and synthetic benches shipped — run `npm run bench -- --project your/tsconfig.json` on a real repo and tell us the numbers.

### Links

- Pitch (full thesis): https://github.com/kleosr/veredicto/blob/main/PITCH.md
- Protocol: https://github.com/kleosr/veredicto/blob/main/docs/PROTOCOL.md
- Integration recipe: https://github.com/kleosr/veredicto/blob/main/docs/INTEGRATION.md
- npm: `npm install -g veredicto`
- Repo: https://github.com/kleosr/veredicto

If you build agents: wire `POST /v1/check` into your retry loop and open an issue with what broke in the shape. That's the ask.
