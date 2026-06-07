/**
 * `@docket/test-utils` — documentation-coverage harness.
 *
 * @remarks
 * Parses TypeScript source with the compiler API and reports every **exported
 * declaration** (function, class, interface, type alias, enum, exported const/var,
 * default export) that lacks a leading TSDoc block comment. The doc-coverage vitest
 * suite fails the build when this list is non-empty, enforcing 100% declaration
 * documentation across the workspace.
 */
import { readFileSync } from 'node:fs';

import ts from 'typescript';

/** One exported declaration that is missing a TSDoc comment. */
export interface UndocumentedDeclaration {
  /** Absolute path to the source file. */
  readonly file: string;
  /** The declared name(s) (comma-joined for multi-declarator statements). */
  readonly name: string;
  /** The TypeScript syntax kind (e.g. `FunctionDeclaration`). */
  readonly kind: string;
  /** 1-based line number of the declaration. */
  readonly line: number;
}

/** Whether a node carries the `export` modifier. */
function isExported(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

/** Whether a node has a leading JSDoc/TSDoc block comment. */
function hasDoc(node: ts.Node): boolean {
  return ts.getJSDocCommentsAndTags(node).some((d) => ts.isJSDoc(d));
}

/** 1-based line of a node's start within its source file. */
function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Record a top-level exported declaration if it lacks documentation. */
function collect(
  sf: ts.SourceFile,
  node: ts.Statement,
  file: string,
  out: UndocumentedDeclaration[],
): void {
  if (ts.isVariableStatement(node)) {
    if (!isExported(node) || hasDoc(node)) return;
    const name = node.declarationList.declarations.map((d) => d.name.getText(sf)).join(', ');
    out.push({ file, name, kind: 'VariableStatement', line: lineOf(sf, node) });
    return;
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    if (!isExported(node) || hasDoc(node)) return;
    const name = node.name ? node.name.getText(sf) : '(default)';
    out.push({ file, name, kind: ts.SyntaxKind[node.kind], line: lineOf(sf, node) });
  }
}

/**
 * Find every exported, top-level declaration in `files` that lacks a TSDoc comment.
 *
 * @param files - Absolute paths to `.ts`/`.tsx` source files (callers exclude tests).
 * @returns the undocumented declarations, empty when coverage is 100%.
 */
export function findUndocumentedDeclarations(files: readonly string[]): UndocumentedDeclaration[] {
  const out: UndocumentedDeclaration[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
    for (const stmt of sf.statements) collect(sf, stmt, file, out);
  }
  return out;
}
