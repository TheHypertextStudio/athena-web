import { describe, expect, it } from 'vitest';

import { API_VERSION, parseApiVersion, assertProductionRevision } from '../../src/api-version';

describe('public contract assertion', () => {
  it('keeps unpinned clients on the current contract', () => {
    expect(parseApiVersion(null)).toBe(API_VERSION);
    expect(parseApiVersion(API_VERSION)).toBe(API_VERSION);
  });

  it.each([
    '',
    ' ',
    '0.0.9',
    '9.0.0',
    'nope',
    'latest',
    '^0.1',
    '1',
    `${API_VERSION}, ${API_VERSION}`,
    `${API_VERSION}, 9.0.0`,
    ` ${API_VERSION}`,
    `${API_VERSION} `,
  ])('refuses an unsupported assertion %j instead of selecting another contract', (value) => {
    expect(parseApiVersion(value)).toBeNull();
  });

  it.each([undefined, '', 'dev', 'abc1234', 'g'.repeat(40)])(
    'prevents production from claiming an unverifiable revision %j',
    (revision) => {
      expect(() => {
        assertProductionRevision(revision);
      }).toThrow();
    },
  );

  it('accepts a complete Git revision independently of package versions', () => {
    expect(() => {
      assertProductionRevision('a'.repeat(40));
    }).not.toThrow();
    expect(() => {
      assertProductionRevision('ABCDEF0123'.repeat(4));
    }).not.toThrow();
  });
});
