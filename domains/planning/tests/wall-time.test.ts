import { describe, expect, it } from 'vitest';

import {
  resolveScheduleTimezone,
  resolveScheduleWallInstant,
  resolveScheduleWallTime,
  scheduleElapsedMinutes,
  scheduleInstantAt,
  scheduleWallPositionForInstant,
} from '../src/wall-time';

describe('schedule wall-time resolution', () => {
  it('keeps a supported timezone and replaces an unsupported one', () => {
    expect(resolveScheduleTimezone('UTC')).toBe('UTC');
    expect(resolveScheduleTimezone('Mars/Olympus')).not.toBe('Mars/Olympus');
  });

  it('resolves ordinary wall time to one exact instant', () => {
    expect(resolveScheduleWallTime('2026-08-31', 9 * 60, 'America/Los_Angeles')).toEqual({
      kind: 'normal',
      instant: '2026-08-31T16:00:00Z',
    });
  });

  it('rejects skipped spring-forward wall time', () => {
    expect(resolveScheduleWallTime('2026-03-08', 2 * 60 + 30, 'America/Los_Angeles')).toEqual({
      kind: 'skipped',
    });
    expect(resolveScheduleWallInstant('2026-03-08', 2 * 60 + 30, 'America/Los_Angeles')).toEqual({
      kind: 'skipped',
    });
  });

  it('exposes both exact occurrences of a repeated fall-back wall time', () => {
    expect(resolveScheduleWallTime('2026-11-01', 90, 'America/Los_Angeles')).toMatchObject({
      kind: 'repeated',
      candidates: [
        { occurrence: 'earlier', instant: '2026-11-01T08:30:00Z', offset: '-07:00' },
        { occurrence: 'later', instant: '2026-11-01T09:30:00Z', offset: '-08:00' },
      ],
    });
  });

  it('requires a source fold occurrence before resolving a repeated target', () => {
    expect(resolveScheduleWallInstant('2026-11-01', 75, 'America/Los_Angeles')).toEqual({
      kind: 'repeated',
    });
    expect(
      resolveScheduleWallInstant('2026-11-01', 75, 'America/Los_Angeles', '2026-11-01T08:30:00Z'),
    ).toEqual({ kind: 'resolved', instant: '2026-11-01T08:15:00Z' });
    expect(
      resolveScheduleWallInstant('2026-11-01', 75, 'America/Los_Angeles', '2026-11-01T09:30:00Z'),
    ).toEqual({ kind: 'resolved', instant: '2026-11-01T09:15:00Z' });
  });

  it('normalizes extended lane minutes onto the following local date', () => {
    expect(resolveScheduleWallInstant('2026-08-31', 25 * 60, 'UTC')).toEqual({
      kind: 'resolved',
      instant: '2026-09-01T01:00:00Z',
    });
  });

  it('returns invalid or null for malformed date, instant, and minute inputs', () => {
    expect(resolveScheduleWallTime('not-a-date', 60, 'UTC')).toBeNull();
    expect(resolveScheduleWallTime('2026-08-31', -1, 'UTC')).toBeNull();
    expect(resolveScheduleWallTime('2026-08-31', 1.5, 'UTC')).toBeNull();
    expect(resolveScheduleWallInstant('2026-08-31', Number.MAX_VALUE, 'UTC')).toEqual({
      kind: 'invalid',
    });
    expect(scheduleWallPositionForInstant('nope', 'UTC')).toBeNull();
    expect(scheduleElapsedMinutes('nope', '2026-08-31T01:00:00Z')).toBeNull();
  });

  it('projects instants to wall positions and measures physical elapsed minutes', () => {
    expect(scheduleWallPositionForInstant('2026-09-01T02:45:00Z', 'America/Los_Angeles')).toEqual({
      date: '2026-08-31',
      wallMinutes: 19 * 60 + 45,
    });
    expect(scheduleElapsedMinutes('2026-11-01T08:30:00Z', '2026-11-01T10:30:00Z')).toBe(120);
  });

  it('applies explicit Temporal disambiguation when a caller chooses it', () => {
    expect(scheduleInstantAt('2026-11-01', 90, 'America/Los_Angeles', 'reject')).toBeNull();
    expect(scheduleInstantAt('2026-11-01', 90, 'America/Los_Angeles', 'earlier')).toBe(
      '2026-11-01T08:30:00Z',
    );
    expect(scheduleInstantAt('2026-11-01', 90, 'America/Los_Angeles', 'later')).toBe(
      '2026-11-01T09:30:00Z',
    );
    expect(scheduleInstantAt('bad-date', 90, 'UTC')).toBeNull();
  });
});
