import { describe, expect, it } from 'vitest';
import { hashScheduleArchive, serializeScheduleArchive } from '../../src/work-schedule-archive';

describe('frozen schedule archive serialization', () => {
  it('hashes recursively ordered object keys independently of insertion order', () => {
    expect(hashScheduleArchive({ z: [2, { z: null, a: 'Private' }], a: 1 })).toBe(
      hashScheduleArchive({ a: 1, z: [2, { a: 'Private', z: null }] }),
    );
    expect(serializeScheduleArchive({ b: true, a: 1 })).toBe('{"a":1,"b":true}');
  });
  it('preserves ordered arrays and rejects non JSON data', () => {
    expect(hashScheduleArchive([1, 2])).not.toBe(hashScheduleArchive([2, 1]));
    expect(() => serializeScheduleArchive(undefined)).toThrow('unsupported');
  });
});
