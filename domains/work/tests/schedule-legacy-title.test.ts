import { expect, it } from 'vitest';
import { renderLegacyScheduleTitle } from '../src/schedule-legacy-title';
it('retains padded legacy month, full date and monthName instead of native token meanings', () => {
  expect(
    renderLegacyScheduleTitle('Dinner {month} {year}: {date}, {monthName}', '2026-03-04'),
  ).toBe('Dinner 03 2026: 2026-03-04, March');
});
it('preserves unknown/unbalanced and doubled braces literally except the four legacy replacements', () => {
  expect(renderLegacyScheduleTitle(' {{month}} {owner} {unfinished', '2026-09-08')).toBe(
    ' {09} {owner} {unfinished',
  );
});
it('does not trim the literal title while rendering legacy tokens', () => {
  expect(renderLegacyScheduleTitle('  Dinner {month}  ', '2026-01-02')).toBe('  Dinner 01  ');
});

it('rejects invalid saved dates and rendered titles beyond the ordinary work limit without truncation', () => {
  expect(() => renderLegacyScheduleTitle('{date}', '2026-02-30')).toThrow();
  expect(() => renderLegacyScheduleTitle(' '.repeat(3), '2026-03-04')).toThrow();
  expect(() => renderLegacyScheduleTitle('A'.repeat(115) + '{monthName}', '2026-09-08')).toThrow();
});
