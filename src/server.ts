import type http from "node:http";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { createServer as createHttpServer } from "node:http";
import { checkAllParallel } from "./parallel.js";
import type { Session } from "./session.js";
import { PROTOCOL_VERSION, validateCandidates } from "./verdict.js";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

export function createServer(session: Session): http.Server {
  return createHttpServer((request, response) => {
    route(session, request, response).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function route(
  session: Session,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  try {
    if (request.method === "GET" && request.url === "/v1/health") {
      sendJson(response, 200, {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        project: session.project,
        files: session.fileCount(),
        baselineErrors: session.baselineErrorCount(),
      });
      return;
    }
    if (request.method === "POST" && request.url === "/v1/check") {
      const body = await readBody(request);
      const payload: unknown = JSON.parse(body);
      const candidates = validateCandidates(extractCandidates(payload));
      const options = {
        withFixes: extractFlag(payload, "fixes"),
        withImpact: extractFlag(payload, "impact"),
      };
      if (extractFlag(payload, "parallel")) {
        const workers = extractWorkers(payload);
        sendJson(
          response,
          200,
          await checkAllParallel(session.project, candidates, { ...options, workers }),
        );
        return;
      }
      sendJson(response, 200, session.checkAll(candidates, options));
      return;
    }
    sendJson(response, 404, { error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: message });
  }
}

function extractCandidates(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("body must be a JSON object with a candidates array");
  }
  return (payload as { candidates?: unknown }).candidates;
}

function extractFlag(payload: unknown, key: "fixes" | "impact" | "parallel"): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as Record<string, unknown>)[key] === true
  );
}

function extractWorkers(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const workers = (payload as { workers?: unknown }).workers;
  if (workers === undefined) {
    return undefined;
  }
  if (typeof workers !== "number" || !Number.isInteger(workers) || workers < 1) {
    throw new TypeError("workers must be a positive integer");
  }
  return workers;
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let received = 0;
    request.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        rejectPromise(new TypeError(`body exceeds ${MAX_BODY_BYTES} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolvePromise(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", rejectPromise);
  });
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
