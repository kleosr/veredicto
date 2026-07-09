// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import path from "node:path";
import ts from "typescript";
import { type ExportSignature, buildSemanticImpact, collectExportSignatures } from "./impact.js";
import {
  type Candidate,
  type CandidateFiles,
  type CandidateResult,
  type CheckResponse,
  PROTOCOL_VERSION,
  type RepairAction,
  type VerdictDiagnostic,
  diffDiagnostics,
  isError,
  toRepairAction,
  toVerdictDiagnostic,
} from "./verdict.js";

const CHECKABLE_FILE_PATTERN = /\.(?:ts|tsx|mts|cts)$/;
const FIXES_PER_CANDIDATE_LIMIT = 3;

export interface CheckOptions {
  withFixes?: boolean;
  withImpact?: boolean;
}

interface Overlay {
  text: string | null;
}

export class Session {
  private readonly configPath: string;
  private readonly projectDir: string;
  private readonly parsed: ts.ParsedCommandLine;
  private readonly overlays = new Map<string, Overlay>();
  private readonly versions = new Map<string, number>();
  private readonly service: ts.LanguageService;
  private readonly baselineDiagnostics: VerdictDiagnostic[];
  private readonly baselineExports = new Map<string, Map<string, ExportSignature>>();

  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
    this.projectDir = path.dirname(this.configPath);
    this.parsed = parseConfig(this.configPath);
    this.service = ts.createLanguageService(this.createHost(), ts.createDocumentRegistry());
    this.baselineDiagnostics = this.collectDiagnostics();
    const program = this.service.getProgram();
    if (program !== undefined) {
      for (const fileName of this.rootFileNames()) {
        this.baselineExports.set(fileName, collectExportSignatures(program, fileName));
      }
    }
  }

  get project(): string {
    return this.configPath;
  }

  get baseline(): VerdictDiagnostic[] {
    return this.baselineDiagnostics;
  }

  baselineErrorCount(): number {
    return this.baselineDiagnostics.filter(isError).length;
  }

  fileCount(): number {
    return this.rootFileNames().length;
  }

  checkAll(candidates: Candidate[], options: CheckOptions = {}): CheckResponse {
    return {
      protocolVersion: PROTOCOL_VERSION,
      project: this.configPath,
      baseline: { errorCount: this.baselineErrorCount() },
      results: candidates.map((candidate) => this.checkCandidate(candidate, options)),
    };
  }

  checkCandidate(candidate: Candidate, options: CheckOptions = {}): CandidateResult {
    const startedAt = performance.now();
    this.apply(candidate.files);
    try {
      const current = this.collectDiagnostics();
      const delta = diffDiagnostics(this.baselineDiagnostics, current);
      const newErrors = delta.added.filter(isError);
      const fixes = options.withFixes === true ? this.collectFixes(newErrors) : [];
      const impact =
        options.withImpact === true ? this.collectImpact(Object.keys(candidate.files)) : null;
      return {
        id: candidate.id,
        verdict: newErrors.length === 0 ? "pass" : "fail",
        summary: {
          newErrors: newErrors.length,
          fixedErrors: delta.removed.filter(isError).length,
          totalErrors: current.filter(isError).length,
          checkedMs: Math.round(performance.now() - startedAt),
        },
        newDiagnostics: delta.added,
        fixedDiagnostics: delta.removed,
        fixes,
        impact,
      };
    } finally {
      this.restore(candidate.files);
    }
  }

  private collectImpact(relativePaths: readonly string[]) {
    const program = this.service.getProgram();
    if (program === undefined) {
      return { touchedFiles: [], changedExports: [] };
    }
    const touchedFiles = relativePaths.map((fileName) => this.resolve(fileName));
    return buildSemanticImpact({
      touchedFiles,
      baselineByFile: this.baselineExports,
      currentProgram: program,
      service: this.service,
    });
  }

  private createHost(): ts.LanguageServiceHost {
    return {
      getCompilationSettings: (): ts.CompilerOptions => this.parsed.options,
      getScriptFileNames: (): string[] => this.rootFileNames(),
      getScriptVersion: (fileName: string): string =>
        String(this.versions.get(this.resolve(fileName)) ?? 0),
      getScriptSnapshot: (fileName: string): ts.IScriptSnapshot | undefined =>
        this.snapshotFor(fileName),
      getCurrentDirectory: (): string => this.projectDir,
      getDefaultLibFileName: (options: ts.CompilerOptions): string =>
        ts.getDefaultLibFilePath(options),
      fileExists: (fileName: string): boolean => this.overlayFileExists(fileName),
      readFile: (fileName: string): string | undefined => this.overlayReadFile(fileName),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
  }

  private rootFileNames(): string[] {
    const roots = new Set(this.parsed.fileNames.map((fileName) => this.resolve(fileName)));
    for (const [fileName, overlay] of this.overlays) {
      if (overlay.text === null) {
        roots.delete(fileName);
      } else if (CHECKABLE_FILE_PATTERN.test(fileName)) {
        roots.add(fileName);
      }
    }
    return [...roots];
  }

  private collectDiagnostics(): VerdictDiagnostic[] {
    const diagnostics: ts.Diagnostic[] = [...this.service.getCompilerOptionsDiagnostics()];
    for (const fileName of this.rootFileNames()) {
      diagnostics.push(...this.service.getSyntacticDiagnostics(fileName));
      diagnostics.push(...this.service.getSemanticDiagnostics(fileName));
    }
    return diagnostics.map(toVerdictDiagnostic);
  }

  private collectFixes(newErrors: VerdictDiagnostic[]): RepairAction[] {
    const fixes: RepairAction[] = [];
    for (const diagnostic of newErrors.slice(0, FIXES_PER_CANDIDATE_LIMIT)) {
      fixes.push(...this.fixesFor(diagnostic));
    }
    return fixes;
  }

  private fixesFor(diagnostic: VerdictDiagnostic): RepairAction[] {
    if (diagnostic.position === null) {
      return [];
    }
    const program = this.service.getProgram();
    const sourceFile = program?.getSourceFile(diagnostic.file);
    if (program === undefined || sourceFile === undefined) {
      return [];
    }
    const start = sourceFile.getPositionOfLineAndCharacter(
      diagnostic.position.line - 1,
      diagnostic.position.col - 1,
    );
    const numericCode = Number(diagnostic.code.slice(2));
    try {
      const actions = this.service.getCodeFixesAtPosition(
        diagnostic.file,
        start,
        start + diagnostic.length,
        [numericCode],
        ts.getDefaultFormatCodeSettings("\n"),
        {},
      );
      return actions.map((action) => toRepairAction(diagnostic, action, program));
    } catch {
      // ponytail: code-fix providers can throw on exotic spans; a missing
      // suggestion is acceptable, a crashed check is not. Upgrade path:
      // surface the provider error as a diagnostic instead of swallowing.
      return [];
    }
  }

  private apply(files: CandidateFiles): void {
    for (const [fileName, text] of Object.entries(files)) {
      const resolved = this.resolve(fileName);
      this.overlays.set(resolved, { text });
      this.bump(resolved);
    }
  }

  private restore(files: CandidateFiles): void {
    for (const fileName of Object.keys(files)) {
      const resolved = this.resolve(fileName);
      this.overlays.delete(resolved);
      this.bump(resolved);
    }
  }

  private bump(resolved: string): void {
    this.versions.set(resolved, (this.versions.get(resolved) ?? 0) + 1);
  }

  private snapshotFor(fileName: string): ts.IScriptSnapshot | undefined {
    const text = this.overlayReadFile(fileName);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  }

  private overlayReadFile(fileName: string): string | undefined {
    const resolved = this.resolve(fileName);
    const overlay = this.overlays.get(resolved);
    if (overlay !== undefined) {
      return overlay.text ?? undefined;
    }
    return ts.sys.readFile(resolved);
  }

  private overlayFileExists(fileName: string): boolean {
    const resolved = this.resolve(fileName);
    const overlay = this.overlays.get(resolved);
    if (overlay !== undefined) {
      return overlay.text !== null;
    }
    return ts.sys.fileExists(resolved);
  }

  private resolve(fileName: string): string {
    return path.resolve(this.projectDir, fileName);
  }
}

function parseConfig(configPath: string): ts.ParsedCommandLine {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (parsed === undefined) {
    throw new Error(`could not parse project config: ${configPath}`);
  }
  return parsed;
}
