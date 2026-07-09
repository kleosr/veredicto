#!/usr/bin/env node
/**
 * Generates a synthetic TypeScript project for large-repo benches.
 * Deterministic. Safe to re-run (wipes only the target directory contents we own).
 *
 * Usage:
 *   node bench/generate-large.mjs [--out bench/large] [--modules 200]
 */
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import path from "node:path";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { fileURLToPath } from "node:url";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { parseArgs } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    out: { type: "string", default: path.join(HERE, "large") },
    modules: { type: "string", default: "200" },
  },
});

const outDir = path.resolve(values.out ?? path.join(HERE, "large"));
const moduleCount = Number(values.modules);
if (!Number.isInteger(moduleCount) || moduleCount < 2) {
  process.stderr.write(`--modules must be an integer >= 2, got ${String(values.modules)}\n`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
const srcDir = path.join(outDir, "src");
mkdirSync(srcDir, { recursive: true });

writeFileSync(
  path.join(outDir, "tsconfig.json"),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`,
);

for (let index = 0; index < moduleCount; index += 1) {
  const name = `m${String(index).padStart(4, "0")}`;
  const next = index + 1 < moduleCount ? `m${String(index + 1).padStart(4, "0")}` : null;
  const body =
    next === null
      ? `export function ${name}(n: number): number {\n  return n + ${index};\n}\n`
      : `import { ${next} } from "./${next}.js";\n\nexport function ${name}(n: number): number {\n  return ${next}(n) + ${index};\n}\n`;
  writeFileSync(path.join(srcDir, `${name}.ts`), body);
}

// One deliberate baseline error at the entry so fixedErrors is observable.
writeFileSync(
  path.join(srcDir, "entry.ts"),
  `import { m0000 } from "./m0000.js";\n\nexport const answer: string = m0000(1);\n`,
);

process.stdout.write(
  `generated ${moduleCount} modules + entry.ts under ${outDir}\n` +
    `tsconfig: ${path.join(outDir, "tsconfig.json")}\n`,
);
