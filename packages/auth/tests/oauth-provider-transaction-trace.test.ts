import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeAdapter = vi.hoisted(() => ({
  findMany: vi.fn(function (this: unknown, input?: unknown) {
    return { receiver: this, input };
  }),
  transaction: vi.fn(),
  label: 'adapter',
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => () => fakeAdapter,
}));

import { createDocketAuthDatabase } from '../src/oauth-provider-transaction';

const traceSymbol = Symbol.for('docket:test:oauth-adapter-trace');

describe('OAuth adapter tracing seam', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, traceSymbol);
    vi.clearAllMocks();
  });

  it('traces modeled adapter calls without changing receiver or return values', () => {
    const entries: unknown[] = [];
    Reflect.set(globalThis, traceSymbol, (entry: unknown) => entries.push(entry));
    const traced = createDocketAuthDatabase()({});

    expect(Reflect.get(traced, Symbol.toStringTag)).toBeUndefined();
    expect(traced.transaction).toBe(fakeAdapter.transaction);
    expect((traced.findMany as never as () => unknown)()).toEqual({
      receiver: fakeAdapter,
      input: undefined,
    });
    expect((traced.findMany as never as (input: unknown) => unknown)({ model: 42 })).toEqual({
      receiver: fakeAdapter,
      input: { model: 42 },
    });
    expect(
      (traced.findMany as never as (input: unknown) => unknown)({ model: 'oauthClient' }),
    ).toEqual({ receiver: fakeAdapter, input: { model: 'oauthClient' } });
    expect(entries).toEqual([
      expect.objectContaining({ kind: 'base', method: 'findMany' }),
      expect.objectContaining({ kind: 'base', method: 'findMany' }),
      expect.objectContaining({ kind: 'base', method: 'findMany', model: 'oauthClient' }),
    ]);
  });
});
