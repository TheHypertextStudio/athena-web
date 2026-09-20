import { readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import ts from 'typescript';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { onError } from '../../src/error';
import { accepted, created } from '../../src/lib/ok';

const Result = z.object({ id: z.string() });
const ROUTES_DIRECTORY = resolve(import.meta.dirname, '../../src/routes');

function routeFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && extname(entry.name) === '.ts' ? [path] : [];
  });
}

function enclosingRoute(node: ts.Node): ts.CallExpression | null {
  return (
    ts.findAncestor(
      node.parent,
      (current): current is ts.CallExpression =>
        ts.isCallExpression(current) &&
        ts.isPropertyAccessExpression(current.expression) &&
        ['get', 'post', 'put', 'patch', 'delete'].includes(current.expression.name.text),
    ) ?? null
  );
}

function legacyDocumentedStatuses(route: ts.CallExpression): readonly number[] | null {
  const annotation = route.arguments.find(
    (argument): argument is ts.CallExpression =>
      ts.isCallExpression(argument) &&
      ts.isIdentifier(argument.expression) &&
      argument.expression.text === 'apiDoc',
  );
  const options = annotation?.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return null;
  const status = options.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'status',
  )?.initializer;
  if (!status) return [200];
  const values = ts.isArrayLiteralExpression(status) ? status.elements : [status];
  return values.flatMap((value) =>
    ts.isNumericLiteral(value) ? [Number.parseInt(value.text, 10)] : [],
  );
}

function undocumentedAcceptedCalls(file: string): readonly string[] {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const failures: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'accepted'
    ) {
      const route = enclosingRoute(node);
      const statuses = route ? legacyDocumentedStatuses(route) : null;
      if (!statuses?.includes(202)) {
        const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
        failures.push(`${file}:${String(line)} returns 202 without documenting it`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return failures;
}

describe('created and accepted response locations', () => {
  it('requires an absolute monitor URL for accepted work', async () => {
    const app = new Hono()
      .get('/jobs/:id', (c) =>
        accepted(c, Result, { id: c.req.param('id') }, c.req.query('monitor') ?? ''),
      )
      .onError(onError);

    const invalid = await app.request('/jobs/job_1');
    expect(invalid.status).toBe(500);
    expect(await invalid.json()).toMatchObject({ code: 'internal', status: 500 });

    const location = 'https://api.docket.localhost/v1/jobs/job_1';
    const valid = await app.request(`/jobs/job_1?monitor=${encodeURIComponent(location)}`);
    expect(valid.status).toBe(202);
    expect(valid.headers.get('location')).toBe(location);
  });

  it('omits Location for a created result that has no address', async () => {
    const app = new Hono().post('/commands', (c) => created(c, Result, { id: 'result_1' }, null));

    const response = await app.request('/commands', { method: 'POST' });

    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBeNull();
  });

  it('documents every accepted response as 202', () => {
    expect(routeFiles(ROUTES_DIRECTORY).flatMap(undocumentedAcceptedCalls)).toEqual([]);
  });
});
