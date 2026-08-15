import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { onError, ValidationError } from '../../src/error';
import { ok } from '../../src/lib/ok';
import { zJson, zParam, zQuery } from '../../src/lib/validate';
import { assertDefined } from '@docket/test-utils';

const Schema = z.object({ name: z.string() });

/** Runtime-bad payload shaped as unchecked JSON, modeling a contract drift boundary. */
function contractDriftBody(): z.input<typeof Schema> {
  return JSON.parse('{"name":123}');
}

describe('ok', () => {
  it('parses (validating) the body in non-production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const app = new Hono().get('/', (c) => ok(c, Schema, { name: 'a' }));
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'a' });
  });

  it('answers a contract drift with a 500 that names nothing internal', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const app = new Hono().get('/', (c) => ok(c, Schema, contractDriftBody())).onError(onError);
    const res = await app.request('/');
    // A response that does not match its own schema is a server bug, not the caller's fault. It
    // used to escape as a bare ZodError, which `onError` renders as a 422 whose `fieldErrors` are
    // keyed by the *output* schema's internal paths — misleading and disclosive at once.
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('internal');
    expect(body).not.toHaveProperty('fieldErrors');
    expect(JSON.stringify(body)).not.toContain('name');
  });

  it('validates in production too, so extra fields cannot ride along', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = new Hono().get('/', (c) =>
      ok(c, Schema, { name: 'a', secret: 'leaked' } as z.input<typeof Schema>),
    );
    const res = await app.request('/');
    expect(res.status).toBe(200);
    // Production used to skip the parse entirely. Because the `*Out` schemas are non-strict, the
    // dev and test path *stripped* undeclared keys and passed, so a handler that had accidentally
    // been given a raw database row was green in CI and served the whole row in production.
    expect(await res.json()).toEqual({ name: 'a' });
  });

  it('rejects a production response that does not satisfy its schema', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = new Hono().get('/', (c) => ok(c, Schema, contractDriftBody())).onError(onError);
    expect((await app.request('/')).status).toBe(500);
  });
});

describe('validate', () => {
  it('zJson returns parsed body on success', async () => {
    const app = new Hono()
      .post('/', zJson(Schema), (c) => c.json(c.req.valid('json')))
      .onError(onError);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ok' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'ok' });
  });

  it('zJson throws ValidationError (422) on failure', async () => {
    const app = new Hono().post('/', zJson(Schema), (c) => c.json({})).onError(onError);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 1 }),
    });
    expect(res.status).toBe(422);
  });

  it('zQuery returns parsed query on success and 422 on failure', async () => {
    const QuerySchema = z.object({ q: z.string().min(1) });
    const app = new Hono()
      .get('/', zQuery(QuerySchema), (c) => c.json(c.req.valid('query')))
      .onError(onError);
    const ok1 = await app.request('/?q=hi');
    expect(ok1.status).toBe(200);
    expect(await ok1.json()).toEqual({ q: 'hi' });

    const bad = await app.request('/?q=');
    expect(bad.status).toBe(422);
  });

  it('zParam returns parsed params on success and 422 on failure', async () => {
    const ParamSchema = z.object({ id: z.string().regex(/^\d+$/) });
    const app = new Hono()
      .get('/:id', zParam(ParamSchema), (c) => c.json(c.req.valid('param')))
      .onError(onError);
    const ok1 = await app.request('/42');
    expect(ok1.status).toBe(200);
    expect(await ok1.json()).toEqual({ id: '42' });

    const bad = await app.request('/abc');
    expect(bad.status).toBe(422);
  });

  it('ValidationError aggregates issues by path with the `_` root key', () => {
    const result = z.object({ a: z.string() }).safeParse(123);
    expect(result.success).toBe(false);
    const err = new ValidationError(assertDefined(result.error));
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_error');
    // A top-level (root) issue lands under the `_` key.
    expect(err.fieldErrors?.['_']).toBeDefined();
  });
});
