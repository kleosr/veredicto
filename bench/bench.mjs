// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { spawnSync } from "node:child_process";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { fileURLToPath } from "node:url";
// biome-ignore lint/nursery/useImportRestrictions: tests exercise the built public artifact in dist.
import { Session } from "../dist/session.js";

const FIXTURE_DIR = fileURLToPath(new URL("../test/fixture", import.meta.url));
const FIXTURE_CONFIG = fileURLToPath(new URL("../test/fixture/tsconfig.json", import.meta.url));
const TSC = fileURLToPath(new URL("../node_modules/typescript/lib/tsc.js", import.meta.url));
const RUNS = 5;

const CANDIDATES = Array.from({ length: RUNS }, (_, index) => ({
  id: `candidate-${index}`,
  files: {
    "src/report.ts": `import { add } from "./math";\n\nexport const total: number = add(${index}, 2);\n`,
  },
}));

function coldRunMs() {
  const startedAt = performance.now();
  spawnSync(process.execPath, [TSC, "-p", FIXTURE_DIR, "--noEmit"], { encoding: "utf8" });
  return performance.now() - startedAt;
}

function average(samples) {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

const cold = [];
for (let index = 0; index < RUNS; index += 1) {
  cold.push(coldRunMs());
}

const initStart = performance.now();
const session = new Session(FIXTURE_CONFIG);
const initMs = performance.now() - initStart;

const warm = CANDIDATES.map((candidate) => {
  const startedAt = performance.now();
  session.checkCandidate(candidate);
  return performance.now() - startedAt;
});

process.stdout.write(
  [
    `fixture: ${FIXTURE_DIR}`,
    `cold "tsc --noEmit" x${RUNS}: avg ${average(cold).toFixed(0)} ms per candidate`,
    `veredicto session init incl. baseline check: ${initMs.toFixed(0)} ms, once`,
    `veredicto warm check x${RUNS}: avg ${average(warm).toFixed(1)} ms per candidate`,
    `per-candidate speedup after init: ${(average(cold) / average(warm)).toFixed(0)}x`,
    "",
  ].join("\n"),
);
