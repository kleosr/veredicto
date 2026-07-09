#!/usr/bin/env node
/**
 * Before/after agent-loop benchmark.
 *
 * BEFORE (legacy agent loop):
 *   for each candidate: write overlays to disk → spawn tsc --noEmit → restore disk
 *
 * AFTER (veredicto):
 *   Session init once → warm sequential overlays (no disk)
 *   optional: parallel workers (one Session per worker)
 *
 * Candidates are realistic agent attempts: fix, regression, neutrals, signature break.
 *
 * Usage:
 *   node bench/compare.mjs
 *   node bench/compare.mjs --project bench/large/tsconfig.json --candidates 10
 */
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { spawnSync } from "node:child_process";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import path from "node:path";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { fileURLToPath } from "node:url";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { parseArgs } from "node:util";
// biome-ignore lint/nursery/useImportRestrictions: benches exercise the built public artifact in dist.
import { checkAllParallel } from "../dist/parallel.js";
// biome-ignore lint/nursery/useImportRestrictions: benches exercise the built public artifact in dist.
import { Session } from "../dist/session.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_CONFIG = fileURLToPath(new URL("../test/fixture/tsconfig.json", import.meta.url));
const TSC = fileURLToPath(new URL("../node_modules/typescript/lib/tsc.js", import.meta.url));
const TRAILING_WHITESPACE = /\s*$/;
const TS_FILE = /\.ts$/;

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    candidates: { type: "string", default: "10" },
    workers: { type: "string", default: "2" },
    skipParallel: { type: "boolean", default: false },
  },
});

const CANDIDATE_COUNT = Number(values.candidates);
const WORKERS = Number(values.workers);
if (!Number.isInteger(CANDIDATE_COUNT) || CANDIDATE_COUNT < 2) {
  process.stderr.write("--candidates must be an integer >= 2\n");
  process.exit(1);
}
if (!Number.isInteger(WORKERS) || WORKERS < 1) {
  process.stderr.write("--workers must be a positive integer\n");
  process.exit(1);
}

const configPath = path.resolve(values.project ?? DEFAULT_CONFIG);
const projectDir = path.dirname(configPath);

