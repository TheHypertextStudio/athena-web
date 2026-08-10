/**
 * Production source policy for the global object-creation cutover.
 *
 * @remarks
 * Rendered command and composer tests cover request and completion behavior. This policy walks the
 * complete production TypeScript tree so a new launcher cannot restore a page-owned supported
 * dialog, local modal state, or creation query bridge outside the originally inventoried paths.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');
const SOURCE_ROOT = resolve(WEB_ROOT, 'src');

interface ProductionSource {
  readonly path: string;
  readonly text: string;
}

interface ComposeOccurrence {
  readonly path: string;
  readonly offset: number;
  readonly text: string;
}

/** Convert a discovered source path to the separator used by source-policy declarations. */
function normalizeSourcePath(path: string): string {
  return path.split(sep).join('/').replaceAll('\\', '/');
}

/** Recursively discover every production TypeScript source below a directory. */
function discoverProductionSources(directory: string): readonly ProductionSource[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): readonly ProductionSource[] => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) return discoverProductionSources(absolutePath);
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
      return [
        {
          path: normalizeSourcePath(relative(WEB_ROOT, absolutePath)),
          text: readFileSync(absolutePath, 'utf8'),
        },
      ];
    });
}

const PRODUCTION_SOURCES = discoverProductionSources(SOURCE_ROOT);
const OWNER_DIALOG_BY_FILE = new Map<string, string>([
  ['src/components/tasks/create-task.tsx', 'CreateTaskDialog'],
  ['src/components/projects/create-project.tsx', 'CreateProjectDialog'],
  ['src/components/initiatives/create-initiative.tsx', 'CreateInitiativeDialog'],
  ['src/components/programs/create-program.tsx', 'CreateProgramDialog'],
  ['src/components/teams/create-team.tsx', 'CreateTeamDialog'],
]);
const SUPPORTED_DIALOGS = new Set(OWNER_DIALOG_BY_FILE.values());
const OWNER_DIALOG_BY_MODULE = new Map(
  [...OWNER_DIALOG_BY_FILE].map(([path, dialog]) => [path.replace(/\.tsx$/, ''), dialog]),
);
const SUPPORTED_CREATE_MODULE_BASENAMES = new Set(
  [...OWNER_DIALOG_BY_MODULE.keys()].map((path) => posix.basename(path)),
);
const INITIATIVE_CLIENT = 'src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx';

/** Resolve a source module specifier to the supported dialog it exposes, when applicable. */
function supportedDialogForModule(sourcePath: string, moduleSpecifier: string): string | undefined {
  const normalizedSpecifier = normalizeSourcePath(moduleSpecifier).replace(/\.(?:tsx?|jsx?)$/, '');
  let modulePath: string | undefined;

  if (normalizedSpecifier.startsWith('@/')) {
    modulePath = `src/${normalizedSpecifier.slice(2)}`;
  } else if (normalizedSpecifier.startsWith('.')) {
    modulePath = posix.normalize(
      posix.join(posix.dirname(normalizeSourcePath(sourcePath)), normalizedSpecifier),
    );
  }

  return modulePath ? OWNER_DIALOG_BY_MODULE.get(modulePath) : undefined;
}

/** Return the supported dialog identifier represented by an AST name, when applicable. */
function supportedDialogName(name: ts.Node | undefined): string | undefined {
  if (!name || !ts.isIdentifier(name) || !SUPPORTED_DIALOGS.has(name.text)) return undefined;
  return name.text;
}

/** Return the terminal identifier in a JSX tag such as `dialogs.CreateTaskDialog`. */
function terminalJsxTagName(name: ts.JsxTagNameExpression): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) return name.name.text;
  if (ts.isJsxNamespacedName(name)) return name.name.text;
  return undefined;
}

