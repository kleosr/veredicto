import ts from "typescript";
import type { SemanticImpact } from "./impact.js";

export type DiagnosticCategory = "error" | "warning" | "suggestion" | "message";

/** Wire protocol version. Additive fields allowed; meaning changes require a bump. */
export const PROTOCOL_VERSION = 1 as const;

export type FixConfidence = "high" | "medium" | "low";

export interface Position {
  line: number;
  col: number;
}

export interface VerdictDiagnostic {
  code: string;
  category: DiagnosticCategory;
  file: string;
  position: Position | null;
  length: number;
  message: string;
}

export interface RepairEdit {
  file: string;
  position: Position | null;
  length: number;
  newText: string;
}

export interface RepairAction {
  forCode: string;
  file: string;
  fixName: string;
  description: string;
  edits: RepairEdit[];
  /** Heuristic: preferred TS fix names → high; multi-file → low; else medium. */
  confidence: FixConfidence;
  /** Machine-checkable conditions an agent should verify before applying. */
  preconditions: string[];
}

export type CandidateFiles = Record<string, string | null>;

export interface Candidate {
  id: string;
  files: CandidateFiles;
}

export interface CandidateSummary {
  newErrors: number;
  fixedErrors: number;
  totalErrors: number;
  checkedMs: number;
}

export interface CandidateResult {
  id: string;
  verdict: "pass" | "fail";
  summary: CandidateSummary;
  newDiagnostics: VerdictDiagnostic[];
  fixedDiagnostics: VerdictDiagnostic[];
  fixes: RepairAction[];
  /** Present when requested; null when impact was not computed. */
  impact: SemanticImpact | null;
}

export interface CheckResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  project: string;
  baseline: { errorCount: number };
  results: CandidateResult[];
}

export interface DiagnosticDelta {
  added: VerdictDiagnostic[];
  removed: VerdictDiagnostic[];
}

const CATEGORY_NAMES: Record<ts.DiagnosticCategory, DiagnosticCategory> = {
  [ts.DiagnosticCategory.Error]: "error",
  [ts.DiagnosticCategory.Warning]: "warning",
  [ts.DiagnosticCategory.Suggestion]: "suggestion",
  [ts.DiagnosticCategory.Message]: "message",
};

const PROJECT_LEVEL_FILE = "(project)";

export function toVerdictDiagnostic(diagnostic: ts.Diagnostic): VerdictDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  const code = `TS${diagnostic.code}`;
  const category = CATEGORY_NAMES[diagnostic.category];
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return { code, category, file: PROJECT_LEVEL_FILE, position: null, length: 0, message };
  }
  const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return {
    code,
    category,
    file: diagnostic.file.fileName,
    position: { line: location.line + 1, col: location.character + 1 },
    length: diagnostic.length ?? 0,
    message,
  };
}

// ponytail: keyed by file+code+message, not span, so a moved-but-unchanged
// diagnostic still matches its baseline twin. Ceiling: two byte-identical
// errors in one file collapse into one key. Upgrade path: span anchoring for
// files the candidate did not touch.
export function diagnosticKey(diagnostic: VerdictDiagnostic): string {
  return `${diagnostic.file}|${diagnostic.code}|${diagnostic.message}`;
}

export function diffDiagnostics(
  baseline: VerdictDiagnostic[],
  current: VerdictDiagnostic[],
): DiagnosticDelta {
  const baselineKeys = new Set(baseline.map(diagnosticKey));
  const currentKeys = new Set(current.map(diagnosticKey));
  return {
    added: current.filter((diagnostic) => !baselineKeys.has(diagnosticKey(diagnostic))),
    removed: baseline.filter((diagnostic) => !currentKeys.has(diagnosticKey(diagnostic))),
  };
}

export function isError(diagnostic: VerdictDiagnostic): boolean {
  return diagnostic.category === "error";
}

export function classifyFixConfidence(
  action: ts.CodeFixAction,
  editFiles: readonly string[],
): FixConfidence {
  const uniqueFiles = new Set(editFiles);
  if (uniqueFiles.size > 1) {
    return "low";
  }
  if (action.fixAllDescription !== undefined || action.commands !== undefined) {
    return "low";
  }
  const name = action.fixName ?? "";
  // Heuristic over TypeScript's public fixName strings — not a credential list.
  if (
    name.startsWith("fix") ||
    name.startsWith("import") ||
    name.startsWith("addMissing") ||
    name.startsWith("unusedIdentifier") ||
    name.startsWith("classCorrect") ||
    name.startsWith("constructorFor")
  ) {
    return "high";
  }
  return "medium";
}

