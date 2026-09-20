import { readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface ImplicitCreatedRoute {
  readonly file: string;
  readonly line: number;
  readonly postPath: string;
}

const ROUTES_DIRECTORY = resolve(import.meta.dirname, '../../src/routes');

function routeFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && extname(entry.name) === '.ts' ? [path] : [];
  });
}

function normalized(path: string): string {
  return path.replace(/:[^/]+/g, ':param').replace(/\/$/, '') || '/';
}

function literalRoutePath(node: ts.Node, method: 'get' | 'post'): string | null {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === method
    ) {
      const [path] = current.arguments;
      if (path && (ts.isStringLiteral(path) || ts.isNoSubstitutionTemplateLiteral(path))) {
        return path.text;
      }
    }
  }
  return null;
}

function routePaths(ast: ts.SourceFile, method: 'get' | 'post'): readonly string[] {
  const paths: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method
    ) {
      const [path] = node.arguments;
      if (path && (ts.isStringLiteral(path) || ts.isNoSubstitutionTemplateLiteral(path))) {
        paths.push(path.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return paths;
}

function implicitCreatedRoutes(file: string, source: string): ImplicitCreatedRoute[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const routes: ImplicitCreatedRoute[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'created' &&
      node.arguments.length < 4
    ) {
      const postPath = literalRoutePath(node, 'post');
      if (postPath) {
        routes.push({
          file,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          postPath,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return routes;
}

describe('created response route manifest', () => {
  it('auto-derives Location only when the same router exposes that member as a GET', () => {
    const failures: string[] = [];
    for (const file of routeFiles(ROUTES_DIRECTORY)) {
      const source = readFileSync(file, 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const getPaths = new Set(routePaths(ast, 'get').map(normalized));
      for (const route of implicitCreatedRoutes(file, source)) {
        const memberPath = normalized(
          route.postPath === '/' ? '/:id' : `${route.postPath.replace(/\/$/, '')}/:id`,
        );
        if (!getPaths.has(memberPath)) {
          failures.push(`${route.file}:${route.line} derives ${memberPath} without a matching GET`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
