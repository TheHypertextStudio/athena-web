import { describe, expect, it } from 'vitest';

import { negotiateMediaType } from '../../src/lib/media-types';

describe('negotiateMediaType', () => {
  it('lets a specific refusal override an acceptable wildcard', () => {
    expect(negotiateMediaType('application/json;q=0, */*;q=1', ['application/json'])).toBeNull();
  });

  it('selects an offered representation by quality after applying specificity', () => {
    expect(
      negotiateMediaType('application/json;q=0.4, text/event-stream;q=0.9', [
        'application/json',
        'text/event-stream',
      ]),
    ).toBe('text/event-stream');
  });

  it('accepts a missing header and media types case-insensitively', () => {
    expect(negotiateMediaType(undefined, ['application/json'])).toBe('application/json');
    expect(negotiateMediaType('APPLICATION/JSON', ['application/json'])).toBe('application/json');
  });

  it('does not treat a different structured-suffix type as JSON', () => {
    expect(negotiateMediaType('application/problem+json', ['application/json'])).toBeNull();
    expect(negotiateMediaType('application/vnd.example+json', ['application/json'])).toBeNull();
  });

  it('handles SSE and binary offers without granting JSON implicitly', () => {
    expect(negotiateMediaType('text/event-stream', ['text/event-stream'])).toBe(
      'text/event-stream',
    );
    expect(negotiateMediaType('image/*', ['image/png', 'image/jpeg'])).toBe('image/png');
    expect(negotiateMediaType('application/json', ['application/pdf'])).toBeNull();
  });

  it('rejects malformed and wholly refused ranges', () => {
    expect(negotiateMediaType('application/json;q=0, text/*;q=0', ['application/json'])).toBeNull();
    expect(negotiateMediaType('not-a-media-range', ['application/json'])).toBeNull();
  });
});

describe('retained media negotiation regressions', () => {
  it.each([
    '*/json',
    'application/json;charset',
    'application/json;=utf-8',
    'application/json;q=2',
    'application/json;q=0.5555',
  ])('refuses malformed ranges: %s', (accept) => {
    expect(negotiateMediaType(accept, ['application/json'])).toBeNull();
  });
  it('preserves quoted commas while honoring a representation refusal', () => {
    expect(
      negotiateMediaType('text/plain;note="a,b";q=0, application/json', [
        'text/plain',
        'application/json',
      ]),
    ).toBe('application/json');
  });
  it('treats a blank header as missing and skips invalid offers during matching', () => {
    expect(negotiateMediaType('   ', ['text/csv', 'application/json'])).toBe('text/csv');
    expect(negotiateMediaType('*/*', ['not-a-type', 'application/json'])).toBe('application/json');
    expect(negotiateMediaType('application/json', [])).toBeNull();
  });
});