function avg(samples) {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function sum(samples) {
  return samples.reduce((total, value) => total + value, 0);
}

function readProjectFile(relativePath) {
  return readFileSync(path.join(projectDir, relativePath), "utf8");
}

function detectShape() {
  const hasApp = existsSync(path.join(projectDir, "src/app.ts"));
  const hasUtil = existsSync(path.join(projectDir, "src/core/util000.ts"));
  const hasMath = existsSync(path.join(projectDir, "src/math.ts"));
  const hasReport = existsSync(path.join(projectDir, "src/report.ts"));
  if (hasApp && hasUtil && hasReport) {
    return "layered";
  }
  if (hasMath && hasReport) {
    return "fixture";
  }
  return "generic";
}

function buildCandidates(shape) {
  /** @type {{ id: string, files: Record<string, string|null>, kind: string }[]} */
  const list = [];

  if (shape === "layered") {
    const app = readProjectFile("src/app.ts");
    const util = readProjectFile("src/core/util000.ts");
    const report = readProjectFile("src/report.ts");
    const fixedApp = app.replace(
      "export const answer: string = boot(1);",
      "export const answer: number = boot(1);",
    );
    const brokenUtil = util
      .replace(
        "export function util000(n: number): number",
        "export function util000(n: string): number",
      )
      .replace("return n * 1 + 0;", "return Number(n) * 1 + 0;");
    const neutralReport = `${report.replace(TRAILING_WHITESPACE, "")}\nexport const touched = true;\n`;

    list.push({ id: "fix-baseline", kind: "fix", files: { "src/app.ts": fixedApp } });
    list.push({
      id: "break-core-signature",
      kind: "regression",
      files: { "src/core/util000.ts": brokenUtil },
    });
    list.push({ id: "neutral-report", kind: "neutral", files: { "src/report.ts": neutralReport } });

    const routeDir = path.join(projectDir, "src/routes");
    const routeFiles = existsSync(routeDir)
      ? readdirSync(routeDir)
          .filter((name) => TS_FILE.test(name))
          .sort()
      : [];
    for (let index = 0; index < CANDIDATE_COUNT - 3; index += 1) {
      if (routeFiles.length === 0) {
        list.push({
          id: `neutral-app-${index}`,
          kind: "neutral",
          files: { "src/app.ts": `${fixedApp}\n// attempt ${index}\n` },
        });
        continue;
      }
      const routeRel = `src/routes/${routeFiles[index % routeFiles.length]}`;
      const original = readProjectFile(routeRel);
      list.push({
        id: `neutral-route-${index}`,
        kind: "neutral",
        files: {
          [routeRel]: `${original.replace(TRAILING_WHITESPACE, "")}\n// agent attempt ${index}\n`,
        },
      });
    }
    return list.slice(0, CANDIDATE_COUNT);
  }

  if (shape === "fixture") {
    const math = readProjectFile("src/math.ts");
    const report = readProjectFile("src/report.ts");
    list.push({
      id: "fix-baseline",
      kind: "fix",
      files: {
        "src/report.ts":
          'import { add } from "./math.js";\n\nexport const total: number = add(1, 2);\n',
      },
    });
    list.push({
      id: "break-math",
      kind: "regression",
      files: {
        "src/math.ts":
          "export function add(a: number, b: string): number {\n  return a + Number(b);\n}\n",
      },
    });
    list.push({
      id: "neutral-math",
      kind: "neutral",
      files: {
        "src/math.ts": `${math.replace(TRAILING_WHITESPACE, "")}\nexport const touched = true;\n`,
      },
    });
    for (let index = 0; index < CANDIDATE_COUNT - 3; index += 1) {
      list.push({
        id: `neutral-report-${index}`,
        kind: "neutral",
        files: {
          "src/report.ts": `${report.replace(TRAILING_WHITESPACE, "")}\n// attempt ${index}\n`,
        },
      });
    }
    return list.slice(0, CANDIDATE_COUNT);
  }

  process.stderr.write(
    "unsupported project shape for compare bench; use fixture or bench/generate-large.mjs output\n",
  );
  process.exit(1);
}

function coldTscWithDisk(candidate) {
  /** @type {{ relative: string, previous: string|null }[]} */
  const backups = [];
  for (const [relative, content] of Object.entries(candidate.files)) {
    const absolute = path.join(projectDir, relative);
    const previous = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
    backups.push({ relative, previous });
    if (content === null) {
      continue;
    }
    writeFileSync(absolute, content);
  }
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [TSC, "-p", projectDir, "--noEmit"], {
    encoding: "utf8",
  });
  const elapsed = performance.now() - startedAt;
  for (const backup of backups) {
    const absolute = path.join(projectDir, backup.relative);
    if (backup.previous === null) {
      continue;
    }
    writeFileSync(absolute, backup.previous);
  }
  return { ms: elapsed, exitCode: result.status ?? 1 };
}

const shape = detectShape();
const candidates = buildCandidates(shape);

process.stdout.write(
  [
    "=== veredicto before/after agent-loop bench ===",
    `project: ${configPath}`,
    `shape: ${shape}`,
    `candidates: ${candidates.length}`,
    `kinds: ${candidates.map((candidate) => candidate.kind).join(", ")}`,
    "",
  ].join("\n"),
);

const beforeSamples = [];
for (const candidate of candidates) {
  const sample = coldTscWithDisk(candidate);
  beforeSamples.push(sample.ms);
  process.stdout.write(
    `BEFORE tsc  ${candidate.id.padEnd(22)} ${sample.ms.toFixed(0)} ms  exit=${sample.exitCode}\n`,
  );
}
const beforeTotal = sum(beforeSamples);
const beforeAvg = avg(beforeSamples);

