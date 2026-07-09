#!/usr/bin/env node
/**
 * Minimal agent-style loop against the bundled fixture.
 * Demonstrates: warm session → batch candidates → rank by verdict/fixedErrors →
 * feed structured failures back (printed here instead of calling a model).
 *
 * Run from repo root after `npm run build`:
 *   node examples/agent-loop.mjs
 */
// biome-ignore lint/correctness/noNodejsModules: Node-only example; node: builtins are the platform.
import { fileURLToPath } from "node:url";
// biome-ignore lint/nursery/useImportRestrictions: example exercises the built public artifact in dist.
import { Session } from "../dist/session.js";

const PROJECT = fileURLToPath(new URL("../test/fixture/tsconfig.json", import.meta.url));

/** @type {import("../dist/verdict.js").Candidate[]} */
const candidates = [
  {
    id: "neutral-touch",
    files: {
      "src/math.ts":
        "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport const touched = true;\n",
    },
  },
  {
    id: "broken-signature",
    files: {
      "src/math.ts":
        "export function add(a: number, b: string): number {\n  return a + Number(b);\n}\n",
    },
  },
  {
    id: "real-fix",
    files: {
      "src/report.ts":
        'import { add } from "./math.js";\n\nexport const total: number = add(1, 2);\n',
    },
  },
];

const session = new Session(PROJECT);
const { baseline, results } = session.checkAll(candidates, { withFixes: true });

process.stdout.write(
  `project=${session.project}\nbaselineErrors=${baseline.errorCount}\nfiles=${session.fileCount()}\n\n`,
);

const passers = results
  .filter((result) => result.verdict === "pass")
  .sort((left, right) => right.summary.fixedErrors - left.summary.fixedErrors);

const failures = results.filter((result) => result.verdict === "fail");

if (passers.length > 0) {
  const winner = passers[0];
  process.stdout.write(
    `ACCEPT ${winner.id} fixedErrors=${winner.summary.fixedErrors} totalErrors=${winner.summary.totalErrors} ms=${winner.summary.checkedMs}\n`,
  );
} else {
  process.stdout.write("NO PASSING CANDIDATE\n");
}

for (const result of failures) {
  process.stdout.write(
    `\nFEEDBACK for model ← ${result.id} newErrors=${result.summary.newErrors}\n`,
  );
  for (const diagnostic of result.newDiagnostics) {
    const at =
      diagnostic.position === null ? "-" : `${diagnostic.position.line}:${diagnostic.position.col}`;
    process.stdout.write(`  ${diagnostic.file}:${at} ${diagnostic.code} ${diagnostic.message}\n`);
  }
  for (const fix of result.fixes) {
    process.stdout.write(`  repair ${fix.forCode} ${fix.fixName}: ${fix.description}\n`);
  }
}

process.exitCode = passers.length > 0 ? 0 : 2;
