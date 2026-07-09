#!/usr/bin/env node
/**
 * Cold tsc --noEmit vs warm veredicto session.
 *
 * Usage:
 *   node bench/bench.mjs
 *   node bench/bench.mjs --project path/to/tsconfig.json
 *   node bench/bench.mjs --project path/to/tsconfig.json --runs 5 --file src/x.ts
 *
 * Without --project, benches the bundled fixture.
 */
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { spawnSync } from "node:child_process";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { existsSync, readFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import path from "node:path";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { fileURLToPath } from "node:url";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { parseArgs } from "node:util";
// biome-ignore lint/nursery/useImportRestrictions: benches exercise the built public artifact in dist.
import { Session } from "../dist/session.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_CONFIG = fileURLToPath(new URL("../test/fixture/tsconfig.json", import.meta.url));
const TSC = fileURLToPath(new URL("../node_modules/typescript/lib/tsc.js", import.meta.url));
const CHECKABLE_FILE = /\.(?:ts|tsx|mts|cts)$/;
const TRAILING_WHITESPACE = /\s*$/;

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    runs: { type: "string", default: "5" },
    file: { type: "string" },
  },
});

const RUNS = Number(values.runs);
if (!Number.isInteger(RUNS) || RUNS < 1) {
  process.stderr.write(`--runs must be a positive integer, got ${String(values.runs)}\n`);
  process.exit(1);
}

const configPath = path.resolve(values.project ?? DEFAULT_CONFIG);
const projectDir = path.dirname(configPath);

function average(samples) {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function coldRunMs() {
  const startedAt = performance.now();
  spawnSync(process.execPath, [TSC, "-p", projectDir, "--noEmit"], { encoding: "utf8" });
  return performance.now() - startedAt;
}

function pickPatchFile(session) {
  if (values.file !== undefined) {
    return values.file.replaceAll("\\", "/");
  }
  const fromBaseline = session.baseline.find(
    (diagnostic) => diagnostic.file !== "(project)" && CHECKABLE_FILE.test(diagnostic.file),
  );
  if (fromBaseline !== undefined) {
    return path.relative(projectDir, fromBaseline.file).replaceAll("\\", "/");
  }
  for (const guess of ["src/entry.ts", "src/report.ts", "src/index.ts", "index.ts"]) {
    if (existsSync(path.join(projectDir, guess))) {
      return guess;
    }
  }
  process.stderr.write("could not pick a file to patch; pass --file <project-relative-path>\n");
  process.exit(1);
}

const initStart = performance.now();
const session = new Session(configPath);
const initMs = performance.now() - initStart;

const patchRelative = pickPatchFile(session);
const absolutePatch = path.resolve(projectDir, patchRelative);
let originalText;
try {
  originalText = readFileSync(absolutePatch, "utf8");
} catch {
  process.stderr.write(`could not read patch file: ${absolutePatch}\n`);
  process.exit(1);
}

const CANDIDATES = Array.from({ length: RUNS }, (_, index) => ({
  id: `candidate-${index}`,
  files: {
    [patchRelative]: `${originalText.replace(TRAILING_WHITESPACE, "")}\n// veredicto-bench ${index}\n`,
  },
}));

const cold = [];
for (let index = 0; index < RUNS; index += 1) {
  cold.push(coldRunMs());
}

const warm = CANDIDATES.map((candidate) => {
  const startedAt = performance.now();
  session.checkCandidate(candidate);
  return performance.now() - startedAt;
});

const coldAvg = average(cold);
const warmAvg = average(warm);
const speedup = warmAvg > 0 ? coldAvg / warmAvg : Number.POSITIVE_INFINITY;

process.stdout.write(
  [
    `project: ${configPath}`,
    `patch file: ${patchRelative}`,
    `root files: ${session.fileCount()}`,
    `baseline errors: ${session.baselineErrorCount()}`,
    `cold "tsc --noEmit" x${RUNS}: avg ${coldAvg.toFixed(0)} ms per candidate`,
    `veredicto session init incl. baseline check: ${initMs.toFixed(0)} ms, once`,
    `veredicto warm check x${RUNS}: avg ${warmAvg.toFixed(1)} ms per candidate`,
    `per-candidate speedup after init: ${speedup.toFixed(0)}x`,
    `cwd-relative root: ${path.relative(ROOT, projectDir) || "."}`,
    "",
  ].join("\n"),
);
