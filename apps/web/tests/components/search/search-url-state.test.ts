import { describe, expect, it } from 'vitest';

import {
  parseSearchPageFilters,
  searchPageFiltersToHttpQuery,
  searchPageHref,
} from '@/components/search/search-url-state';

describe('search page URL state', () => {
  it('parses semantic filters while dropping invalid enum values', () => {
    const filters = parseSearchPageFilters(
      new URLSearchParams(
        'q=launch&families=work,nope&kinds=task,ghost&sources=slack,bogus&orgIds=org_1,org_2&from=2026-07-01T12%3A00%3A00.000Z&to=2026-07-03',
      ),
    );

    expect(filters).toEqual({
      query: 'launch',
      families: ['work'],
      kinds: ['task'],
      sources: ['slack'],
      orgIds: ['org_1', 'org_2'],
      fromDate: '2026-07-01',
      toDate: '2026-07-03',
    });
  });

  it('accepts the singular kind param used by detail links as a filter seed', () => {
    const filters = parseSearchPageFilters(new URLSearchParams('q=standup&kind=calendar_event'));

    expect(filters.kinds).toEqual(['calendar_event']);
  });

  it('serializes shareable plural filter params and clears stale cursor/detail params', () => {
    const href = searchPageHref('/search', new URLSearchParams('cursor=old&kind=task&id=cal_1'), {
      query: 'ship',
      families: ['work'],
      kinds: ['task', 'project'],
      sources: ['docket'],
      orgIds: ['org_1'],
      fromDate: '2026-07-01',
      toDate: '',
    });

    expect(href).toBe(
      '/search?q=ship&families=work&kinds=task%2Cproject&sources=docket&orgIds=org_1&from=2026-07-01',
    );
  });

  it('converts date filters to the API datetime range', () => {
    const filters = parseSearchPageFilters(
      new URLSearchParams('q=launch&from=2026-07-01&to=2026-07-02'),
    );
    const query = searchPageFiltersToHttpQuery(filters, { limit: 30, cursor: 'next' });

    expect(query).toMatchObject({
      q: 'launch',
      limit: '30',
      cursor: 'next',
      from: new Date(2026, 6, 1, 0, 0, 0, 0).toISOString(),
      to: new Date(2026, 6, 2, 23, 59, 59, 999).toISOString(),
    });
  });
});
