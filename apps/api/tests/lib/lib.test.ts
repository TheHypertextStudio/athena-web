import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { onError, ValidationError } from '../../src/error';
import { ok } from '../../src/lib/ok';
import { zJson, zParam, zQuery } from '../../src/lib/validate';

const Schema = z.object({ name: z.string() });

/** Runtime-bad payload shaped as unchecked JSON, modeling a contract drift boundary. */
function contractDriftBody(): z.input<typeof Schema> {
  return JSON.parse('{"name":123}');
}

describe('ok', () => {
  it('parses (validating) the body in non-production', async () => {
    process.env['NODE_ENV'] = 'test';
    const app = new Hono().get('/', (c) => ok(c, Schema, { name: 'a' }));
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'a' });
  });

  it('throws on contract drift in non-production (schema.parse path)', async () => {
    process.env['NODE_ENV'] = 'test';
    const app = new Hono().get('/', (c) => ok(c, Schema, contractDriftBody())).onError(onError);
    const res = await app.request('/');
    // The parse failure is a ZodError, mapped by onError to a 422 problem.
    expect(res.status).toBe(422);
  });

  it('trusts the data without parsing in production', async () => {
    process.env['NODE_ENV'] = 'production';
    try {
      const app = new Hono().get('/', (c) =>
        // A value the schema would reject; production skips the parse and returns it raw.
        ok(c, Schema, contractDriftBody()),
      );
      const res = await app.request('/');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ name: 123 });
    } finally {
      process.env['NODE_ENV'] = 'test';
    }
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
    const err = new ValidationError(result.error!);
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_error');
    // A top-level (root) issue lands under the `_` key.
    expect(err.fieldErrors?.['_']).toBeDefined();
  });
});
