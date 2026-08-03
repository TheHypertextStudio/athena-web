/**
 * `asRecord`/`str`/`optionalJsonResponse`/`firstString` — the tiny JSON-narrowing helpers real
 * adapters use to defensively walk `unknown` provider payloads. Exercised directly (rather than
 * only incidentally through an adapter) so every narrowing branch is proven, including the ones
 * a well-behaved provider never actually hits.
 */
import { describe, expect, it } from 'vitest';

import { asRecord, firstString, optionalJsonResponse, str } from '../../src/json';

describe('asRecord', () => {
  it('returns the value for a plain object', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it('returns undefined for null, arrays, and primitives', () => {
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord(['x'])).toEqual(['x']); // arrays are typeof 'object' and non-null
    expect(asRecord('string')).toBeUndefined();
    expect(asRecord(42)).toBeUndefined();
    expect(asRecord(undefined)).toBeUndefined();
  });
});

describe('str', () => {
  it('reads a string field off a record', () => {
    expect(str({ code: 'invalid_token' }, 'code')).toBe('invalid_token');
  });

  it('returns undefined for a missing key, non-string value, or an absent record', () => {
    expect(str({ code: 42 }, 'code')).toBeUndefined();
    expect(str({}, 'code')).toBeUndefined();
    expect(str(undefined, 'code')).toBeUndefined();
  });
});

describe('optionalJsonResponse', () => {
  it('parses a well-formed JSON body', async () => {
    const res = new Response(JSON.stringify({ id: '1' }), { status: 200 });
    expect(await optionalJsonResponse(res)).toEqual({ id: '1' });
  });

  it('returns undefined for an empty body', async () => {
    const res = new Response('', { status: 200 });
    expect(await optionalJsonResponse(res)).toBeUndefined();
  });

  it('returns undefined for an unparseable body rather than throwing', async () => {
    const res = new Response('not json<!>', { status: 200 });
    expect(await optionalJsonResponse(res)).toBeUndefined();
  });
});

describe('firstString', () => {
  it('returns the first present non-empty key in order', () => {
    expect(firstString({ error: 'nope', code: 'invalid_token' }, ['code', 'error'])).toBe(
      'invalid_token',
    );
  });

  it('skips an empty-string field and falls through to the next key', () => {
    expect(firstString({ id: '', messageId: 'm_1' }, ['id', 'messageId'])).toBe('m_1');
  });

  it('returns undefined when no key matches or the value is not a record', () => {
    expect(firstString({ other: 'x' }, ['id', 'messageId'])).toBeUndefined();
    expect(firstString(null, ['id'])).toBeUndefined();
  });
});
