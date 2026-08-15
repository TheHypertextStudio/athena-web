import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  collectWorkspacePackages,
  collectWorkspaceSourceFiles,
  relativeToWorkspaceRoot,
} from '../workspace';

const RETIRED_PACKAGE = '@docket/agent-runtime';

function moduleSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier
      : undefined;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return ts.isStringLiteralLike(node.moduleReference.expression)
      ? node.moduleReference.expression
      : undefined;
  }
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return undefined;
  const [argument] = node.arguments;
  if (!argument) return undefined;
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  return (isDynamicImport || isRequireCall) && ts.isStringLiteralLike(argument)
    ? argument
    : undefined;
}

function legacyRuntimeSpecifiers(sourceText: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    'source.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const references: string[] = [];

  function visit(node: ts.Node): void {
    const specifier = moduleSpecifier(node);
    if (specifier?.text === RETIRED_PACKAGE) references.push(specifier.text);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

describe('retired package policy', () => {
  it('recognizes real module references without matching prose', () => {
    const source = `
      // import { MockAgentTurnRuntime } from '@docket/agent-runtime';
      const documentation = "@docket/agent-runtime";
      import { MockAgentTurnRuntime } from '@docket/agent-runtime';
      const adapter = await import('@docket/agent-runtime');
      const legacy = require('@docket/agent-runtime');
    `;

    expect(legacyRuntimeSpecifiers(source)).toEqual([
      RETIRED_PACKAGE,
      RETIRED_PACKAGE,
      RETIRED_PACKAGE,
    ]);
  });

  it('keeps the retired package out of workspace manifests and shipped source', () => {
    const manifestReferences = collectWorkspacePackages()
      .flatMap(({ manifest, manifestPath }) => {
        const dependencySections = [
          manifest.dependencies,
          manifest.devDependencies,
          manifest.peerDependencies,
          manifest.optionalDependencies,
        ];
        const declaresPackage = manifest.name === RETIRED_PACKAGE;
        const dependsOnPackage = dependencySections.some((dependencies) =>
          Boolean(dependencies?.[RETIRED_PACKAGE]),
        );
        return declaresPackage || dependsOnPackage ? [relativeToWorkspaceRoot(manifestPath)] : [];
      })
      .sort();
    const sourceReferences = collectWorkspaceSourceFiles()
      .filter((filePath) =>
        legacyRuntimeSpecifiers(readFileSync(filePath, 'utf8')).includes(RETIRED_PACKAGE),
      )
      .map(relativeToWorkspaceRoot)
      .sort();

    expect(
      { manifestReferences, sourceReferences },
      'Move code to a deliberate Athena or Work subpath instead of restoring the old runtime barrel.',
    ).toEqual({ manifestReferences: [], sourceReferences: [] });
  });
});
