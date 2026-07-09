// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { parentPort, workerData } from "node:worker_threads";
import { Session } from "./session.js";
import type { Candidate } from "./verdict.js";

interface WorkerRequest {
  project: string;
  candidates: Candidate[];
  withFixes: boolean;
  withImpact: boolean;
}

const request = workerData as WorkerRequest;

try {
  const session = new Session(request.project);
  const response = session.checkAll(request.candidates, {
    withFixes: request.withFixes,
    withImpact: request.withImpact,
  });
  parentPort?.postMessage({
    ok: true,
    results: response.results,
    baselineErrorCount: response.baseline.errorCount,
    project: response.project,
  });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
