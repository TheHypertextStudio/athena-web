import { readFileSync, readdirSync } from 'node:fs';
import { basename, posix, relative, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');
const SCHEDULING_ROOT = resolve(WEB_ROOT, 'src/components/scheduling');
const FORBIDDEN_PATH_SEGMENTS = new Set([
  'agenda',
  'calendar',
  'task',
  'task-detail',
  'tasks',
  'work-location',
  'work-locations',
]);

interface SchedulingSource {
  readonly path: string;
  readonly text: string;
}

/** Convert a source path to the separator used by module declarations. */
function normalizePath(path: string): string {
  return path.split(sep).join('/').replaceAll('\\', '/');
}

/** Recursively discover shared scheduling TypeScript sources. */
function discoverSchedulingSources(directory: string): readonly SchedulingSource[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): readonly SchedulingSource[] => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) return discoverSchedulingSources(absolutePath);
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
      return [
        {
          path: normalizePath(relative(WEB_ROOT, absolutePath)),
          text: readFileSync(absolutePath, 'utf8'),
        },
      ];
    });
}

/** Resolve an internal module specifier to its web source path when possible. */
function resolveInternalModule(sourcePath: string, specifier: string): string | null {
  const normalizedSpecifier = normalizePath(specifier).replace(/\.(?:tsx?|jsx?)$/, '');
  if (normalizedSpecifier.startsWith('@/')) {
    return posix.normalize(`src/${normalizedSpecifier.slice(2)}`);
  }
  if (normalizedSpecifier.startsWith('.')) {
    return posix.normalize(posix.join(posix.dirname(sourcePath), normalizedSpecifier));
  }
  return null;
}

/** Return whether a parsed module boundary belongs to a forbidden scheduling consumer domain. */
function isForbiddenSchedulingModule(sourcePath: string, specifier: string): boolean {
  if (specifier === '@docket/work' || specifier.startsWith('@docket/work/')) return true;
  const resolvedModule = resolveInternalModule(sourcePath, specifier);
  if (!resolvedModule) return false;
  if (resolvedModule.split('/').some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    return true;
  }
  return (
    resolvedModule.startsWith('src/lib/') && /(^|[-_.])task([-_.]|$)/.test(basename(resolvedModule))
  );
}

/** Return the literal module specifier represented by one import or re-export AST node. */
function moduleSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier
      : undefined;
  }
  if (ts.isImportTypeNode(node)) {
    return ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)
      ? node.argument.literal
      : undefined;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return ts.isStringLiteralLike(node.moduleReference.expression)
      ? node.moduleReference.expression
      : undefined;
  }
  if (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  ) {
    const argument = node.arguments[0];
    return argument && ts.isStringLiteralLike(argument) ? argument : undefined;
  }
  return undefined;
}

/** Report forbidden domain imports from one shared scheduling source. */
function forbiddenSchedulingImports(source: SchedulingSource): readonly string[] {
  const sourceFile = ts.createSourceFile(
    source.path,
    source.text,
    ts.ScriptTarget.Latest,
    true,
    source.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifier(node);
    if (specifier && isForbiddenSchedulingModule(source.path, specifier.text)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        specifier.getStart(sourceFile),
      );
      violations.push(`${source.path}:${line + 1}:${character + 1} ${specifier.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

describe('shared scheduling import boundaries', () => {
  it('does not import calendar, agenda, task, or work-location domain modules', () => {
    const violations = discoverSchedulingSources(SCHEDULING_ROOT).flatMap(
      forbiddenSchedulingImports,
    );

    expect(violations).toEqual([]);
  });

  it.each([
    ['calendar alias', `import type { CalendarItem } from '@/components/calendar/types';`],
    ['agenda relative path', `export * from '../agenda/agenda-context';`],
    ['task package', `type Task = import('@docket/work/task-contract').Task;`],
    ['work-location dynamic import', `const data = import('@/components/work-location/data');`],
  ])('detects a forbidden %s import from parsed module syntax', (_label, text) => {
    expect(
      forbiddenSchedulingImports({
        path: 'src/components/scheduling/example.ts',
        text,
      }),
    ).not.toEqual([]);
  });

  it('ignores domain words that are not module boundaries', () => {
    expect(
      forbiddenSchedulingImports({
        path: 'src/components/scheduling/example.ts',
        text: `export const label = 'Calendar task agenda work-location';`,
      }),
    ).toEqual([]);
  });
});
