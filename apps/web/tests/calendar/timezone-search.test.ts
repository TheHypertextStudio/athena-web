import { describe, expect, it } from 'vitest';

import {
  buildTimezoneSearchIndex,
  searchTimezones,
} from '../../src/components/calendar/timezone-search';

const ZONES = ['America/Los_Angeles', 'America/Vancouver', 'Pacific/Pitcairn', 'America/New_York'];

describe('timezone search', () => {
  const entries = buildTimezoneSearchIndex('2026-08-10T17:00:00Z', 'en-US', ZONES);

  it('matches canonical identifiers and associated cities before partial results', () => {
    expect(searchTimezones(entries, 'America/Los_Angeles')[0]?.id).toBe('America/Los_Angeles');
    expect(searchTimezones(entries, 'Los Angeles')[0]?.id).toBe('America/Los_Angeles');
    expect(searchTimezones(entries, 'Vancouver')[0]?.id).toBe('America/Vancouver');
  });

  it('matches common names and known standard or daylight abbreviations', () => {
    expect(searchTimezones(entries, 'Pacific Time')[0]?.id).toBe('America/Los_Angeles');
    expect(searchTimezones(entries, 'PDT').map((entry) => entry.id)).toContain(
      'America/Los_Angeles',
    );
    expect(searchTimezones(entries, 'PST').map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['America/Los_Angeles', 'Pacific/Pitcairn']),
    );
  });

  it('shows the date-specific abbreviation and UTC offset', () => {
    expect(entries.find((entry) => entry.id === 'America/Los_Angeles')).toMatchObject({
      abbreviation: 'PDT',
      offsetLabel: 'UTC−7',
    });
  });

  it('returns no suggestions for a blank query and respects the result limit', () => {
    expect(searchTimezones(entries, '   ')).toEqual([]);
    expect(searchTimezones(entries, 'America', 2)).toHaveLength(2);
  });
});
