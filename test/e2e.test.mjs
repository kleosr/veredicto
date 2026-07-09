// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import assert from "node:assert/strict";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { spawnSync } from "node:child_process";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import test from "node:test";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { fileURLToPath } from "node:url";
// biome-ignore lint/nursery/useImportRestrictions: tests exercise the built public artifact in dist.
import { checkAllParallel } from "../dist/parallel.js";
// biome-ignore lint/nursery/useImportRestrictions: tests exercise the built public artifact in dist.
import { createServer } from "../dist/server.js";
// biome-ignore lint/nursery/useImportRestrictions: tests exercise the built public artifact in dist.
import { Session } from "../dist/session.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const NON_LOOPBACK = /non-loopback/;

const FIXTURE = fileURLToPath(new URL("./fixture/tsconfig.json", import.meta.url));

const NEUTRAL = {
  id: "neutral",
  files: {
    "src/math.ts":
      "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport const touched = true;\n",
  },
};

const REGRESSION = {
  id: "regression",
  files: {
    "src/math.ts":
      "export function add(a: number, b: string): number {\n  return a + Number(b);\n}\n",
  },
};

const FIX = {
  id: "fix",
  files: {
    "src/report.ts": 'import { add } from "./math";\n\nexport const total: number = add(1, 2);\n',
  },
};

const NEW_FILE = {
  id: "new-file",
  files: { "src/extra.ts": 'export const flag: number = "not a number";\n' },
};

const DELETE_FILE = {
  id: "delete-file",
  files: { "src/math.ts": null },
};

const session = new Session(FIXTURE);

test("baseline captures the fixture's single known error", () => {
  assert.equal(session.baselineErrorCount(), 1);
  assert.equal(session.baseline[0].code, "TS2322");
});

test("neutral patch passes and does not hide baseline debt", () => {
  const result = session.checkCandidate(NEUTRAL);
  assert.equal(result.verdict, "pass");
  assert.equal(result.summary.newErrors, 0);
  assert.equal(result.summary.fixedErrors, 0);
  assert.equal(result.summary.totalErrors, 1);
});

test("regression in one file is reported in its dependents", () => {
  const result = session.checkCandidate(REGRESSION, { withFixes: true });
  assert.equal(result.verdict, "fail");
  assert.ok(result.summary.newErrors >= 1);
  assert.ok(result.newDiagnostics.some((diagnostic) => diagnostic.file.endsWith("report.ts")));
  assert.ok(Array.isArray(result.fixes));
});

test("a real fix removes the baseline error", () => {
  const result = session.checkCandidate(FIX);
  assert.equal(result.verdict, "pass");
  assert.equal(result.summary.fixedErrors, 1);
  assert.equal(result.summary.totalErrors, 0);
});

test("a brand-new file joins the check", () => {
  const result = session.checkCandidate(NEW_FILE);
  assert.equal(result.verdict, "fail");
  assert.ok(result.newDiagnostics.some((diagnostic) => diagnostic.file.endsWith("extra.ts")));
});

test("a deleted file is removed from the program", () => {
  const result = session.checkCandidate(DELETE_FILE);
  assert.equal(result.verdict, "fail");
  assert.ok(
    result.newDiagnostics.some(
      (diagnostic) =>
        diagnostic.file.endsWith("report.ts") &&
        (diagnostic.code === "TS2307" || diagnostic.code === "TS2305"),
    ),
  );
});

test("session state is clean after every candidate", () => {
  assert.equal(session.baselineErrorCount(), 1);
  const again = session.checkCandidate(NEUTRAL);
  assert.equal(again.verdict, "pass");
  assert.equal(again.summary.totalErrors, 1);
});

test("http api returns the same verdicts and rejects bad input", async () => {
  const server = createServer(session);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();

  const health = await fetch(`http://127.0.0.1:${port}/v1/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.baselineErrors, 1);

  const check = await fetch(`http://127.0.0.1:${port}/v1/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates: [FIX, REGRESSION], fixes: true }),
  });
  assert.equal(check.status, 200);
  const body = await check.json();
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].verdict, "pass");
  assert.equal(body.results[1].verdict, "fail");

  const bad = await fetch(`http://127.0.0.1:${port}/v1/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates: "nope" }),
  });
  assert.equal(bad.status, 400);

  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test("serve refuses non-loopback hosts", () => {
  const result = spawnSync(
    process.execPath,
    [CLI, "serve", "--project", FIXTURE, "--host", "0.0.0.0", "--port", "4117"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, NON_LOOPBACK);
});

test("responses carry protocolVersion and null impact by default", () => {
  const response = session.checkAll([NEUTRAL]);
  assert.equal(response.protocolVersion, 1);
  assert.equal(response.results[0].impact, null);
});

test("impact reports export signature change and reference fan-out", () => {
  const result = session.checkCandidate(REGRESSION, { withImpact: true });
  assert.equal(result.verdict, "fail");
  assert.ok(result.impact !== null);
  assert.ok(
    result.impact.changedExports.some(
      (change) => change.name === "add" && change.kind === "typeChanged",
    ),
  );
  const addChange = result.impact.changedExports.find((change) => change.name === "add");
  assert.ok(addChange !== undefined);
  assert.ok(addChange.references.some((reference) => reference.file.endsWith("report.ts")));
});

test("fixes include confidence and preconditions", () => {
  const result = session.checkCandidate(REGRESSION, { withFixes: true });
  for (const fix of result.fixes) {
    assert.ok(["high", "medium", "low"].includes(fix.confidence));
    assert.ok(Array.isArray(fix.preconditions));
    assert.ok(fix.preconditions.length > 0);
  }
});

test("parallel workers preserve verdict order and semantics", async () => {
  const response = await checkAllParallel(FIXTURE, [FIX, REGRESSION, NEUTRAL], {
    withFixes: true,
    withImpact: true,
    workers: 2,
  });
  assert.equal(response.protocolVersion, 1);
  assert.equal(response.results.length, 3);
  assert.equal(response.results[0].id, "fix");
  assert.equal(response.results[0].verdict, "pass");
  assert.equal(response.results[1].id, "regression");
  assert.equal(response.results[1].verdict, "fail");
  assert.equal(response.results[2].id, "neutral");
  assert.equal(response.results[2].verdict, "pass");
  assert.ok(response.results[1].impact !== null);
});
