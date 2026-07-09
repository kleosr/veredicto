#!/usr/bin/env node
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { readFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { parseArgs } from "node:util";
import { checkAllParallel } from "./parallel.js";
import { createServer } from "./server.js";
import { Session } from "./session.js";
import { renderCompact, validateCandidates } from "./verdict.js";

const USAGE = `veredicto — agent-native TypeScript checker

usage:
  veredicto check --project <tsconfig.json> --candidates <candidates.json> [options]
  veredicto serve --project <tsconfig.json> [--port <n>]

check options:
  --fixes       include TypeScript code-fix repair actions
  --impact      include semantic impact (export signature + reference fan-out)
  --parallel    check candidates in worker_threads (one Session per worker)
  --workers <n> max parallel workers (with --parallel)
  --compact     token-budget text output

candidates.json shape:
  [{ "id": "patch-a", "files": { "src/x.ts": "<full new content>", "src/gone.ts": null } }]

exit codes for check: 0 all candidates pass, 2 at least one fails, 1 usage or crash.
serve always binds 127.0.0.1 (no auth in v1).
`;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check") {
    return runCheck(rest);
  }
  if (command === "serve") {
    return runServe(rest);
  }
  process.stderr.write(USAGE);
  return command === undefined || command === "--help" || command === "-h" ? 0 : 1;
}

async function runCheck(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      candidates: { type: "string" },
      fixes: { type: "boolean", default: false },
      impact: { type: "boolean", default: false },
      parallel: { type: "boolean", default: false },
      workers: { type: "string" },
      compact: { type: "boolean", default: false },
    },
  });
  if (values.project === undefined || values.candidates === undefined) {
    process.stderr.write(USAGE);
    return 1;
  }
  const raw: unknown = JSON.parse(readFileSync(values.candidates, "utf8"));
  const candidates = validateCandidates(raw);
  const options = {
    withFixes: values.fixes === true,
    withImpact: values.impact === true,
  };
  let workers: number | undefined;
  if (values.workers !== undefined) {
    workers = Number(values.workers);
    if (!Number.isInteger(workers) || workers < 1) {
      process.stderr.write(`invalid --workers: ${values.workers}\n`);
      return 1;
    }
  }
  const response =
    values.parallel === true
      ? await checkAllParallel(values.project, candidates, { ...options, workers })
      : new Session(values.project).checkAll(candidates, options);
  if (values.compact === true) {
    const lines = response.results.map(renderCompact).join("\n");
    process.stdout.write(`baseline errors=${response.baseline.errorCount}\n${lines}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  }
  return response.results.every((result) => result.verdict === "pass") ? 0 : 2;
}

function runServe(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      port: { type: "string", default: "4117" },
      host: { type: "string", default: "127.0.0.1" },
    },
  });
  if (values.project === undefined) {
    process.stderr.write(USAGE);
    return 1;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`invalid port: ${String(values.port)}\n`);
    return 1;
  }
  const host = values.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) {
    process.stderr.write(
      `refusing non-loopback host ${JSON.stringify(host)} (v1 has no auth; use 127.0.0.1)\n`,
    );
    return 1;
  }
  const session = new Session(values.project);
  const server = createServer(session);
  server.listen(port, host, () => {
    process.stdout.write(
      `veredicto listening on http://${host}:${port} project=${session.project} files=${session.fileCount()} baselineErrors=${session.baselineErrorCount()}\n`,
    );
  });
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
