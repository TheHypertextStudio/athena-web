/**
 * One-off migration: rewrite the TypeScript non-null assertion operator
 * (`X!`, `X!.y`) in test files to `assertDefined(X)` / `assertDefined(X).y`,
 * so the `@typescript-eslint/no-non-null-assertion` test-file exemption in
 * `tooling/eslint-config/index.js` can be removed.
 *
 * Uses the TypeScript compiler API to find `ts.NonNullExpression` nodes
 * precisely (unlike a text/regex scan, this can't be confused by `!==`,
 * GraphQL SDL `!`, Tailwind's `!important`, or `let x!: T` definite-
 * assignment assertions — none of those parse as `NonNullExpression`).
 * Every other span of the file is copied verbatim from the source text, so
 * formatting/comments outside the rewritten spans are untouched.
 *
 * Usage:
 *   tsx scripts/codemod-non-null-assertions.ts <package-dir> [--check]
 *
 * Without `--check`, rewrites matching files in place and ensures each
 * touched file imports `assertDefined` from `@docket/test-utils` (or, inside
 * `packages/test-utils` itself, from the relative `../../src/assert` path,
 * to avoid a self-import through the package name).
 *
 * With `--check`, only reports remaining `NonNullExpression` nodes and exits
 * non-zero if any are found — used to verify a package is fully migrated.
 *
 * Delete this file once the migration (see the plan file referenced in the
 * originating conversation) is complete across every package.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

const TEST_FILE_RE = /\.(test|spec)\.tsx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'drizzle']);

/** Recursively collect every file under `dir` matching the migration's target globs. */
function collectTargetFiles(dir: string): string[] {
  const results: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      const isE2eHelper =
        full.includes(`${join('e2e', 'helpers')}/`) || full.includes(`e2e/helpers/`);
      if (TEST_FILE_RE.test(entry) || (isE2eHelper && entry.endsWith('.ts'))) {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results;
}

/**
 * Rebuild the source text for `node`'s span, recursively replacing every
 * `NonNullExpression` with `assertDefined(<inner>)` and copying every other
 * character verbatim from `sourceText`.
 */
function rebuild(node: ts.Node, sourceFile: ts.SourceFile, sourceText: string): string {
  if (ts.isNonNullExpression(node)) {
    return `assertDefined(${rebuild(node.expression, sourceFile, sourceText)})`;
  }
  const children: ts.Node[] = [];
  node.forEachChild((child) => {
    children.push(child);
  });
  if (children.length === 0) {
    return sourceText.slice(node.getStart(sourceFile), node.getEnd());
  }
  let result = '';
  // A plain `getStart()` skips leading trivia — fine for nested nodes, since
  // the parent's own gap-slice (below) already carries a child's leading
  // comment. But for the top-level SourceFile there is no parent slice to
  // carry it, so `getStart()` would skip straight past a file-leading
  // doc-comment, silently dropping it (and, worse, desyncing every
  // downstream position `insertImport` computes against the *original*
  // source once `rebuilt` is shorter than it should be).
  let cursor = ts.isSourceFile(node) ? 0 : node.getStart(sourceFile);
  for (const child of children) {
    result += sourceText.slice(cursor, child.getStart(sourceFile));
    let childText = rebuild(child, sourceFile, sourceText);
    // `new Ctor!(args)` relies on `!` binding inside `new`'s callee without
    // introducing call-parens; `assertDefined(Ctor)` is itself a call
    // expression, which — unparenthesized — would prematurely end the
    // callee's member-expression chain and get reparsed as `new
    // assertDefined(Ctor)` (constructing `assertDefined`) followed by a
    // trailing call. Force parens around the callee whenever a substitution
    // happened anywhere inside it.
    if (ts.isNewExpression(node) && child === node.expression) {
      const originalChildText = sourceText.slice(child.getStart(sourceFile), child.getEnd());
      if (childText !== originalChildText) {
        childText = `(${childText})`;
      }
    }
    result += childText;
    cursor = child.getEnd();
  }
  result += sourceText.slice(cursor, node.getEnd());
  return result;
}

/** Count every `NonNullExpression` node in `sourceFile`, regardless of nesting. */
function countNonNullExpressions(sourceFile: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isNonNullExpression(node)) count++;
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return count;
}

/** Whether `filePath` already imports `assertDefined` from any specifier. */
function hasAssertDefinedImport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((el) => el.name.text === 'assertDefined'),
  );
}

/** Insert `import { assertDefined } from '<specifier>';` after the last existing import (or at the top). */
function insertImport(text: string, sourceFile: ts.SourceFile, specifier: string): string {
  const importStatements = sourceFile.statements.filter(ts.isImportDeclaration);
  const importLine = `import { assertDefined } from '${specifier}';\n`;
  if (importStatements.length === 0) {
    return importLine + text;
  }
  const lastImport = importStatements[importStatements.length - 1];
  const insertPos = lastImport.getEnd();
  return text.slice(0, insertPos) + '\n' + importLine.trimEnd() + text.slice(insertPos);
}

/** The `assertDefined` import specifier a file at `filePath` under `pkgDir` should use. */
function specifierFor(filePath: string, pkgDir: string): string {
  const isTestUtilsPackage = pkgDir.endsWith(join('packages', 'test-utils'));
  if (!isTestUtilsPackage) return '@docket/test-utils';
  const depth = relative(pkgDir, filePath).split('/').length - 1;
  return `${'../'.repeat(depth)}src/assert`;
}

function main() {
  const [pkgDirArg, ...flags] = process.argv.slice(2);
  const checkOnly = flags.includes('--check');
  if (!pkgDirArg) {
    console.error('Usage: tsx scripts/codemod-non-null-assertions.ts <package-dir> [--check]');
    process.exit(1);
  }
  const pkgDir = pkgDirArg.replace(/\/$/, '');
  const files = collectTargetFiles(pkgDir);

  let filesChanged = 0;
  let totalReplacements = 0;
  const remaining: string[] = [];

  for (const filePath of files) {
    const sourceText = readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const count = countNonNullExpressions(sourceFile);
    if (count === 0) continue;

    if (checkOnly) {
      remaining.push(`${filePath} (${count})`);
      continue;
    }

    let rebuilt = rebuild(sourceFile, sourceFile, sourceText);
    if (!hasAssertDefinedImport(sourceFile)) {
      rebuilt = insertImport(rebuilt, sourceFile, specifierFor(filePath, pkgDir));
    }
    writeFileSync(filePath, rebuilt, 'utf8');
    filesChanged++;
    totalReplacements += count;
  }

  if (checkOnly) {
    if (remaining.length === 0) {
      console.log(`OK — no remaining non-null assertions under ${pkgDir}`);
      process.exit(0);
    }
    console.error(`Remaining non-null assertions under ${pkgDir}:`);
    for (const line of remaining) console.error(`  ${line}`);
    process.exit(1);
  }

  console.log(
    `${pkgDir}: rewrote ${totalReplacements} assertion(s) across ${filesChanged} file(s).`,
  );
}

main();
