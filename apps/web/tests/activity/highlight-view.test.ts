import type { HighlightsDayOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import {
  entryTimeLabel,
  joinLabels,
  sourceLabel,
  summarizeDay,
} from '@/components/activity/highlight-view';

function day(over: Partial<HighlightsDayOut> = {}): HighlightsDayOut {
  return {
    date: '2026-08-12',
    timezone: 'UTC',
    status: 'ready',
    generating: false,
    eventCount: 0,
    reconciledAt: '2026-08-12T18:00:00.000Z',
    highlights: [],
    sources: [],
    ...over,
  };
}

function source(
  system: HighlightsDayOut['sources'][number]['system'],
  state: HighlightsDayOut['sources'][number]['state'],
): HighlightsDayOut['sources'][number] {
  return { system, state, lastReadAt: null, eventCount: 0 };
}

function highlight(id: string, kept = true): HighlightsDayOut['highlights'][number] {
  return {
    id,
    episodeKey: `day:2026-08-12:${id}`,
    sort: 0,
    occurredAt: '2026-08-12T09:00:00.000Z',
    endedAt: '2026-08-12T09:30:00.000Z',
    system: 'github',
    entityKind: 'work_item',
    docketEntityId: null,
    association: 'pending',
    subjectTitle: 'Ship the beta',
    narration: { state: 'ready', text: 'I shipped it.', edited: false },
    kept,
    curatedAt: null,
    events: [],
  };
}

describe('summarizeDay', () => {
  it('waits rather than guessing while the day is unread', () => {
    expect(summarizeDay(undefined).shape).toBe('loading');
  });

  it('separates a quiet day from one it could not finish reading', () => {
    // The distinction this whole view-model exists for: both show an empty list, but one means
    // "nothing happened" and the other means "we could not find out".
    const quiet = summarizeDay(day({ sources: [source('github', 'ok'), source('gmail', 'ok')] }));
    const incomplete = summarizeDay(
      day({ sources: [source('github', 'ok'), source('gmail', 'failed')] }),
    );

    expect(quiet.shape).toBe('quiet');
    expect(incomplete.shape).toBe('incomplete');
  });

  it('treats a source not yet read for this day as unfinished, not as quiet', () => {
    expect(summarizeDay(day({ sources: [source('github', 'stale')] })).shape).toBe('incomplete');
  });

  it('treats a day nobody has gathered as unfinished', () => {
    expect(summarizeDay(day({ status: 'pending', sources: [source('github', 'ok')] })).shape).toBe(
      'incomplete',
    );
  });

  it('says nothing is connected when nothing is', () => {
    const summary = summarizeDay(day({ sources: [source('github', 'never_connected')] }));
    expect(summary.shape).toBe('not_connected');
    expect(summary.anyConnected).toBe(false);
  });

  it('lists a day that has entries, even when a source is troubled', () => {
    // A partial day still lists what it has; the caller is responsible for saying what is missing.
    const summary = summarizeDay(
      day({ highlights: [highlight('a')], sources: [source('gmail', 'failed')] }),
    );
    expect(summary.shape).toBe('listed');
    expect(summary.troubledSources).toHaveLength(1);
  });

  it('counts what is kept apart from what is recorded', () => {
    const summary = summarizeDay(
      day({
        highlights: [highlight('a'), highlight('b', false)],
        sources: [source('github', 'ok')],
      }),
    );
    expect(summary.keptCount).toBe(1);
    expect(summary.totalCount).toBe(2);
  });
});

describe('sourceLabel and joinLabels', () => {
  it('uses application-owned names, never a raw enum value', () => {
    expect(sourceLabel('google_calendar')).toBe('Calendar');
    expect(sourceLabel('github')).toBe('GitHub');
  });

  it('falls back to something readable for a source it has no name for', () => {
    expect(sourceLabel('outlook')).not.toContain('_');
  });

  it('reads as a sentence for one, two, or several', () => {
    expect(joinLabels([])).toBe('');
    expect(joinLabels(['Gmail'])).toBe('Gmail');
    expect(joinLabels(['Gmail', 'GitHub'])).toBe('Gmail and GitHub');
    expect(joinLabels(['Gmail', 'GitHub', 'Calendar'])).toBe('Gmail, GitHub and Calendar');
  });
});

describe('entryTimeLabel', () => {
  it('shows a range when an episode spanned time', () => {
    const label = entryTimeLabel({
      occurredAt: '2026-08-12T09:00:00.000Z',
      endedAt: '2026-08-12T11:30:00.000Z',
      timezone: 'UTC',
    });
    expect(label).toContain('–');
  });

  it('shows a single time when it did not', () => {
    const label = entryTimeLabel({
      occurredAt: '2026-08-12T09:00:00.000Z',
      endedAt: '2026-08-12T09:00:00.000Z',
      timezone: 'UTC',
    });
    expect(label).not.toContain('–');
  });

  it('reads the times in the day’s own zone', () => {
    const utc = entryTimeLabel({
      occurredAt: '2026-08-12T20:00:00.000Z',
      endedAt: '2026-08-12T20:00:00.000Z',
      timezone: 'UTC',
    });
    const chicago = entryTimeLabel({
      occurredAt: '2026-08-12T20:00:00.000Z',
      endedAt: '2026-08-12T20:00:00.000Z',
      timezone: 'America/Chicago',
    });
    expect(utc).not.toBe(chicago);
  });
});
