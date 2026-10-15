import { describe, expect, it } from 'vitest';
import { ScheduleTitlePattern, renderScheduleTitlePattern } from '../src/schedule-title-pattern';

describe('schedule title patterns', () => {
  it('renders approved civil-date tokens across month, year, leap and quarter boundaries', () => {
    expect(renderScheduleTitlePattern('{month} Dinner', '2026-10-08')).toBe('October Dinner');
    expect(renderScheduleTitlePattern('{day}/{month_number}/{year} Q{quarter}', '2028-02-29')).toBe(
      '29/2/2028 Q1',
    );
    expect(renderScheduleTitlePattern('{month} {year} Q{quarter}', '2027-01-01')).toBe(
      'January 2027 Q1',
    );
    expect(renderScheduleTitlePattern('Q{quarter} {month}', '2026-12-31')).toBe('Q4 December');
  });
  it('escapes braces as literal text and never evaluates expressions', () => {
    expect(renderScheduleTitlePattern('{{month}} {month} {{}}', '2026-10-08')).toBe(
      '{month} October {}',
    );
    for (const value of ['{unknown}', '{month', 'month}', '{year+1}', '{month.toUpperCase()}'])
      expect(ScheduleTitlePattern.safeParse(value).success).toBe(false);
  });
  it('rejects blank and oversized authored patterns or rendered titles rather than truncating', () => {
    expect(ScheduleTitlePattern.safeParse(' '.repeat(2)).success).toBe(false);
    expect(ScheduleTitlePattern.safeParse('x'.repeat(257)).success).toBe(false);
    expect(() => renderScheduleTitlePattern('x'.repeat(121), '2026-10-08')).toThrow();
    expect(renderScheduleTitlePattern('x'.repeat(120), '2026-10-08')).toHaveLength(120);
    expect(() => renderScheduleTitlePattern('{month} '.repeat(20), '2026-09-01')).toThrow();
  });
  it('uses an actual valid ordinary civil date without timezone or clock coercion', () => {
    expect(() => renderScheduleTitlePattern('{day}', '2026-02-29')).toThrow();
    expect(() => renderScheduleTitlePattern('{day}', '2026-10-08T00:00:00Z')).toThrow();
    expect(() => renderScheduleTitlePattern('{day}', '2300-01-01')).toThrow();
  });
});
