import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  collectPackageProductionEntrypointFiles,
  collectWorkspacePackages,
  collectWorkspaceSourceFiles,
  relativeToWorkspaceRoot,
  WORKSPACE_ROOT,
} from '../workspace';

const RETIRED_PACKAGE = '@docket/types';
const RETIRED_DIRECTORY = resolve(WORKSPACE_ROOT, 'packages/types');
const LOCKFILE = resolve(WORKSPACE_ROOT, 'pnpm-lock.yaml');

function staticModuleSpecifier(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : undefined;
  }
  if (ts.isImportTypeNode(node)) {
    return ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)
      ? node.argument.literal.text
      : undefined;
  }
  return undefined;
}

function callModuleSpecifier(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  if (!isDynamicImport && !isRequire) return undefined;
  const [argument] = node.arguments;
  return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined;
}

function moduleSpecifier(node: ts.Node): string | undefined {
  return staticModuleSpecifier(node) ?? callModuleSpecifier(node);
}

function packageSpecifiers(filePath: string): readonly string[] {
  const sourceText = readFileSync(filePath, 'utf8');
  if (!sourceText.includes(RETIRED_PACKAGE)) return [];
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifier(node);
    if (specifier) specifiers.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

describe('retired @docket/types package policy', () => {
  it('removes the retired workspace package and every manifest dependency', () => {
    const manifestReferences = collectWorkspacePackages().flatMap((workspacePackage) => {
      const dependencySections = [
        workspacePackage.manifest.dependencies,
        workspacePackage.manifest.devDependencies,
        workspacePackage.manifest.peerDependencies,
        workspacePackage.manifest.optionalDependencies,
      ];
      return dependencySections.some((section) => section?.[RETIRED_PACKAGE] !== undefined)
        ? [relativeToWorkspaceRoot(workspacePackage.manifestPath)]
        : [];
    });

    expect({
      directoryExists: existsSync(RETIRED_DIRECTORY),
      manifestReferences,
    }).toEqual({ directoryExists: false, manifestReferences: [] });
  });

  it('removes production imports and re-exports of the retired package', () => {
    const productionFiles = [
      ...collectWorkspaceSourceFiles(),
      ...collectWorkspacePackages().flatMap((workspacePackage) =>
        collectPackageProductionEntrypointFiles(
          workspacePackage.directory,
          workspacePackage.manifest,
        ),
      ),
    ];
    const references = productionFiles.flatMap((filePath) =>
      packageSpecifiers(filePath).some(
        (specifier) => specifier === RETIRED_PACKAGE || specifier.startsWith(`${RETIRED_PACKAGE}/`),
      )
        ? [relativeToWorkspaceRoot(filePath)]
        : [],
    );

    expect(references).toEqual([]);
  });

  it('removes the retired workspace importer and dependency from the lockfile', () => {
    const lockfile = readFileSync(LOCKFILE, 'utf8');
    expect(lockfile).not.toContain('packages/types:');
    expect(lockfile).not.toContain(`'${RETIRED_PACKAGE}':`);
  });
});