/** Report syntax-aware supported-dialog ownership violations for one production source. */
function findSupportedDialogViolations(entry: ProductionSource): readonly string[] {
  const path = normalizeSourcePath(entry.path);
  const canContainSupportedDialogSyntax =
    [...SUPPORTED_DIALOGS].some((dialog) => entry.text.includes(dialog)) ||
    [...SUPPORTED_CREATE_MODULE_BASENAMES].some((module) => entry.text.includes(module));
  if (!canContainSupportedDialogSyntax) return [];

  const allowedDialog = OWNER_DIALOG_BY_FILE.get(path);
  const sourceFile = ts.createSourceFile(
    path,
    entry.text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];

  const report = (dialog: string | undefined, action: string, node: ts.Node): void => {
    if (!dialog || dialog === allowedDialog) return;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push(`${path}:${line + 1}:${character + 1} ${action} ${dialog}`);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const importClause = node.importClause;
      if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        report(
          supportedDialogForModule(path, node.moduleSpecifier.text),
          'imports namespace exposing',
          node,
        );
      }
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const specifier of importClause.namedBindings.elements) {
          const names = new Set([
            supportedDialogName(specifier.propertyName),
            supportedDialogName(specifier.name),
          ]);
          for (const dialog of names) report(dialog, 'imports', specifier);
        }
      }
    }

    if (ts.isExportDeclaration(node)) {
      const moduleDialog =
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? supportedDialogForModule(path, node.moduleSpecifier.text)
          : undefined;
      if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) {
        report(moduleDialog, 're-exports namespace exposing', node);
      } else {
        for (const specifier of node.exportClause.elements) {
          const names = new Set([
            supportedDialogName(specifier.propertyName),
            supportedDialogName(specifier.name),
          ]);
          for (const dialog of names) report(dialog, 're-exports', specifier);
        }
      }
    }

    if (ts.isVariableDeclaration(node)) {
      report(supportedDialogName(node.name), 'defines', node);
    } else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      report(supportedDialogName(node.name), 'defines', node);
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const dialog = terminalJsxTagName(node.tagName);
      report(dialog && SUPPORTED_DIALOGS.has(dialog) ? dialog : undefined, 'mounts', node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

/** Find every literal occurrence of the creation query marker. */
function findComposeOccurrences(
  entries: readonly ProductionSource[],
): readonly ComposeOccurrence[] {
  return entries.flatMap((entry) => {
    const occurrences: ComposeOccurrence[] = [];
    for (const match of entry.text.matchAll(/compose=1/g)) {
      occurrences.push({
        path: normalizeSourcePath(entry.path),
        offset: match.index,
        text: entry.text,
      });
    }
    return occurrences;
  });
}

/** Check that a query occurrence is the true branch of the Initiative update-link conditional. */
function isInitiativeUpdateComposeOccurrence(occurrence: ComposeOccurrence): boolean {
  if (normalizeSourcePath(occurrence.path) !== INITIATIVE_CLIENT) return false;
  const sourceFile = ts.createSourceFile(
    occurrence.path,
    occurrence.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  let literal: ts.StringLiteralLike | undefined;
  const findLiteral = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) &&
      node.getStart(sourceFile) <= occurrence.offset &&
      occurrence.offset < node.getEnd()
    ) {
      literal = node;
      return;
    }
    ts.forEachChild(node, findLiteral);
  };
  findLiteral(sourceFile);
  if (!literal?.text.includes('?tab=updates&compose=1')) return false;

  const parentNode = (node: ts.Node): ts.Node | undefined =>
    ts.isSourceFile(node) ? undefined : node.parent;
  let ancestor = parentNode(literal);
  while (ancestor) {
    if (ts.isConditionalExpression(ancestor)) {
      const condition = ancestor.condition;
      const actionIsUpdate =
        ts.isBinaryExpression(condition) &&
        condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isPropertyAccessExpression(condition.left) &&
        ts.isIdentifier(condition.left.expression) &&
        condition.left.expression.text === 'item' &&
        condition.left.name.text === 'action' &&
        ts.isStringLiteral(condition.right) &&
        condition.right.text === 'update';
      const literalIsTrueBranch =
        ancestor.whenTrue.getStart(sourceFile) <= literal.getStart(sourceFile) &&
        literal.getEnd() <= ancestor.whenTrue.getEnd();
      return actionIsUpdate && literalIsTrueBranch;
    }
    ancestor = parentNode(ancestor);
  }

  return false;
}

