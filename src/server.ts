import type http from "node:http";
// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import { createServer as createHttpServer } from "node:http";
import type { Session } from "./session.js";
import { validateCandidates } from "./verdict.js";

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
      sendJson(response, 200, session.checkAll(candidates, { withFixes: extractFixes(payload) }));
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

function extractFixes(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { fixes?: unknown }).fixes === true
  );
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
