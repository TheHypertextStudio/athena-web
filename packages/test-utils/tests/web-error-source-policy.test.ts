import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { relativeToWorkspaceRoot, WORKSPACE_ROOT } from './workspace';

type ErrorSourceRule = 'legacy-string-reader' | 'provider-diagnostic' | 'raw-error-message';

interface ErrorSourceViolation {
  readonly column: number;
  readonly file: string;
  readonly line: number;
  readonly rule: ErrorSourceRule;
  readonly text: string;
}

const PRODUCTION_SOURCE_ROOTS = ['apps/web/src', 'apps/admin/src'] as const;

/**
 * The only production files permitted to inspect an Error message directly.
 *
 * These modules are trust boundaries: they discard arbitrary input and return application-owned
 * copy. Adding an exemption requires adding another central classifier here; component, page, and
 * feature-hook paths are never valid exemptions.
 */
const RAW_MESSAGE_BOUNDARIES = new Set([
  'apps/admin/src/lib/problem.ts',
  'apps/web/src/lib/problem.ts',
  'apps/web/src/lib/query-core.ts',
]);

const LEGACY_STRING_READERS = new Set(['readError', 'readProblem']);
const PROVIDER_DIAGNOSTIC_PROPERTIES = new Set(['error_description', 'lastError']);

function collectSourceFiles(directory: string): string[] {
  const entries = ts.sys.readDirectory(directory, ['.ts', '.tsx'], undefined, undefined);
  return entries.filter((path) => !/\.(?:test|spec)\.tsx?$/.test(path) && !path.endsWith('.d.ts'));
}

function propertyName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function bindingPropertyName(node: ts.Node): string | undefined {
  if (!ts.isBindingElement(node)) return undefined;
  const property = node.propertyName ?? node.name;
  if (ts.isIdentifier(property) || ts.isStringLiteralLike(property)) return property.text;
  if (ts.isComputedPropertyName(property) && ts.isStringLiteralLike(property.expression)) {
    return property.expression.text;
  }
  return undefined;
}

function describeNode(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120);
}

function scanSource(filePath: string, sourceText: string): ErrorSourceViolation[] {
  const relativePath = relativeToWorkspaceRoot(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: ErrorSourceViolation[] = [];

  function report(node: ts.Node, rule: ErrorSourceRule): void {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({
      column: location.character + 1,
      file: relativePath,
      line: location.line + 1,
      rule,
      text: describeNode(node, sourceFile),
    });
  }

  function visit(node: ts.Node): void {
    const name = propertyName(node);
    const diagnosticName = name ?? bindingPropertyName(node);

    if (name === 'message' && !RAW_MESSAGE_BOUNDARIES.has(relativePath)) {
      report(node, 'raw-error-message');
    }
    if (diagnosticName && PROVIDER_DIAGNOSTIC_PROPERTIES.has(diagnosticName)) {
      report(node, 'provider-diagnostic');
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      LEGACY_STRING_READERS.has(node.expression.text)
    ) {
      report(node, 'legacy-string-reader');
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function formatViolations(violations: readonly ErrorSourceViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.file}:${violation.line}:${violation.column} ` +
        `[${violation.rule}] ${violation.text}`,
    )
    .join('\n');
}

describe('web error source policy', () => {
  it('detects every forbidden raw-error ingress syntax', () => {
    const fixture = `
      const a = query.error.message;
      const b = query.error?.['message'];
      const c = provider.lastError;
      const d = body['error_description'];
      const { lastError } = provider;
      const { lastError: storedDiagnostic } = provider;
      const { ['lastError']: computedDiagnostic } = provider;
      const { error_description } = body;
      const { error_description: providerDescription } = body;
      const { ['error_description']: computedProviderDescription } = body;
      const { message } = applicationCopy;
      readProblem(response, 'fallback');
      readError(caught, 'fallback');
    `;

    const violations = scanSource(resolve(WORKSPACE_ROOT, 'apps/web/src/fixture.ts'), fixture);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'raw-error-message' }),
        expect.objectContaining({ rule: 'provider-diagnostic' }),
        expect.objectContaining({ rule: 'legacy-string-reader' }),
        expect.objectContaining({ rule: 'provider-diagnostic', text: 'lastError' }),
        expect.objectContaining({
          rule: 'provider-diagnostic',
          text: 'lastError: storedDiagnostic',
        }),
        expect.objectContaining({
          rule: 'provider-diagnostic',
          text: "['lastError']: computedDiagnostic",
        }),
        expect.objectContaining({ rule: 'provider-diagnostic', text: 'error_description' }),
        expect.objectContaining({
          rule: 'provider-diagnostic',
          text: 'error_description: providerDescription',
        }),
        expect.objectContaining({
          rule: 'provider-diagnostic',
          text: "['error_description']: computedProviderDescription",
        }),
      ]),
    );
    expect(violations).toHaveLength(12);
    expect(violations).not.toContainEqual(
      expect.objectContaining({ rule: 'raw-error-message', text: 'message' }),
    );
  });

  it('keeps raw server, provider, and exception messages out of production UI source', () => {
    const violations = PRODUCTION_SOURCE_ROOTS.flatMap((root) =>
      collectSourceFiles(resolve(WORKSPACE_ROOT, root)).flatMap((file) =>
        scanSource(file, readFileSync(file, 'utf8')),
      ),
    );

    expect(
      violations,
      [
        'Production UI may render only application-owned error copy.',
        'Use userErrorMessage(error, fallback) for caught/query errors and readProblemError for responses.',
        'Provider diagnostics and legacy string readers belong only in central classifiers.',
        formatViolations(violations),
      ].join('\n'),
    ).toEqual([]);
  });
});
