import ts from "typescript";
import type { CandidateFiles } from "./verdict.js";

const CHECKABLE_FILE_PATTERN = /\.(?:ts|tsx|mts|cts)$/;

interface ScriptSnapshotCache {
  version: string;
  snapshot: ts.IScriptSnapshot;
}

export class OverlayScripts {
  private readonly overlays = new Map<string, string | null>();
  private readonly scriptVersions = new Map<string, string>();
  private readonly snapshots = new Map<string, ScriptSnapshotCache>();
  private readonly resolvedPaths = new Map<string, string>();
  private readonly projectDir: string;
  private readonly parsed: ts.ParsedCommandLine;
  private readonly normalize: (fileName: string) => string;
  private cachedRoots: string[] | undefined;
  private projectVersion = 0;
  private projectVersionText = "0";

  constructor(
    projectDir: string,
    parsed: ts.ParsedCommandLine,
    normalize: (fileName: string) => string,
  ) {
    this.projectDir = projectDir;
    this.parsed = parsed;
    this.normalize = normalize;
  }

  rootFileNames(): string[] {
    if (this.cachedRoots !== undefined) {
      return this.cachedRoots;
    }
    const roots = new Set(this.parsed.fileNames.map((fileName) => this.resolve(fileName)));
    for (const [fileName, text] of this.overlays) {
      if (text === null) {
        roots.delete(fileName);
      } else if (CHECKABLE_FILE_PATTERN.test(fileName)) {
        roots.add(fileName);
      }
    }
    this.cachedRoots = [...roots];
    return this.cachedRoots;
  }

  apply(files: CandidateFiles): boolean {
    if (Object.keys(files).length === 0) {
      return false;
    }
    const before = this.rootFileNames();
    for (const [fileName, text] of Object.entries(files)) {
      const resolved = this.resolve(fileName);
      this.overlays.set(resolved, text);
      this.bump(resolved);
    }
    this.cachedRoots = undefined;
    this.bumpProject();
    const after = this.rootFileNames();
    if (before.length !== after.length) {
      return true;
    }
    for (let index = 0; index < after.length; index += 1) {
      if (after[index] !== before[index]) {
        return true;
      }
    }
    return false;
  }

  restore(files: CandidateFiles): void {
    if (Object.keys(files).length === 0) {
      return;
    }
    for (const fileName of Object.keys(files)) {
      const resolved = this.resolve(fileName);
      this.overlays.delete(resolved);
      this.bump(resolved);
    }
    this.cachedRoots = undefined;
    this.bumpProject();
  }

  resolve(fileName: string): string {
    const cached = this.resolvedPaths.get(fileName);
    if (cached !== undefined) {
      return cached;
    }
    const resolved = this.normalize(fileName);
    this.resolvedPaths.set(fileName, resolved);
    return resolved;
  }

  createHost(): ts.LanguageServiceHost {
    return {
      getCompilationSettings: (): ts.CompilerOptions => this.parsed.options,
      getProjectVersion: (): string => this.projectVersionText,
      getScriptFileNames: (): string[] => this.rootFileNames(),
      getScriptVersion: (fileName: string): string =>
        this.scriptVersions.get(this.resolve(fileName)) ?? "0",
      getScriptSnapshot: (fileName: string): ts.IScriptSnapshot | undefined =>
        this.snapshotFor(fileName),
      getCurrentDirectory: (): string => this.projectDir,
      getDefaultLibFileName: (options: ts.CompilerOptions): string =>
        ts.getDefaultLibFilePath(options),
      fileExists: (fileName: string): boolean => this.fileExists(fileName),
      readFile: (fileName: string): string | undefined => this.readFile(fileName),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
  }

  private bump(resolved: string): void {
    const next = Number(this.scriptVersions.get(resolved) ?? "0") + 1;
    this.scriptVersions.set(resolved, String(next));
    this.snapshots.delete(resolved);
  }

  private bumpProject(): void {
    this.projectVersion += 1;
    this.projectVersionText = String(this.projectVersion);
  }

  private snapshotFor(fileName: string): ts.IScriptSnapshot | undefined {
    const resolved = this.resolve(fileName);
    const version = this.scriptVersions.get(resolved) ?? "0";
    const cached = this.snapshots.get(resolved);
    if (cached !== undefined && cached.version === version) {
      return cached.snapshot;
    }
    const text = this.readResolved(resolved);
    if (text === undefined) {
      this.snapshots.delete(resolved);
      return undefined;
    }
    const snapshot = ts.ScriptSnapshot.fromString(text);
    this.snapshots.set(resolved, { version, snapshot });
    return snapshot;
  }

  private readFile(fileName: string): string | undefined {
    return this.readResolved(this.resolve(fileName));
  }

  private readResolved(resolved: string): string | undefined {
    const text = this.overlays.get(resolved);
    if (text !== undefined) {
      return text ?? undefined;
    }
    return ts.sys.readFile(resolved);
  }

  private fileExists(fileName: string): boolean {
    const resolved = this.resolve(fileName);
    const text = this.overlays.get(resolved);
    if (text !== undefined) {
      return text !== null;
    }
    return ts.sys.fileExists(resolved);
  }
}