describe('global creation launcher source policy', () => {
  it('recursively inventories the complete production TypeScript tree', () => {
    const paths = PRODUCTION_SOURCES.map((entry) => entry.path);

    expect(paths.length).toBeGreaterThan(700);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('src/components/create-object/create-object-provider.tsx');
    expect(paths).toContain('src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx');
    expect(paths.every((path) => path.startsWith('src/') && /\.tsx?$/.test(path))).toBe(true);
  });

  it('has no supported creation URL bridge anywhere in production', () => {
    for (const entry of PRODUCTION_SOURCES) {
      expect(entry.text, entry.path).not.toContain('useComposeRequest');
      expect(entry.text, entry.path).not.toContain('composeHref');
    }
    expect(existsSync(resolve(SOURCE_ROOT, 'components/composer/use-compose-param.ts'))).toBe(
      false,
    );
  });

  it('mounts or imports supported dialogs only inside their five owning implementations', () => {
    for (const entry of PRODUCTION_SOURCES) {
      expect(findSupportedDialogViolations(entry), entry.path).toEqual([]);
    }
  });

  it.each([
    [
      'a multiline aliased named import',
      `import {
        CreateTaskDialog as RenamedTaskDialog,
      } from '@/components/tasks/create-task';`,
    ],
    [
      'a namespace import from a supported create module',
      `import * as dialogs from '@/components/tasks/create-task';`,
    ],
    [
      'a star re-export from a supported create module',
      `export * from '@/components/projects/create-project';`,
    ],
    [
      'a namespace re-export from a supported create module',
      `export * as initiativeDialogs from '@/components/initiatives/create-initiative';`,
    ],
    [
      'an aliased named re-export',
      `export { CreateProgramDialog as ProgramCreator } from '@/components/programs/create-program';`,
    ],
    ['a qualified supported dialog mount', `const view = <dialogs.CreateTeamDialog open />;`],
  ])('rejects %s outside an owner', (_label, text) => {
    expect(
      findSupportedDialogViolations({
        path: 'src/components/example-launcher.tsx',
        text,
      }),
    ).not.toEqual([]);
  });

  it.each([
    ['a foreign definition', `export const CreateProjectDialog = () => null;`],
    ['a foreign mount', `const view = <CreateProjectDialog open />;`],
    [
      'a foreign import',
      `import { CreateProjectDialog } from '@/components/projects/create-project';`,
    ],
  ])('rejects %s inside a supported dialog owner', (_label, text) => {
    expect(
      findSupportedDialogViolations({
        path: 'src/components/tasks/create-task.tsx',
        text,
      }),
    ).not.toEqual([]);
  });

  it('allows an owner to define and mount only its own supported dialog', () => {
    expect(
      findSupportedDialogViolations({
        path: 'src/components/tasks/create-task.tsx',
        text: `
          export const CreateTaskDialog = () => null;
          const view = <CreateTaskDialog open />;
        `,
      }),
    ).toEqual([]);
  });

  it('normalizes synthetic Windows paths before comparing dialog owners', () => {
    expect(
      findSupportedDialogViolations({
        path: 'src\\components\\tasks\\create-task.tsx',
        text: `
          export const CreateTaskDialog = () => null;
          const view = <CreateTaskDialog open />;
        `,
      }),
    ).toEqual([]);
  });

  it('continues allowing AppShell to import global composer hosts', () => {
    expect(
      findSupportedDialogViolations({
        path: 'src/components/app-shell-frame.tsx',
        text: `import { GlobalTaskComposer } from '@/components/tasks/create-task';`,
      }),
    ).toEqual([]);
  });

  it('has no page-owned supported-kind modal state patterns', () => {
    for (const entry of PRODUCTION_SOURCES) {
      expect(entry.text, entry.path).not.toMatch(
        /\b(?:createOpen|setCreateOpen|taskComposerOpen|setTaskComposerOpen)\b/,
      );
    }
  });

  it('allows only the Initiative update composer compose query', () => {
    const occurrences = findComposeOccurrences(PRODUCTION_SOURCES);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0] && isInitiativeUpdateComposeOccurrence(occurrences[0])).toBe(true);
  });

  it('counts two compose query literals that occur on the same source line', () => {
    const occurrences = findComposeOccurrences([
      {
        path: 'src/components/example-launcher.tsx',
        text: `const links = ['?compose=1', '?compose=1'];`,
      },
    ]);

    expect(occurrences).toHaveLength(2);
  });

  it('requires the compose query to be inside the Initiative update link expression', () => {
    const [occurrence] = findComposeOccurrences([
      {
        path: 'src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx',
        text: `const isUpdate = item.action === 'update'; const href = '?tab=updates&compose=1';`,
      },
    ]);

    expect(occurrence && isInitiativeUpdateComposeOccurrence(occurrence)).toBe(false);
  });
});
