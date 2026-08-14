import { describe, expect, it } from 'vitest';
import { WorkPlaceId } from '@docket/types';

import { buildWorkLocationStripModel } from '@/components/work-location/work-location-strip';

describe('buildWorkLocationStripModel', () => {
  it('keeps legacy provider context until canonical account bootstrap is ready', () => {
    expect(
      buildWorkLocationStripModel({
        ready: false,
        start: '2026-08-14T07:00:00.000Z',
        end: '2026-08-15T07:00:00.000Z',
        timezone: 'America/Los_Angeles',
        point: null,
        range: null,
        accounts: [],
        legacyItems: [{ id: 'legacy', label: 'Provider office', color: '#2563eb' }],
      }),
    ).toEqual([
      expect.objectContaining({ id: 'legacy', kind: 'legacy', label: 'Provider office' }),
    ]);
  });

  it('shows independent current and expected answers with provenance once canonical reads are ready', () => {
    const chips = buildWorkLocationStripModel({
      ready: true,
      start: '2026-08-14T15:00:00.000Z',
      end: '2026-08-14T23:00:00.000Z',
      timezone: 'America/Los_Angeles',
      legacyItems: [{ id: 'legacy', label: 'Provider office', color: '#2563eb' }],
      point: {
        at: '2026-08-14T17:00:00.000Z',
        current: {
          place: { id: WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), name: 'Main library' },
          source: 'device',
          confidence: 'observed',
          effectiveStart: null,
          effectiveEnd: null,
          observedAt: '2026-08-14T16:58:00.000Z',
          expiresAt: '2026-08-14T17:13:00.000Z',
        },
        expected: {
          place: { id: WorkPlaceId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'), name: 'Editing studio' },
          source: 'assertion',
          confidence: 'declared',
          effectiveStart: '2026-08-14T16:00:00.000Z',
          effectiveEnd: '2026-08-14T20:00:00.000Z',
          observedAt: null,
          expiresAt: null,
        },
      },
      range: {
        start: '2026-08-14T15:00:00.000Z',
        end: '2026-08-14T23:00:00.000Z',
        segments: [
          {
            place: { id: WorkPlaceId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'), name: 'Editing studio' },
            source: 'assertion',
            confidence: 'declared',
            effectiveStart: '2026-08-14T16:00:00.000Z',
            effectiveEnd: '2026-08-14T20:00:00.000Z',
            observedAt: null,
            expiresAt: null,
          },
        ],
      },
      accounts: [],
    });

    expect(chips).toEqual([
      expect.objectContaining({ kind: 'current', label: 'Now: Main library' }),
      expect.objectContaining({
        kind: 'expected',
        label: expect.stringContaining('Editing studio'),
        detail: expect.stringContaining('assertion · declared'),
      }),
    ]);
    expect(chips.find((chip) => chip.kind === 'legacy')).toBeUndefined();
  });

  it('adds compact account warnings without exposing provider errors', () => {
    const chips = buildWorkLocationStripModel({
      ready: true,
      start: '2026-08-14T15:00:00.000Z',
      end: '2026-08-14T23:00:00.000Z',
      timezone: 'UTC',
      legacyItems: [],
      point: null,
      range: { start: '2026-08-14T15:00:00.000Z', end: '2026-08-14T23:00:00.000Z', segments: [] },
      accounts: [
        {
          provider: 'google',
          accountLabel: 'a@example.com',
          state: 'action_required',
          reason: 'missing_scope',
          pendingWrites: 0,
        },
      ],
    });

    expect(chips).toEqual([
      expect.objectContaining({ kind: 'warning', label: 'Google location sync needs attention' }),
    ]);
  });

  it('labels a Hub-local midnight-to-midnight segment as all day', () => {
    const chips = buildWorkLocationStripModel({
      ready: true,
      start: '2026-03-08T08:00:00.000Z',
      end: '2026-03-09T07:00:00.000Z',
      timezone: 'America/Los_Angeles',
      point: null,
      legacyItems: [],
      accounts: [],
      range: {
        start: '2026-03-08T08:00:00.000Z',
        end: '2026-03-09T07:00:00.000Z',
        segments: [
          {
            place: {
              id: WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
              name: 'Family home',
            },
            source: 'assertion',
            confidence: 'declared',
            effectiveStart: '2026-03-08T08:00:00.000Z',
            effectiveEnd: '2026-03-09T07:00:00.000Z',
            observedAt: null,
            expiresAt: null,
          },
        ],
      },
    });

    expect(chips).toEqual([
      expect.objectContaining({ kind: 'expected', label: 'All day · Family home' }),
    ]);
  });
});
