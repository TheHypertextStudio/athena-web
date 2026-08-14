import { describe, expect, it, vi } from 'vitest';

// A minimal `Response`: this asserts what the query *asks for*, so the body only has to be
// well-formed enough for the read to resolve.
const okResponse = () => ({ ok: true, status: 200, json: async () => ({ date: '2026-08-12' }) });

vi.mock('@/lib/api', () => ({
  api: { v1: { hub: { highlights: { $get: vi.fn(async () => okResponse()) } } } },
}));

const { dayHighlightsDef } = await import('@/components/activity/use-day-highlights');
const { api } = await import('@/lib/api');

describe('dayHighlightsDef', () => {
  it('lets the server decide which day is today', async () => {
    // The client used to compute today from the browser clock and send it. That disagrees with the
    // person's Hub timezone whenever they travel or set their zone to somewhere they are not — and
    // asking for the browser's today from a zone behind it asks for a day that has not happened,
    // which the API correctly refuses. So the panel simply stopped naming the day.
    const def = dayHighlightsDef();
    await def.queryFn?.({} as never);

    expect(api.v1.hub.highlights.$get).toHaveBeenCalledWith({ query: {} });
  });

  it('sends a day the person actually chose', async () => {
    const def = dayHighlightsDef('2026-08-01');
    await def.queryFn?.({} as never);

    expect(api.v1.hub.highlights.$get).toHaveBeenCalledWith({ query: { date: '2026-08-01' } });
  });

  it('keys today under one name, whichever surface asked for it', () => {
    // `/today`'s entry and the review panel both mean "today" and neither names it, so they share a
    // cache entry: arriving at the review from the entry renders from cache instead of re-fetching
    // the same day under a different key.
    expect(dayHighlightsDef().queryKey).toEqual(dayHighlightsDef().queryKey);
    expect(dayHighlightsDef().queryKey).not.toEqual(dayHighlightsDef('2026-08-01').queryKey);
  });
});
