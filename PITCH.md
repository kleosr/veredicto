# veredicto: the pitch

## One sentence

AI agents already write an enormous share of the world's new TypeScript, and the toolchain still answers them in prose designed for a human at a terminal. veredicto is the agent-native front door to the typechecker: throw N candidate patches at a live project session and get structured verdicts back — pass or fail, what broke, what got fixed, how to repair it — in milliseconds instead of seconds.

## The problem, precisely

Every serious coding agent runs the same loop: write a patch, run the checker, interpret the error, retry. The loop is broken in two independent places.

**Cost.** Every attempt pays full process startup. A cold `tsc --noEmit` costs hundreds of milliseconds to seconds per candidate — measured at ~1.0 s on the bundled fixture and ~0.4 s on a 200-file synthetic project on a warm local machine (slower containers see multi-second cold starts; see [docs/BENCH.md](docs/BENCH.md)). An agent exploring ten variants of one fix pays ten startups for information a warm session serves in milliseconds to low hundreds of milliseconds.

**Format.** The output is text for humans. The agent burns tokens parsing prose, then guesses. This is not a vibe — [arXiv 2604.13927](https://arxiv.org/abs/2604.13927) (*AI Coding Agents Need Better Compiler Remarks*, Deo / Campanoni / McMichen, April 2026) measures compiler feedback as a fundamental bottleneck for coding agents and calls for a co-designed interface. Precise structured remarks raised success 3.3×; ambiguous remarks actively caused semantic-breaking hallucinations. The bottleneck is the interface, not the agent.

## Why now

Three signals landed within six months.

1. **December 2025.** Claude Code ships native LSP support and OpenCode bundles 30+ language servers — agents now consume diagnostics, but diagnostics built for human IDEs.
2. **April 2026.** The paper above: structured, actionable compiler feedback is the missing piece.
3. **May 2026.** [Vercel Labs ships Zero](https://github.com/vercel-labs/zero) — an experimental systems language whose compiler emits structured JSON with stable error codes and typed repair IDs. Demand validated, with Vercel's money behind it.

The window is open. The correct position in it is still empty.

## The insight nobody is executing

Zero chose the hard road: a new interface *and* a new language. A new language drags a decade of adoption valley behind it — nobody's codebase is written in Zero, so its beautiful diagnostics judge code that does not exist yet.

The obvious inversion nobody made: keep the language agents already write, change only the interface. Don't ask the world to migrate. Hand the world that already exists the piece it is missing.

veredicto is Zero's compiler interface, pointed at the code you already have.

## What it is

A daemon + CLI holding one warm TypeScript language service over your real project — your `tsconfig`, not an approximation of it. Candidates arrive as in-memory overlays (replace, create, or delete files; disk is never touched), and each is judged against the baseline captured at session start:

- `newErrors` / `fixedErrors` / `totalErrors`
- diagnostics with stable `TSxxxx` codes and exact 1-based positions
- TypeScript's own code fixes translated into applicable repair actions (`file`, `position`, `length`, `newText`)

It catches cross-file damage: patch `math.ts`, and the break it causes in `report.ts` lands in the verdict. HTTP and CLI. Exit codes an agent reads without parsing: 0 pass, 2 fail, 1 usage/crash. A `--compact` mode for when tokens are the budget.

Wire format: [docs/PROTOCOL.md](docs/PROTOCOL.md). Drop-in agent loop: [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Three design decisions are the thesis

**1. Delta verdicts, not absolute.** `pass` means zero *new* errors. A legacy repo with 400 pre-existing errors doesn't drown the agent fixing one function — and the agent doesn't take credit for debt it didn't pay. `fixedErrors` measures real cleanup. `totalErrors` never lies about the whole picture.

**2. One warm session across candidates.** Incremental analysis is the product. On the bundled fixture: ~119× per candidate after init (~8.5 ms warm vs ~1.0 s cold). On a 200-file synthetic project: ~4× (~110 ms warm vs ~424 ms cold) with init paid once — see [docs/BENCH.md](docs/BENCH.md). Init costs more on large repos; warm checks scale with what changed. Quote your own `--project` numbers, not these.

**3. Neutrality.** No editor, no vendor, JSON over loopback. It serves Claude Code, OpenCode, a CI runner, or an eval pipeline with exactly the same face. Neutrality isn't modesty; it's the protocol position.

## How it spreads

The esbuild playbook: open-source core, win one brutal measurable dimension (latency + tokens), enter where agent builders already live.

**First users:** agent framework authors, CLI agents, CI pipelines that run agents, eval teams judging thousands of patches an hour.

**Later:** parallel workers, a hosted tier, the same protocol over Python and other checkers.

## What it competes with — and doesn't

Cursor solved this at the editor layer: the shadow workspace ran stock language servers in a hidden window, the team explicitly rejected forking language servers or spawning their own `tsc`, and the feature has since quietly disappeared from settings. veredicto lives one layer down and is complementary — an editor could consume it.

The rest of prior art does not occupy the position:

- **ai-typescript-check** — snippet-scale, ChatGPT-plugin era
- **LSP-inside-agents** — human-format diagnostics for IDE UX
- **Zero** — right interface, wrong language (adoption valley)

Nobody owns the project-scale, agent-native checker for an existing mainstream language. That is the position.

## Where it goes

| Horizon | What |
| --- | --- |
| **v0.2** | Unified-diff input, parallel candidate workers, span-anchored deltas |
| **Next** | tsgo backend when Microsoft's native port stabilizes — its ~10× speed multiplies the warm check; its output is still prose, so the verdict layer stays necessary |
| **Big play** | Same protocol over Python and other checkers. If the verdict format becomes what agents *expect* from any typechecker, this stops being a tool and becomes a standard |

That is the only honest version of "changing the world": not the repo — the protocol.

## Risks, plainly

| Risk | Mitigation |
| --- | --- |
| Microsoft adds JSON diagnostics to tsgo tomorrow | Sessions, batching, and delta semantics run *on top of* any checker, tsgo included |
| A large player absorbs the idea | Speed-to-community + neutrality no editor can offer |
| Toy-only benchmarks | Large synthetic bench shipped; bring your own repo via `npm run bench -- --project path/to/tsconfig.json` |
| Employment / IP constraints (e.g. Anysphere or similar) | Read your contract before a public push. 20 minutes. Non-negotiable if it applies |

## Why this, why now, why ship

The artifact already exists: built, tested (9/9), gated (Biome every rule including nursery, semgrep open-registry stack, both exit 0), published (`veredicto@0.1.0` on npm), CI green on `main`. Most ideas never clear that bar. The novelty that sells is the interface, not a new typechecker — TypeScript already did the hard analysis work. The remaining work is adoption: first three external consumers of the protocol.

## The ask

If you build agents: wire `POST /v1/check` into your retry loop ([docs/INTEGRATION.md](docs/INTEGRATION.md)) and report what happened to tokens-per-fix.

If you own a big TypeScript repo: run `npm run bench -- --project path/to/tsconfig.json` and open an issue with init + warm numbers.

If the protocol shape is wrong for your loop: open an issue shaped like your loop.

## Links

- Product surface: [README.md](README.md)
- Wire contract: [docs/PROTOCOL.md](docs/PROTOCOL.md)
- Agent integration: [docs/INTEGRATION.md](docs/INTEGRATION.md)
- Measured numbers: [docs/BENCH.md](docs/BENCH.md)
- Announcement draft: [ANNOUNCE.md](ANNOUNCE.md)
- Scope / done criteria: [GOAL.md](GOAL.md)
- Open debt: [DEBT.md](DEBT.md)
- Package: https://www.npmjs.com/package/veredicto
- Source: https://github.com/kleosr/veredicto
