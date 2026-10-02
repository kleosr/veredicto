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

interface Lane {
  worker: Worker;
  chain: Promise<void>;
}

const lanesByProject = new Map<string, Lane[]>();

function spawnWorker(): Worker {
  const worker = new Worker(WORKER_PATH);
  worker.unref();
  return worker;
}

function laneAt(project: string, index: number): Lane {
  let lanes = lanesByProject.get(project);
  if (lanes === undefined) {
    lanes = [];
    lanesByProject.set(project, lanes);
  }
  const existing = lanes[index];
  if (existing !== undefined) {
    return existing;
  }
  const created: Lane = { worker: spawnWorker(), chain: Promise.resolve() };
  lanes[index] = created;
  return created;
}

function dispatch(project: string, index: number, request: WorkerRequest): Promise<WorkerSuccess> {
  const lane = laneAt(project, index);
  const pending = lane.chain.then(() => askWorker(lane, request));
  lane.chain = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

function askWorker(lane: Lane, request: WorkerRequest): Promise<WorkerSuccess> {
  const worker = lane.worker;
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error: Error | null, value?: WorkerSuccess): void => {
      if (settled) {
        return;
      }
      settled = true;
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      if (error !== null) {
        lane.worker = spawnWorker();
        rejectPromise(error);
        return;
      }
      if (value === undefined) {
        rejectPromise(new Error("worker finished without a result"));
        return;
      }
      resolvePromise(value);
    };
    const onMessage = (message: WorkerResponse): void => {
      if (message.ok) {
        finish(null, message);
        return;
      }
      finish(new Error(message.error));
    };
    const onError = (error: Error): void => {
      finish(error);
    };
    const onExit = (code: number): void => {
      finish(new Error(`check worker exited with code ${code}`));
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    worker.postMessage(request);
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
    groups.map((group, index) =>
      dispatch(project, index, {
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
