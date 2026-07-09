#!/usr/bin/env node
/**
 * Generates a synthetic TypeScript project shaped like a small app, not a toy chain.
 *
 * Layout:
 *   src/core/*     — leaf utilities (no imports)
 *   src/services/* — each imports 2–3 core modules
 *   src/routes/*   — each imports 2 services
 *   src/app.ts     — imports all routes + one deliberate baseline error
 *
 * Usage:
 *   node bench/generate-large.mjs [--out bench/large] [--core 40] [--services 30] [--routes 20]
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
    core: { type: "string", default: "40" },
    services: { type: "string", default: "30" },
    routes: { type: "string", default: "20" },
    // Back-compat with older --modules flag: approximate a layered graph.
    modules: { type: "string" },
  },
});

function positiveInt(raw, flag) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    process.stderr.write(`${flag} must be a positive integer, got ${String(raw)}\n`);
    process.exit(1);
  }
  return value;
}

let coreCount = positiveInt(values.core, "--core");
let serviceCount = positiveInt(values.services, "--services");
let routeCount = positiveInt(values.routes, "--routes");

if (values.modules !== undefined) {
  const total = positiveInt(values.modules, "--modules");
  coreCount = Math.max(2, Math.floor(total * 0.4));
  serviceCount = Math.max(2, Math.floor(total * 0.3));
  routeCount = Math.max(2, total - coreCount - serviceCount);
}

const outDir = path.resolve(values.out ?? path.join(HERE, "large"));
rmSync(outDir, { recursive: true, force: true });

for (const dir of ["src/core", "src/services", "src/routes"]) {
  mkdirSync(path.join(outDir, dir), { recursive: true });
}

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
        rootDir: "src",
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`,
);

const coreNames = [];
for (let index = 0; index < coreCount; index += 1) {
  const name = `util${String(index).padStart(3, "0")}`;
  coreNames.push(name);
  writeFileSync(
    path.join(outDir, "src/core", `${name}.ts`),
    `export type ${name}Id = number;\n\nexport function ${name}(n: number): number {\n  return n * ${index + 1} + ${index};\n}\n\nexport const ${name}Label: string = "${name}";\n`,
  );
}

const serviceNames = [];
for (let index = 0; index < serviceCount; index += 1) {
  const name = `svc${String(index).padStart(3, "0")}`;
  serviceNames.push(name);
  const a = coreNames[index % coreNames.length];
  const b = coreNames[(index * 3 + 1) % coreNames.length];
  const c = coreNames[(index * 5 + 2) % coreNames.length];
  const imports = [...new Set([a, b, c])];
  const importLines = imports
    .map((dep) => `import { ${dep} } from "../core/${dep}.js";`)
    .join("\n");
  const body = imports.map((dep) => `${dep}(n)`).join(" + ");
  writeFileSync(
    path.join(outDir, "src/services", `${name}.ts`),
    `${importLines}\n\nexport function ${name}(n: number): number {\n  return ${body};\n}\n`,
  );
}

const routeNames = [];
for (let index = 0; index < routeCount; index += 1) {
  const name = `route${String(index).padStart(3, "0")}`;
  routeNames.push(name);
  const a = serviceNames[index % serviceNames.length];
  const b = serviceNames[(index * 2 + 1) % serviceNames.length];
  const imports = [...new Set([a, b])];
  const importLines = imports
    .map((dep) => `import { ${dep} } from "../services/${dep}.js";`)
    .join("\n");
  const body = imports.map((dep) => `${dep}(n)`).join(" + ");
  writeFileSync(
    path.join(outDir, "src/routes", `${name}.ts`),
    `${importLines}\n\nexport function ${name}(n: number): number {\n  return ${body};\n}\n`,
  );
}

const routeImports = routeNames
  .map((name) => `import { ${name} } from "./routes/${name}.js";`)
  .join("\n");
const routeSum = routeNames.map((name) => `${name}(1)`).join(" + ");

// Baseline error: answer typed as string but computed as number.
writeFileSync(
  path.join(outDir, "src/app.ts"),
  `${routeImports}\n\nexport function boot(n: number): number {\n  return ${routeSum} + n;\n}\n\nexport const answer: string = boot(1);\n`,
);

// A second consumer so signature changes in core fan out across the graph.
writeFileSync(
  path.join(outDir, "src/report.ts"),
  `import { util000 } from "./core/util000.js";\nimport { svc000 } from "./services/svc000.js";\n\nexport const reportValue: number = util000(2) + svc000(3);\n`,
);

const fileCount = coreCount + serviceCount + routeCount + 2;
process.stdout.write(
  [
    `generated layered project under ${outDir}`,
    `  core=${coreCount} services=${serviceCount} routes=${routeCount} (+ app.ts, report.ts)`,
    `  approx files=${fileCount}`,
    `  tsconfig=${path.join(outDir, "tsconfig.json")}`,
    "",
  ].join("\n"),
);
