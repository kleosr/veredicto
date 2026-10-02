// biome-ignore lint/correctness/noNodejsModules: Node-only tool; node: builtins are the platform.
import path from "node:path";
import ts from "typescript";
import {
  type ExportSignature,
  type SemanticImpact,
  buildSemanticImpact,
  collectExportSignatures,
} from "./impact.js";
import { dependentClosure, directImporters, forcesWholeProgram } from "./module-dependents.js";
import { OverlayScripts } from "./overlay-scripts.js";
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

const FIXES_PER_CANDIDATE_LIMIT = 3;
const FORMAT_SETTINGS = ts.getDefaultFormatCodeSettings("\n");

export interface CheckOptions {
  withFixes?: boolean;
  withImpact?: boolean;
}

export class Session {
  private readonly configPath: string;
  private readonly projectDir: string;
  private readonly scripts: OverlayScripts;
  private readonly service: ts.LanguageService;
  private readonly baselineDiagnostics: VerdictDiagnostic[];
  private readonly baselineByFile = new Map<string, VerdictDiagnostic[]>();
  private readonly baselineExports = new Map<string, Map<string, ExportSignature>>();
  private readonly importers: ReadonlyMap<string, readonly string[]>;
  private projectDiagnostics: VerdictDiagnostic[] = [];
  private exportsReady = false;

  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
    this.projectDir = path.dirname(this.configPath);
    const parsed = parseConfig(this.configPath);
    this.scripts = new OverlayScripts(this.projectDir, parsed, (fileName) =>
      path.resolve(this.projectDir, fileName),
    );
    this.service = ts.createLanguageService(this.scripts.createHost(), ts.createDocumentRegistry());
    this.baselineDiagnostics = this.collectDiagnostics(undefined, true);
    const program = this.service.getProgram();
    this.importers =
      program === undefined
        ? new Map()
        : directImporters(program, this.scripts.rootFileNames(), (fileName) =>
            this.scripts.resolve(fileName),
          );
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
    return this.scripts.rootFileNames().length;
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
    if (options.withImpact === true) {
      this.ensureBaselineExports();
    }
    const touched = Object.keys(candidate.files).map((fileName) => this.scripts.resolve(fileName));
    const structureChanged = this.scripts.apply(candidate.files);
    try {
      const wholeProgram = structureChanged || this.overlayForcesWholeProgram(candidate.files);
      const current = this.collectDiagnostics(
        wholeProgram ? undefined : dependentClosure(this.importers, touched),
        false,
      );
      const delta = diffDiagnostics(this.baselineDiagnostics, current, new Set(touched));
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
      this.scripts.restore(candidate.files);
    }
  }

  private collectImpact(relativePaths: readonly string[]): SemanticImpact {
    const program = this.service.getProgram();
    if (program === undefined) {
      return { touchedFiles: [], changedExports: [] };
    }
    const touchedFiles = relativePaths.map((fileName) => this.scripts.resolve(fileName));
    return buildSemanticImpact({
      touchedFiles,
      baselineByFile: this.baselineExports,
      currentProgram: program,
      service: this.service,
    });
  }

  private ensureBaselineExports(): void {
    if (this.exportsReady) {
      return;
    }
    const program = this.service.getProgram();
    if (program !== undefined) {
      for (const fileName of this.scripts.rootFileNames()) {
        this.baselineExports.set(fileName, collectExportSignatures(program, fileName));
      }
    }
    this.exportsReady = true;
  }

  private overlayForcesWholeProgram(files: CandidateFiles): boolean {
    for (const text of Object.values(files)) {
      if (typeof text === "string" && forcesWholeProgram(text)) {
        return true;
      }
    }
    return false;
  }

  private collectDiagnostics(
    limit: ReadonlySet<string> | undefined,
    remember: boolean,
  ): VerdictDiagnostic[] {
    this.service.getProgram();
    const projectDiagnostics =
      remember || limit !== undefined ? this.projectDiagnostics : this.readProjectDiagnostics();
    if (remember) {
      this.projectDiagnostics = this.readProjectDiagnostics();
    }
    const diagnostics = [...(remember ? this.projectDiagnostics : projectDiagnostics)];
    for (const fileName of this.scripts.rootFileNames()) {
      if (limit !== undefined && !limit.has(fileName)) {
        const cached = this.baselineByFile.get(fileName);
        if (cached !== undefined) {
          diagnostics.push(...cached);
        }
        continue;
      }
      const fresh = this.readFileDiagnostics(fileName);
      if (remember) {
        this.baselineByFile.set(fileName, fresh);
      }
      diagnostics.push(...fresh);
    }
    return diagnostics;
  }

  private readProjectDiagnostics(): VerdictDiagnostic[] {
    return this.service.getCompilerOptionsDiagnostics().map(toVerdictDiagnostic);
  }

  private readFileDiagnostics(fileName: string): VerdictDiagnostic[] {
    return [
      ...this.service.getSyntacticDiagnostics(fileName),
      ...this.service.getSemanticDiagnostics(fileName),
    ].map(toVerdictDiagnostic);
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
        FORMAT_SETTINGS,
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
