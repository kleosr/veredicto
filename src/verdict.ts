import ts from "typescript";

export type DiagnosticCategory = "error" | "warning" | "suggestion" | "message";

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
}

export interface CheckResponse {
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
