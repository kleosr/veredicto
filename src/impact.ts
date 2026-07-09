import ts from "typescript";
import type { Position } from "./verdict.js";

export interface SymbolSpan {
  file: string;
  name: string;
  position: Position | null;
  length: number;
}

export type ExportChangeKind = "added" | "removed" | "typeChanged";

export interface ExportChange {
  file: string;
  name: string;
  kind: ExportChangeKind;
  before: string | null;
  after: string | null;
  /** Use sites under the candidate overlay (def–use fan-out via findReferences). */
  references: SymbolSpan[];
}

export interface SemanticImpact {
  touchedFiles: string[];
  changedExports: ExportChange[];
}

export interface ExportSignature {
  file: string;
  name: string;
  typeText: string;
  position: Position | null;
  length: number;
}

function positionAt(sourceFile: ts.SourceFile, offset: number): Position {
  const location = sourceFile.getLineAndCharacterOfPosition(offset);
  return { line: location.line + 1, col: location.character + 1 };
}

function declarationSpan(
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
): { position: Position | null; length: number } {
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined) {
    return { position: null, length: 0 };
  }
  const nameNode = ts.getNameOfDeclaration(declaration);
  if (nameNode !== undefined) {
    return {
      position: positionAt(sourceFile, nameNode.getStart(sourceFile)),
      length: nameNode.getWidth(sourceFile),
    };
  }
  const start = declaration.getStart(sourceFile);
  return {
    position: positionAt(sourceFile, start),
    length: Math.max(0, declaration.getEnd() - start),
  };
}

function typeTextFor(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
): string {
  const location = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? sourceFile;
  if ((symbol.flags & ts.SymbolFlags.Value) !== 0) {
    return checker.typeToString(
      checker.getTypeOfSymbolAtLocation(symbol, location),
      sourceFile,
      ts.TypeFormatFlags.NoTruncation,
    );
  }
  return `type ${checker.typeToString(
    checker.getDeclaredTypeOfSymbol(symbol),
    sourceFile,
    ts.TypeFormatFlags.NoTruncation,
  )}`;
}

/**
 * Collect exported signatures for one source file using the checker.
 * Post-semantic facts layer — not a reimplementation of binding.
 */
export function collectExportSignatures(
  program: ts.Program,
  fileName: string,
): Map<string, ExportSignature> {
  const sourceFile = program.getSourceFile(fileName);
  const out = new Map<string, ExportSignature>();
  if (sourceFile === undefined) {
    return out;
  }
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    return out;
  }
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    const span = declarationSpan(symbol, sourceFile);
    out.set(name, {
      file: fileName,
      name,
      typeText: typeTextFor(checker, symbol, sourceFile),
      position: span.position,
      length: span.length,
    });
  }
  return out;
}

export function diffExportSignatures(
  before: Map<string, ExportSignature>,
  after: Map<string, ExportSignature>,
): Omit<ExportChange, "references">[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  const changes: Omit<ExportChange, "references">[] = [];
  for (const name of names) {
    const left = before.get(name);
    const right = after.get(name);
    if (left === undefined && right !== undefined) {
      changes.push({
        file: right.file,
        name,
        kind: "added",
        before: null,
        after: right.typeText,
      });
      continue;
    }
    if (left !== undefined && right === undefined) {
      changes.push({
        file: left.file,
        name,
        kind: "removed",
        before: left.typeText,
        after: null,
      });
      continue;
    }
    if (left !== undefined && right !== undefined && left.typeText !== right.typeText) {
      changes.push({
        file: right.file,
        name,
        kind: "typeChanged",
        before: left.typeText,
        after: right.typeText,
      });
    }
  }
  return changes;
}

export function referencesForExport(
  service: ts.LanguageService,
  signature: ExportSignature | undefined,
): SymbolSpan[] {
  if (signature === undefined || signature.position === null) {
    return [];
  }
  const program = service.getProgram();
  const sourceFile = program?.getSourceFile(signature.file);
  if (program === undefined || sourceFile === undefined) {
    return [];
  }
  const start = sourceFile.getPositionOfLineAndCharacter(
    signature.position.line - 1,
    signature.position.col - 1,
  );
  let found: readonly ts.ReferencedSymbol[] | undefined;
  try {
    found = service.findReferences(signature.file, start) ?? undefined;
  } catch {
    return [];
  }
  if (found === undefined) {
    return [];
  }
  const refs: SymbolSpan[] = [];
  for (const symbol of found) {
    for (const reference of symbol.references) {
      if (reference.isDefinition === true) {
        continue;
      }
      const refFile = program.getSourceFile(reference.fileName);
      if (refFile === undefined) {
        continue;
      }
      refs.push({
        file: reference.fileName,
        name: signature.name,
        position: positionAt(refFile, reference.textSpan.start),
        length: reference.textSpan.length,
      });
    }
  }
  return refs;
}

export function buildSemanticImpact(args: {
  touchedFiles: readonly string[];
  baselineByFile: ReadonlyMap<string, Map<string, ExportSignature>>;
  currentProgram: ts.Program;
  service: ts.LanguageService;
}): SemanticImpact {
  const changedExports: ExportChange[] = [];
  for (const fileName of args.touchedFiles) {
    const before = args.baselineByFile.get(fileName) ?? new Map<string, ExportSignature>();
    const after = collectExportSignatures(args.currentProgram, fileName);
    for (const diff of diffExportSignatures(before, after)) {
      const afterSig = after.get(diff.name);
      const references = diff.kind === "removed" ? [] : referencesForExport(args.service, afterSig);
      changedExports.push({ ...diff, references });
    }
  }
  return { touchedFiles: [...args.touchedFiles], changedExports };
}
