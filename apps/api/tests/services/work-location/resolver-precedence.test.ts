/**
 * Work-location resolution precedence — which piece of evidence wins, and when Docket refuses to
 * guess.
 *
 * @remarks
 * This resolver answers "where is this person working" from four kinds of evidence that routinely
 * disagree: declared assertions, location-bound work blocks, live observations, and the Time
 * Ledger. Every rule here exists to keep a wrong answer from looking like a confident one — an
 * unlocated block in the middle of the day makes a bridge ambiguous, an observation pointing at a
 * place that no longer exists must not resolve to it, and a tie between two equally-scoped
 * assertions has to break the same way every time or the answer flickers between renders.
 *
 * The state is plain data, so these assert the decisions rather than any storage behavior.
 */
import { describe, expect, it } from 'vitest';
import { WorkPlaceId } from '@docket/types';

import {
  resolveExpectedWorkLocationRange,
  resolveWorkLocationPoint,
  type WorkLocationResolutionState,
} from '../../../src/services/work-location/resolver';

const LIBRARY = {
  id: WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  name: 'Main library',
} as const;
const STUDIO = {
  id: WorkPlaceId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
  name: 'Editing studio',
} as const;
/** A place id no state below lists, for the "referenced but missing" arms. */
const MISSING = WorkPlaceId.parse('01BX5ZZKBKACTAV9WEVGEMMVS9');

function state(overrides: Partial<WorkLocationResolutionState> = {}): WorkLocationResolutionState {
  return {
    timezone: 'America/Los_Angeles',
    places: [LIBRARY, STUDIO],
    assertions: [],
    workBlocks: [],
    observations: [],
    activeTimeContexts: [],
    ...overrides,
  };
}

/** A one-off all-day assertion covering 2026-08-12 local. */
function allDay(over: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    placeId: LIBRARY.id,
    revision: 1,
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    exceptions: [],
    schedule: {
      type: 'one_off_all_day' as const,
      date: '2026-08-12',
      timezone: 'America/Los_Angeles',
    },
    ...over,
  };
}

/** A one-off timed assertion covering 09:00–17:00 local on 2026-08-12. */
function timed(over: Record<string, unknown> = {}) {
  return {
    id: 'a-timed',
    placeId: STUDIO.id,
    revision: 1,
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    exceptions: [],
    schedule: {
      type: 'one_off_timed' as const,
      startsAt: '2026-08-12T16:00:00.000Z',
      endsAt: '2026-08-13T00:00:00.000Z',
      timezone: 'America/Los_Angeles',
    },
    ...over,
  };
}

const NOON = new Date('2026-08-12T19:00:00.000Z');

/** Expected resolution at local noon on 2026-08-12. */
function expectedAt(resolutionState: WorkLocationResolutionState, at: Date = NOON) {
  return resolveWorkLocationPoint({ at, state: resolutionState }).expected;
}

describe('which assertion wins', () => {
  it('prefers a timed assertion over an all-day one covering the same instant', () => {
    // The narrower declaration is the more specific statement of intent.
    const result = expectedAt(state({ assertions: [allDay(), timed()] as never }));
    expect(result.place?.id).toBe(STUDIO.id);
  });

  it('prefers the higher revision when scope is equal', () => {
    const result = expectedAt(
      state({
        assertions: [
          allDay({ id: 'old', revision: 1, placeId: LIBRARY.id }),
          allDay({ id: 'new', revision: 7, placeId: STUDIO.id }),
        ] as never,
      }),
    );
    expect(result.place?.id).toBe(STUDIO.id);
  });

  it('prefers the more recently updated when revisions match', () => {
    const result = expectedAt(
      state({
        assertions: [
          allDay({ id: 'stale', updatedAt: new Date('2026-08-01T00:00:00.000Z') }),
          allDay({
            id: 'fresh',
            placeId: STUDIO.id,
            updatedAt: new Date('2026-08-05T00:00:00.000Z'),
          }),
        ] as never,
      }),
    );
    expect(result.place?.id).toBe(STUDIO.id);
  });

  it('breaks a total tie deterministically rather than by array order', () => {
    // Two identical declarations must not flicker between renders.
    const assertions = [
      allDay({ id: 'zzz', tieBreaker: 'zzz', placeId: STUDIO.id }),
      allDay({ id: 'aaa', tieBreaker: 'aaa', placeId: LIBRARY.id }),
    ];
    const forward = expectedAt(state({ assertions: assertions }));
    const reversed = expectedAt(state({ assertions: [...assertions].reverse() }));
    expect(forward.place?.id).toBe(LIBRARY.id);
    expect(reversed.place?.id).toBe(forward.place?.id);
  });

  it('resolves to unknown when the winning assertion names a place that is gone', () => {
    // Rendering a dangling id would show a blank or a raw identifier where a name belongs.
    const result = expectedAt(state({ assertions: [allDay({ placeId: MISSING })] as never }));
    expect(result).toMatchObject({ place: null, source: 'unknown', confidence: 'unknown' });
  });
});