export function fixPreconditions(
  diagnostic: VerdictDiagnostic,
  action: ts.CodeFixAction,
  edits: readonly RepairEdit[],
): string[] {
  const preconditions = [
    `diagnostic.code === ${JSON.stringify(diagnostic.code)}`,
    `edits.length === ${edits.length}`,
  ];
  if (diagnostic.position !== null) {
    preconditions.push(
      `span.file === ${JSON.stringify(diagnostic.file)}`,
      `span.line === ${diagnostic.position.line}`,
      `span.col === ${diagnostic.position.col}`,
      `span.length === ${diagnostic.length}`,
    );
  }
  if (action.fixName !== undefined) {
    preconditions.push(`fixName === ${JSON.stringify(action.fixName)}`);
  }
  const files = [...new Set(edits.map((edit) => edit.file))];
  if (files.length > 1) {
    preconditions.push("review.multiFileEdits === true");
  }
  return preconditions;
}

export function toRepairAction(
  diagnostic: VerdictDiagnostic,
  action: ts.CodeFixAction,
  program: ts.Program | undefined,
): RepairAction {
  const edits: RepairEdit[] = [];
  for (const change of action.changes) {
    const sourceFile = program?.getSourceFile(change.fileName);
    for (const textChange of change.textChanges) {
      edits.push({
        file: change.fileName,
        position: positionAt(sourceFile, textChange.span.start),
        length: textChange.span.length,
        newText: textChange.newText,
      });
    }
  }
  return {
    forCode: diagnostic.code,
    file: diagnostic.file,
    fixName: action.fixName,
    description: action.description,
    edits,
    confidence: classifyFixConfidence(
      action,
      edits.map((edit) => edit.file),
    ),
    preconditions: fixPreconditions(diagnostic, action, edits),
  };
}

function positionAt(sourceFile: ts.SourceFile | undefined, offset: number): Position | null {
  if (sourceFile === undefined) {
    return null;
  }
  const location = sourceFile.getLineAndCharacterOfPosition(offset);
  return { line: location.line + 1, col: location.character + 1 };
}

export function renderCompact(result: CandidateResult): string {
  const header = `${result.id} ${result.verdict} new=${result.summary.newErrors} fixed=${result.summary.fixedErrors} total=${result.summary.totalErrors} ms=${result.summary.checkedMs}`;
  const lines = [header];
  for (const diagnostic of result.newDiagnostics) {
    lines.push(`  + ${compactDiagnostic(diagnostic)}`);
  }
  for (const diagnostic of result.fixedDiagnostics) {
    lines.push(`  - ${compactDiagnostic(diagnostic)}`);
  }
  if (result.impact !== null && result.impact.changedExports.length > 0) {
    for (const change of result.impact.changedExports) {
      lines.push(
        `  ~ ${change.file} ${change.name} ${change.kind} refs=${change.references.length}`,
      );
    }
  }
  return lines.join("\n");
}

function compactDiagnostic(diagnostic: VerdictDiagnostic): string {
  const at =
    diagnostic.position === null ? "-" : `${diagnostic.position.line}:${diagnostic.position.col}`;
  return `${diagnostic.file}:${at} ${diagnostic.code} ${diagnostic.message}`;
}

export function validateCandidates(input: unknown): Candidate[] {
  if (!Array.isArray(input)) {
    throw new TypeError("candidates must be an array");
  }
  return input.map((entry, index) => validateCandidate(entry, index));
}

function validateCandidate(entry: unknown, index: number): Candidate {
  if (typeof entry !== "object" || entry === null) {
    throw new TypeError(`candidates[${index}] must be an object`);
  }
  const record = entry as { id?: unknown; files?: unknown };
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new TypeError(`candidates[${index}].id must be a non-empty string`);
  }
  if (typeof record.files !== "object" || record.files === null || Array.isArray(record.files)) {
    throw new TypeError(`candidates[${index}].files must be an object of path -> content`);
  }
  const files: CandidateFiles = {};
  for (const [filePath, content] of Object.entries(record.files)) {
    if (typeof content !== "string" && content !== null) {
      throw new TypeError(
        `candidates[${index}].files[${JSON.stringify(filePath)}] must be a string or null`,
      );
    }
    files[filePath] = content;
  }
  return { id: record.id, files };
}
