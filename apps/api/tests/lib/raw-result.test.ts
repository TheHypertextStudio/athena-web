import { describe, expect, it } from 'vitest';

import { rawResultRows, rawResultRowCount } from '../../src/lib/raw-result';

describe('rawResultRows', () => {
  it('returns an array-like result as-is', () => {
    expect(rawResultRows([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('reads the rows array off a driver result object', () => {
    expect(rawResultRows({ rows: [{ id: 1 }] })).toEqual([{ id: 1 }]);
  });

  it('returns empty for a non-object result', () => {
    // Every existing caller passes an actual driver result, so `typeof result !== 'object'` and
    // the `null` guard right after it were never exercised.
    expect(rawResultRows('not a result')).toEqual([]);
    expect(rawResultRows(null)).toEqual([]);
  });

  it('returns empty for an object with no rows property', () => {
    expect(rawResultRows({})).toEqual([]);
  });

  it('returns empty when rows is present but not an array', () => {
    expect(rawResultRows({ rows: 'not-an-array' })).toEqual([]);
  });
});

describe('rawResultRowCount', () => {
  it('counts the rows in a driver result', () => {
    expect(rawResultRowCount({ rows: [{}, {}, {}] })).toBe(3);
  });
});
