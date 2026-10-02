// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { parentPort } from "node:worker_threads";
import { Session } from "./session.js";
import type { Candidate } from "./verdict.js";

interface WorkerRequest {
  project: string;
  candidates: Candidate[];
  withFixes: boolean;
  withImpact: boolean;
}

let session: Session | undefined;
let sessionProject: string | undefined;

parentPort?.on("message", (request: WorkerRequest) => {
  try {
    if (session === undefined || sessionProject !== request.project) {
      session = new Session(request.project);
      sessionProject = request.project;
    }
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
    session = undefined;
    sessionProject = undefined;
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