describe('work blocks as evidence', () => {
  const block = (startsAt: string, endsAt: string, placeId: string | null) => ({
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    placeId,
  });

  it('uses an active located block when no assertion covers the instant', () => {
    const result = expectedAt(
      state({
        workBlocks: [
          block('2026-08-12T18:00:00.000Z', '2026-08-12T20:00:00.000Z', LIBRARY.id),
        ] as never,
      }),
    );
    expect(result).toMatchObject({ source: 'work_block', confidence: 'declared' });
    expect(result.place?.id).toBe(LIBRARY.id);
  });

  it('refuses to bridge across an unlocated block that is really happening', () => {
    // Intervening work with no place makes the gap genuinely ambiguous.
    const result = expectedAt(
      state({
        workBlocks: [
          block('2026-08-12T16:00:00.000Z', '2026-08-12T18:00:00.000Z', LIBRARY.id),
          block('2026-08-12T18:00:00.000Z', '2026-08-12T20:00:00.000Z', null),
          block('2026-08-12T20:00:00.000Z', '2026-08-12T22:00:00.000Z', LIBRARY.id),
        ] as never,
      }),
    );
    expect(result.source).toBe('unknown');
  });

  it('bridges a gap between two blocks at the same place on the same local day', () => {
    const result = expectedAt(
      state({
        workBlocks: [
          block('2026-08-12T16:00:00.000Z', '2026-08-12T18:00:00.000Z', LIBRARY.id),
          block('2026-08-12T20:00:00.000Z', '2026-08-12T22:00:00.000Z', LIBRARY.id),
        ] as never,
      }),
      new Date('2026-08-12T19:00:00.000Z'),
    );
    expect(result).toMatchObject({ source: 'bridged_work_blocks', confidence: 'inferred' });
    expect(result.place?.id).toBe(LIBRARY.id);
  });

  it('refuses to bridge between two different places', () => {
    const result = expectedAt(
      state({
        workBlocks: [
          block('2026-08-12T16:00:00.000Z', '2026-08-12T18:00:00.000Z', LIBRARY.id),
          block('2026-08-12T20:00:00.000Z', '2026-08-12T22:00:00.000Z', STUDIO.id),
        ] as never,
      }),
      new Date('2026-08-12T19:00:00.000Z'),
    );
    expect(result.source).toBe('unknown');
  });

  it('refuses to bridge across a local-day boundary', () => {
    // Overnight is not "still at the library"; the person went home.
    const result = expectedAt(
      state({
        workBlocks: [
          block('2026-08-12T22:00:00.000Z', '2026-08-12T23:00:00.000Z', LIBRARY.id),
          block('2026-08-13T16:00:00.000Z', '2026-08-13T18:00:00.000Z', LIBRARY.id),
        ] as never,
      }),
      new Date('2026-08-13T06:00:00.000Z'),
    );
    expect(result.source).toBe('unknown');
  });
});