process.stdout.write("\n");

const initStart = performance.now();
const session = new Session(configPath);
const initMs = performance.now() - initStart;

const warmStart = performance.now();
const warmResponse = session.checkAll(candidates, { withFixes: true, withImpact: true });
const warmBatchMs = performance.now() - warmStart;
const warmPer = warmResponse.results.map((result) => result.summary.checkedMs);
const warmAvg = avg(warmPer);

for (const result of warmResponse.results) {
  process.stdout.write(
    `AFTER  warm ${result.id.padEnd(22)} ${result.summary.checkedMs} ms  ${result.verdict} new=${result.summary.newErrors} fixed=${result.summary.fixedErrors}\n`,
  );
}

process.stdout.write("\n");

let parallelBatchMs = null;
let parallelAvg = null;
if (values.skipParallel !== true) {
  const parallelStart = performance.now();
  const parallelResponse = await checkAllParallel(configPath, candidates, {
    withFixes: true,
    withImpact: true,
    workers: WORKERS,
  });
  parallelBatchMs = performance.now() - parallelStart;
  parallelAvg = avg(parallelResponse.results.map((result) => result.summary.checkedMs));
  for (const result of parallelResponse.results) {
    process.stdout.write(
      `AFTER  para ${result.id.padEnd(22)} ${result.summary.checkedMs} ms  ${result.verdict}\n`,
    );
  }
  process.stdout.write("\n");
}

const afterTotal = initMs + warmBatchMs;
const speedupPer = beforeAvg / warmAvg;
const speedupBatch = beforeTotal / afterTotal;

const lines = [
  "=== summary ===",
  `root files: ${session.fileCount()}`,
  `baseline errors: ${session.baselineErrorCount()}`,
  "",
  "BEFORE (write disk → spawn tsc --noEmit → restore) × N",
  `  total wall:     ${beforeTotal.toFixed(0)} ms`,
  `  per candidate:  ${beforeAvg.toFixed(0)} ms avg`,
  "",
  "AFTER sequential (Session init once + warm overlays + fixes + impact)",
  `  init once:     ${initMs.toFixed(0)} ms`,
  `  batch wall:     ${warmBatchMs.toFixed(0)} ms`,
  `  per candidate:  ${warmAvg.toFixed(1)} ms avg`,
  `  init+batch:     ${afterTotal.toFixed(0)} ms`,
  "",
];

if (parallelBatchMs !== null && parallelAvg !== null) {
  lines.push(
    `AFTER parallel (workers=${WORKERS}, each worker inits its own Session)`,
    `  batch wall:     ${parallelBatchMs.toFixed(0)} ms`,
    `  per candidate:  ${parallelAvg.toFixed(1)} ms avg (inside workers; not additive)`,
    "",
  );
}

lines.push(
  "ratios (quote carefully)",
  `  per-candidate BEFORE/AFTER warm:  ${speedupPer.toFixed(1)}×`,
  `  full-loop BEFORE total / AFTER init+batch: ${speedupBatch.toFixed(1)}×`,
  "",
  `cwd-relative: ${path.relative(ROOT, projectDir) || "."}`,
  "",
);

process.stdout.write(lines.join("\n"));

process.stdout.write(
  `${JSON.stringify({
    project: configPath,
    shape,
    files: session.fileCount(),
    baselineErrors: session.baselineErrorCount(),
    candidates: candidates.length,
    before: { totalMs: beforeTotal, avgMs: beforeAvg },
    afterSequential: {
      initMs,
      batchMs: warmBatchMs,
      avgMs: warmAvg,
      initPlusBatchMs: afterTotal,
    },
    afterParallel:
      parallelBatchMs === null
        ? null
        : { workers: WORKERS, batchMs: parallelBatchMs, avgMs: parallelAvg },
    speedup: { perCandidate: speedupPer, fullLoop: speedupBatch },
  })}\n`,
);
