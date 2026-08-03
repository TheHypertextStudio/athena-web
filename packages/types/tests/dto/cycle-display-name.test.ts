/**
 * `@docket/types` — the cycle default-naming scheme.
 *
 * @remarks
 * `defaultCycleName` is the single documented answer to "what is an unnamed cycle called". It runs
 * on the API (deriving `CycleOut.displayName`), during SSR, and in the browser, so it is pinned to
 * `en-US` + UTC. These tests hold that pin: the UTC-boundary case below fails under the previous
 * local-zone formatting for every process running behind UTC — which is what made one cycle render
 * "Jul 26" in the list and "Jul 27" in its properties panel on the same screen.
 */
import { describe, expect, it, vi } from 'vitest';

import { CycleOut, defaultCycleName } from '../../src/cycle';

/**
 * The host's mutable environment, reached without depending on Node's type definitions.
 *
 * @remarks
 * `@docket/types` is a platform-neutral DTO package and deliberately carries no `@types/node`, so
 * `process` is not in scope for `tsc`. The zone regression below can only be exercised by moving
 * the host zone, hence this narrow, explicitly-typed accessor rather than widening the package's
 * type surface.
 */
const hostEnv = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env;

/** A window start that is UTC midnight — i.e. the previous evening anywhere in the Americas. */
const UTC_MIDNIGHT_START = '2026-07-27T00:00:00.000Z';
/** The matching auto-rolled end: one millisecond before the next window opens. */
const UTC_WINDOW_END = '2026-08-02T23:59:59.999Z';

describe('defaultCycleName', () => {
  it('renders a same-year window without years', () => {
    expect(defaultCycleName(UTC_MIDNIGHT_START, UTC_WINDOW_END)).toBe('Jul 27 – Aug 2');
  });

  it('carries the year on both ends when the window crosses a year boundary', () => {
    expect(defaultCycleName('2026-12-28T00:00:00.000Z', '2027-01-03T23:59:59.999Z')).toBe(
      'Dec 28, 2026 – Jan 3, 2027',
    );
  });

  it('renders a single-day window as that day on both ends', () => {
    expect(defaultCycleName('2026-07-27T00:00:00.000Z', '2026-07-27T23:59:59.999Z')).toBe(
      'Jul 27 – Jul 27',
    );
  });

  it('accepts Date instances as well as ISO strings', () => {
    expect(defaultCycleName(new Date(UTC_MIDNIGHT_START), new Date(UTC_WINDOW_END))).toBe(
      'Jul 27 – Aug 2',
    );
  });

  it('joins the two ends with a spaced en dash', () => {
    expect(defaultCycleName(UTC_MIDNIGHT_START, UTC_WINDOW_END)).toContain(' – ');
  });

  it('names the window by its UTC calendar days even in a zone behind UTC', async () => {
    // Honolulu is UTC-10 with no DST, so `2026-07-27T00:00:00.000Z` is 2pm on Jul *26* there. The
    // module's formatters are built once at evaluation time, so the zone has to be in place BEFORE
    // the import — hence the reset + dynamic import. Drop the `timeZone: 'UTC'` pin and this
    // returns "Jul 26 – Aug 2", which is exactly the list-vs-properties contradiction it guards.
    const original = hostEnv['TZ'];
    hostEnv['TZ'] = 'Pacific/Honolulu';
    vi.resetModules();
    try {
      const fresh = await import('../../src/cycle');
      expect(fresh.defaultCycleName(UTC_MIDNIGHT_START, UTC_WINDOW_END)).toBe('Jul 27 – Aug 2');
    } finally {
      if (original === undefined) delete hostEnv['TZ'];
      else hostEnv['TZ'] = original;
      vi.resetModules();
    }
  });
});

describe('CycleOut.displayName', () => {
  const base = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    teamId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    number: 1_000_137,
    startsAt: UTC_MIDNIGHT_START,
    endsAt: UTC_WINDOW_END,
    status: 'active' as const,
    createdAt: UTC_MIDNIGHT_START,
  };

  it('is required, so no read can forget to derive it', () => {
    expect(CycleOut.safeParse({ ...base, name: null }).success).toBe(false);
  });

  it('round-trips the window name for an unnamed cycle', () => {
    const parsed = CycleOut.parse({
      ...base,
      name: null,
      displayName: defaultCycleName(base.startsAt, base.endsAt),
    });
    expect(parsed.displayName).toBe('Jul 27 – Aug 2');
    expect(parsed.displayName).not.toMatch(/Cycle \d{5,}/);
  });

  it('keeps `name` nullable — it stays the author-set name a rename writes', () => {
    const parsed = CycleOut.parse({ ...base, name: null, displayName: 'Jul 27 – Aug 2' });
    expect(parsed.name).toBeNull();
  });
});
