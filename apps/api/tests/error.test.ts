import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z, type ZodError } from 'zod';

import type { AppEnv } from '../src/context';
import { publicProblemTitle } from '@docket/types';
import {
  ApiError,
  AuthError,
  BillingFrozenError,
  CapabilityError,
  ConflictError,
  CycleError,
  IdempotencyConflictError,
  InsufficientScopeError,
  NotFoundError,
  onError,
  ValidationError,
} from '../src/error';

// Touch the context type module so its (type-only) source counts as imported/covered.
import '../src/context';

/** Build a tiny app whose single route throws the given error, mapped by onError. */
function appThrowing(err: Error) {
  const app = new Hono<AppEnv>()
    .get('/', () => {
      throw err;
    })
    .onError(onError);
  return app;
}

describe('ApiError subclasses', () => {
  it('AuthError → 401 unauthorized (default + custom message)', () => {
    expect(new AuthError().status).toBe(401);
    expect(new AuthError().code).toBe('unauthorized');
    expect(new AuthError('nope').message).toBe('nope');
    expect(new AuthError().message).toBe('Authentication required');
  });

  it('CapabilityError → 403 forbidden', () => {
    const e = new CapabilityError();
    expect(e.status).toBe(403);
    expect(e.code).toBe('forbidden');
    expect(new CapabilityError('x').message).toBe('x');
  });

  it('InsufficientScopeError → 403 forbidden carrying the required scope', () => {
    const e = new InsufficientScopeError('work:write');
    expect(e.status).toBe(403);
    expect(e.code).toBe('forbidden');
    expect(e.requiredScope).toBe('work:write');
    expect(e.message).toContain('work:write');
    expect(new InsufficientScopeError('agents:run', 'custom msg').message).toBe('custom msg');
  });

  it('NotFoundError → 404 not_found', () => {
    const e = new NotFoundError();
    expect(e.status).toBe(404);
    expect(e.code).toBe('not_found');
    expect(new NotFoundError('gone').message).toBe('gone');
  });

  it('ConflictError → 409 with default + overridden code', () => {
    expect(new ConflictError().status).toBe(409);
    expect(new ConflictError().code).toBe('conflict');
    expect(new ConflictError('m', 'idempotency_key_reuse').code).toBe('idempotency_key_reuse');
  });

  it('CycleError → 409 dependency_cycle', () => {
    const e = new CycleError();
    expect(e.status).toBe(409);
    expect(e.code).toBe('dependency_cycle');
    expect(new CycleError('loop').message).toBe('loop');
  });

  it('IdempotencyConflictError → 422 idempotency_key_reuse', () => {
    const e = new IdempotencyConflictError();
    expect(e.status).toBe(422);
    expect(e.code).toBe('idempotency_key_reuse');
    expect(new IdempotencyConflictError('dup').message).toBe('dup');
  });

  it('BillingFrozenError → 402 card_required', () => {
    const e = new BillingFrozenError();
    expect(e.status).toBe(402);
    expect(e.code).toBe('card_required');
    expect(new BillingFrozenError('pay').message).toBe('pay');
  });

  it('ValidationError → 422 validation_error with fieldErrors', () => {
    const r = z.object({ a: z.string() }).safeParse({ a: 1 });
    const e = new ValidationError(r.error!);
    expect(e.status).toBe(422);
    expect(e.code).toBe('validation_error');
    expect(e.fieldErrors?.['a']).toBeDefined();
  });

  it('base ApiError carries the name of the concrete subclass', () => {
    expect(new AuthError().name).toBe('AuthError');
    const base = new ApiError(500, 'internal', 'boom');
    expect(base.name).toBe('ApiError');
  });
});

describe('onError mapping', () => {
  it('maps an ApiError to its problem shape (no fieldErrors)', async () => {
    const res = await appThrowing(new NotFoundError('Missing')).request('/');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'https://docket.dev/problems/not_found',
      title: publicProblemTitle('not_found'),
      status: 404,
      code: 'not_found',
    });
    expect('fieldErrors' in body).toBe(false);
  });

  it('maps a ValidationError to field paths without exposing validator prose', async () => {
    const privateDiagnostic = 'DATABASE_URL is missing';
    const r = z.object({ a: z.string(privateDiagnostic) }).safeParse({ a: 1 });
    const res = await appThrowing(new ValidationError(r.error!)).request('/');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { fieldErrors: Record<string, string[]> };
    expect(body.fieldErrors['a']).toEqual(['Invalid value.']);
    expect(JSON.stringify(body)).not.toContain(privateDiagnostic);
  });

  it('wraps a bare ZodError into a 422 ValidationError', async () => {
    const r = z.object({ a: z.string() }).safeParse({ a: 1 });
    const res = await appThrowing(r.error as ZodError).request('/');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('validation_error');
  });

  it('maps an unknown error to a generic 500 without exposing its message', async () => {
    const privateDiagnostic = 'AGENT_MAX_TURNS is not configured; refusing to run agent sessions';
    const res = await appThrowing(new Error(privateDiagnostic)).request('/');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; status: number; title: string };
    expect(body.code).toBe('internal');
    expect(body.status).toBe(500);
    expect(body.title).toBe(publicProblemTitle('internal'));
    expect(JSON.stringify(body)).not.toContain(privateDiagnostic);
  });
});