describe('current location versus expected', () => {
  const observation = (
    source: 'manual' | 'device',
    placeId: string,
    observedAt: string,
    expiresAt: string,
  ) => ({ source, placeId, observedAt: new Date(observedAt), expiresAt: new Date(expiresAt) });

  function currentAt(resolutionState: WorkLocationResolutionState) {
    return resolveWorkLocationPoint({ at: NOON, state: resolutionState }).current;
  }

  it('lets a person overrule a device that disagrees with them', () => {
    const result = currentAt(
      state({
        observations: [
          observation('device', STUDIO.id, '2026-08-12T18:00:00.000Z', '2026-08-12T21:00:00.000Z'),
          observation('manual', LIBRARY.id, '2026-08-12T18:30:00.000Z', '2026-08-12T21:00:00.000Z'),
        ] as never,
      }),
    );
    expect(result).toMatchObject({ source: 'manual', confidence: 'declared' });
    expect(result.place?.id).toBe(LIBRARY.id);
  });

  it('reports a device sighting as observed rather than declared', () => {
    const result = currentAt(
      state({
        observations: [
          observation('device', STUDIO.id, '2026-08-12T18:00:00.000Z', '2026-08-12T21:00:00.000Z'),
        ] as never,
      }),
    );
    expect(result).toMatchObject({ source: 'device', confidence: 'observed' });
  });

  it('skips an observation pointing at a place that no longer exists', () => {
    const result = currentAt(
      state({
        observations: [
          observation('device', MISSING, '2026-08-12T18:00:00.000Z', '2026-08-12T21:00:00.000Z'),
        ] as never,
      }),
    );
    expect(result.source).not.toBe('device');
  });

  it('falls back to the Time Ledger when nothing has been observed', () => {
    const result = currentAt(
      state({
        activeTimeContexts: [
          { placeId: STUDIO.id, startsAt: new Date('2026-08-12T17:00:00.000Z'), endsAt: null },
        ] as never,
      }),
    );
    expect(result).toMatchObject({
      source: 'time_ledger',
      confidence: 'observed',
      effectiveEnd: null,
    });
  });

  it('infers current location from the expected answer as a last resort', () => {
    const result = currentAt(state({ assertions: [allDay()] as never }));
    expect(result).toMatchObject({ source: 'inferred_from_expected', confidence: 'inferred' });
    expect(result.place?.id).toBe(LIBRARY.id);
  });

  it('says it does not know rather than inventing a location', () => {
    expect(currentAt(state())).toMatchObject({
      place: null,
      source: 'unknown',
      confidence: 'unknown',
    });
  });
});

describe('resolving a range', () => {
  it('refuses a range that does not move forward', () => {
    const at = new Date('2026-08-12T00:00:00.000Z');
    expect(() => resolveExpectedWorkLocationRange({ start: at, end: at, state: state() })).toThrow(
      RangeError,
    );
  });

  it('covers the whole range contiguously with no gaps or overlaps', () => {
    const start = new Date('2026-08-12T00:00:00.000Z');
    const end = new Date('2026-08-13T00:00:00.000Z');
    const range = resolveExpectedWorkLocationRange({
      start,
      end,
      state: state({ assertions: [timed()] as never }),
    });

    expect(range.segments[0]?.effectiveStart).toBe(start.toISOString());
    expect(range.segments.at(-1)?.effectiveEnd).toBe(end.toISOString());
    for (let index = 1; index < range.segments.length; index += 1) {
      expect(range.segments[index]?.effectiveStart).toBe(range.segments[index - 1]?.effectiveEnd);
    }
  });

  it('coalesces adjacent fragments that resolve identically', () => {
    // Boundaries fall wherever evidence starts or stops; without coalescing, an unchanged answer
    // would be reported as several identical segments.
    const range = resolveExpectedWorkLocationRange({
      start: new Date('2026-08-12T00:00:00.000Z'),
      end: new Date('2026-08-13T00:00:00.000Z'),
      state: state(),
    });
    expect(range.segments).toHaveLength(1);
    expect(range.segments[0]).toMatchObject({ source: 'unknown' });
  });

  it('keeps a provenance change as its own segment even at the same place', () => {
    // Same place, different reason to believe it — collapsing those would hide the downgrade from
    // a declared answer to an inferred one.
    const range = resolveExpectedWorkLocationRange({
      start: new Date('2026-08-12T16:00:00.000Z'),
      end: new Date('2026-08-12T22:00:00.000Z'),
      state: state({
        workBlocks: [
          {
            startsAt: new Date('2026-08-12T16:00:00.000Z'),
            endsAt: new Date('2026-08-12T18:00:00.000Z'),
            placeId: LIBRARY.id,
          },
          {
            startsAt: new Date('2026-08-12T20:00:00.000Z'),
            endsAt: new Date('2026-08-12T22:00:00.000Z'),
            placeId: LIBRARY.id,
          },
        ] as never,
      }),
    });

    const sources = range.segments.map((segment) => segment.source);
    expect(sources).toContain('work_block');
    expect(sources).toContain('bridged_work_blocks');
  });
});
