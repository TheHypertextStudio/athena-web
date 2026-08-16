import { describe, expect, it } from 'vitest';

import { providerErrorKind, providerErrorKindForStatus } from '../src/provider-error';

describe('providerErrorKind', () => {
  it('reads the kind a classified provider error carries', () => {
    // The sync spine records this so a failed connection can say what sort of failure it hit
    // instead of only that one happened. Every kind has to survive the round trip.
    for (const kind of ['auth', 'rate_limit', 'network', 'provider', 'unknown'] as const) {
      expect(providerErrorKind({ kind })).toBe(kind);
    }
  });

  it('calls anything it cannot classify unknown rather than guessing', () => {
    // A bug in our own reconcile code is not a provider failure, and labelling it one would put
    // "reconnect Notion" in front of somebody whose connection is fine.
    expect(providerErrorKind(new TypeError('cannot read properties of undefined'))).toBe('unknown');
    expect(providerErrorKind({ kind: 'something-else' })).toBe('unknown');
    expect(providerErrorKind(null)).toBe('unknown');
    expect(providerErrorKind('a string')).toBe('unknown');
    expect(providerErrorKind(undefined)).toBe('unknown');
  });

  it('agrees with the status classifier, so both paths record the same kind', () => {
    // One failure can arrive either as a thrown classified error or as a bare status, and the two
    // must not disagree — the copy the reader sees is keyed on whichever landed.
    for (const status of [401, 403]) {
      expect(providerErrorKindForStatus(status)).toBe('auth');
      expect(providerErrorKind({ kind: providerErrorKindForStatus(status) })).toBe('auth');
    }
    expect(providerErrorKindForStatus(429)).toBe('rate_limit');
    expect(providerErrorKindForStatus(500)).toBe('provider');
  });
});
