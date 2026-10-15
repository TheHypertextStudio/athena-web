import { describe, expect, it } from 'vitest';
import { blueprintFingerprint } from '../../src/lib/work-template-blueprints/fingerprint';

describe('blueprint review fingerprints', () => {
  it('normalizes object property order without changing array order', () => {
    expect(blueprintFingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(
      blueprintFingerprint({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(blueprintFingerprint([1, 2])).not.toBe(blueprintFingerprint([2, 1]));
  });
  it('binds actual timestamp values in database snapshots', () => {
    expect(blueprintFingerprint({ archivedAt: new Date('2026-10-08T00:00:00Z') })).not.toBe(
      blueprintFingerprint({ archivedAt: new Date('2026-10-09T00:00:00Z') }),
    );
    expect(blueprintFingerprint({ archivedAt: new Date('2026-10-08T00:00:00Z') })).toBe(
      blueprintFingerprint({ archivedAt: '2026-10-08T00:00:00.000Z' }),
    );
  });
});
