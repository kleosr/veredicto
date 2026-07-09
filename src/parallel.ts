// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { cpus } from "node:os";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import path from "node:path";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { Worker } from "node:worker_threads";
import type { Candidate, CheckResponse } from "./verdict.js";
import { PROTOCOL_VERSION } from "./verdict.js";

export interface ParallelCheckOptions {
  withFixes?: boolean;
  withImpact?: boolean;
  /** Max workers. Default: min(candidates, cpus, 4). */
  workers?: number;
}

interface WorkerRequest {
  project: string;
  candidates: Candidate[];
  withFixes: boolean;
  withImpact: boolean;
}

interface WorkerSuccess {
  ok: true;
  results: CheckResponse["results"];
  baselineErrorCount: number;
  project: string;
}

interface WorkerFailure {
  ok: false;
  error: string;
}

type WorkerResponse = WorkerSuccess | WorkerFailure;

// Emitted as CJS (package has no "type":"module"); __dirname is the platform path.
const WORKER_PATH = path.join(__dirname, "check-worker.js");

function chunk<T>(items: readonly T[], parts: number): T[][] {
  if (items.length === 0) {
    return [];
  }
  const size = Math.ceil(items.length / parts);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function runWorker(request: WorkerRequest): Promise<WorkerSuccess> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, { workerData: request });
    const finish = (error: Error | null, value?: WorkerSuccess): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (error !== null) {
        rejectPromise(error);
        return;
      }
      if (value === undefined) {
        rejectPromise(new Error("worker finished without a result"));
        return;
      }
      resolvePromise(value);
    };
    worker.once("message", (message: WorkerResponse) => {
      if (message.ok) {
        finish(null, message);
      } else {
        finish(new Error(message.error));
      }
    });
    worker.once("error", (error) => {
      finish(error);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(new Error(`check worker exited with code ${code}`));
      }
    });
  });
}

/**
 * Speculative multi-candidate check: one Session (LanguageService) per worker.
 * Safe under concurrent overlays because workers do not share mutable service state.
 */
export async function checkAllParallel(
  project: string,
  candidates: Candidate[],
  options: ParallelCheckOptions = {},
): Promise<CheckResponse> {
  if (candidates.length === 0) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      project,
      baseline: { errorCount: 0 },
      results: [],
    };
  }
  const maxWorkers = Math.max(
    1,
    Math.min(options.workers ?? Math.min(cpus().length, 4), candidates.length),
  );
  const groups = chunk(candidates, maxWorkers);
  const settled = await Promise.all(
    groups.map((group) =>
      runWorker({
        project,
        candidates: group,
        withFixes: options.withFixes === true,
        withImpact: options.withImpact === true,
      }),
    ),
  );
  const byId = new Map(
    settled.flatMap((part) => part.results.map((result) => [result.id, result] as const)),
  );
  const results = candidates.map((candidate) => {
    const result = byId.get(candidate.id);
    if (result === undefined) {
      throw new Error(`missing result for candidate ${candidate.id}`);
    }
    return result;
  });
  return {
    protocolVersion: PROTOCOL_VERSION,
    project: settled[0]?.project ?? project,
    baseline: { errorCount: settled[0]?.baselineErrorCount ?? 0 },
    results,
  };
}
