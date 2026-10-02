import ts from "typescript";

const GLOBAL_AUGMENT = /declare\s+(?:global|module)\b/;
const MODULE_SYNTAX = /\b(?:import|export)\b/;

export function forcesWholeProgram(text: string): boolean {
  return GLOBAL_AUGMENT.test(text) || !MODULE_SYNTAX.test(text);
}

export function directImporters(
  program: ts.Program,
  rootFiles: readonly string[],
  normalize: (fileName: string) => string,
): Map<string, readonly string[]> {
  const canonical = new Map<string, string>();
  for (const fileName of rootFiles) {
    canonical.set(normalize(fileName), fileName);
  }
  const importers = new Map<string, Set<string>>();
  const cache = ts.createModuleResolutionCache(
    program.getCurrentDirectory(),
    canonicalFileName(ts.sys.useCaseSensitiveFileNames),
    program.getCompilerOptions(),
  );
  for (const fileName of rootFiles) {
    const sourceFile = program.getSourceFile(fileName);
    if (sourceFile === undefined) {
      continue;
    }
    recordSpecifiers(program, sourceFile, fileName, cache, canonical, normalize, importers);
  }
  return new Map([...importers].map(([fileName, dependents]) => [fileName, [...dependents]]));
}

export function dependentClosure(
  importers: ReadonlyMap<string, readonly string[]>,
  seeds: readonly string[],
): Set<string> {
  const dirty = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const fileName = queue.pop();
    if (fileName === undefined || dirty.has(fileName)) {
      continue;
    }
    dirty.add(fileName);
    const dependents = importers.get(fileName);
    if (dependents === undefined) {
      continue;
    }
    for (const dependent of dependents) {
      queue.push(dependent);
    }
  }
  return dirty;
}

function canonicalFileName(caseSensitive: boolean): (fileName: string) => string {
  if (caseSensitive) {
    return (fileName: string): string => fileName;
  }
  return (fileName: string): string => fileName.toLowerCase();
}

function recordSpecifiers(
  program: ts.Program,
  sourceFile: ts.SourceFile,
  importer: string,
  cache: ts.ModuleResolutionCache,
  canonical: Map<string, string>,
  normalize: (fileName: string) => string,
  importers: Map<string, Set<string>>,
): void {
  for (const specifier of moduleSpecifiers(sourceFile)) {
    const resolved = ts.resolveModuleName(
      specifier,
      sourceFile.fileName,
      program.getCompilerOptions(),
      ts.sys,
      cache,
    ).resolvedModule?.resolvedFileName;
    if (resolved === undefined) {
      continue;
    }
    const target = canonical.get(normalize(resolved));
    if (target === undefined) {
      continue;
    }
    const dependents = importers.get(target);
    if (dependents === undefined) {
      importers.set(target, new Set([importer]));
    } else {
      dependents.add(importer);
    }
  }
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = specifierOf(node);
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function specifierOf(node: ts.Node): string | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments[0] !== undefined &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    return node.arguments[0].text;
  }
  return undefined;
}
