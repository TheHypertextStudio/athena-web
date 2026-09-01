import { describe, expect, it } from 'vitest';

import {
  COSMETIC_FIELD_CHANGE_FIELDS,
  EPISODE_GAP_MS,
  MINOR_EPISODE_KINDS,
  type EpisodeEvent,
  episodeEventFingerprint,
  episodeSubjectKey,
  groupAdjacentEpisodes,
  groupSubjectDayEpisodes,
  isSubstantiveEpisodeEvent,
  subjectDayEpisodeKey,
} from '../../src/contracts/activity-episode';
import { assertDefined } from '@docket/test-utils';

const DAY = '2026-08-12';

function event(
  id: string,
  occurredAt: string,
  overrides: Partial<EpisodeEvent> = {},
): EpisodeEvent {
  return {
    id,
    organizationId: 'org_1',
    system: 'docket',
    kind: 'status_change',
    occurredAt,
    entityKind: 'work_item',
    entityExternalId: 'ENG-482',
    entityDocketId: 'task_482',
    actorDocketId: 'actor_willie',
    actorSource: 'docket',
    actorExternalId: 'actor_willie',
    actorName: 'Willie Chalmers III',
    detail: null,
    ...overrides,
  };
}

/** A second subject, so adjacency and bucketing can be exercised against a real alternative. */
function otherSubject(id: string, occurredAt: string): EpisodeEvent {
  return event(id, occurredAt, { entityDocketId: 'task_999', entityExternalId: 'ENG-999' });
}

describe('episodeSubjectKey', () => {
  it('prefers the resolved Docket entity so one story spans tools', () => {
    const viaDocket = event('a', '2026-08-12T12:00:00.000Z');
    const viaLinear = event('b', '2026-08-12T12:00:00.000Z', { system: 'linear' });
    expect(episodeSubjectKey(viaDocket)).toBe(episodeSubjectKey(viaLinear));
  });

  it('falls back to the source entity identity when nothing is resolved yet', () => {
    const first = event('a', '2026-08-12T12:00:00.000Z', {
      entityDocketId: null,
      system: 'linear',
    });
    const second = event('b', '2026-08-12T12:30:00.000Z', {
      entityDocketId: null,
      system: 'linear',
    });
    expect(episodeSubjectKey(first)).toBe(episodeSubjectKey(second));
    expect(episodeSubjectKey(first)).not.toBe(
      episodeSubjectKey(event('c', '2026-08-12T12:00:00.000Z')),
    );
  });

  it('keeps subjectless events apart rather than heaping them together', () => {
    const noKind = event('a', '2026-08-12T12:00:00.000Z', {
      entityDocketId: null,
      entityKind: null,
      entityExternalId: null,
    });
    const alsoNoKind = event('b', '2026-08-12T12:00:00.000Z', {
      entityDocketId: null,
      entityKind: null,
      entityExternalId: null,
    });
    expect(episodeSubjectKey(noKind)).not.toBe(episodeSubjectKey(alsoNoKind));
  });

  it('needs both a kind and an external id to use the source identity', () => {
    const kindWithoutId = event('a', '2026-08-12T12:00:00.000Z', {
      entityDocketId: null,
      entityExternalId: null,
    });
    expect(episodeSubjectKey(kindWithoutId)).toContain('event:a');
  });

  it('is tenant-qualified, so identical external ids in two orgs never merge', () => {
    const here = event('a', '2026-08-12T12:00:00.000Z');
    const there = event('b', '2026-08-12T12:00:00.000Z', { organizationId: 'org_2' });
    expect(episodeSubjectKey(here)).not.toBe(episodeSubjectKey(there));
  });
});

describe('subjectDayEpisodeKey', () => {
  it('separates the same subject on different days', () => {
    const subject = episodeSubjectKey(event('a', '2026-08-12T12:00:00.000Z'));
    expect(subjectDayEpisodeKey(subject, DAY)).not.toBe(
      subjectDayEpisodeKey(subject, '2026-08-13'),
    );
  });
});

describe('isSubstantiveEpisodeEvent', () => {
  it.each([...MINOR_EPISODE_KINDS])('discloses %s rather than giving it a line', (kind) => {
    expect(isSubstantiveEpisodeEvent(event('a', '2026-08-12T12:00:00.000Z', { kind }))).toBe(false);
  });

  it.each(['created', 'completed', 'comment', 'mention', 'agent_blocked'] as const)(
    'keeps %s visible',
    (kind) => {
      expect(isSubstantiveEpisodeEvent(event('a', '2026-08-12T12:00:00.000Z', { kind }))).toBe(
        true,
      );
    },
  );

  it('treats a field change as substantive unless every field is cosmetic', () => {
    const cosmetic = event('a', '2026-08-12T12:00:00.000Z', {
      kind: 'field_change',
      detail: {
        schema: 'docket.field_change',
        fields: [...COSMETIC_FIELD_CHANGE_FIELDS].slice(0, 2),
        changes: [{ field: 'description', label: 'Description', from: 'Draft', to: 'Ready' }],
      },
    });
    const meaningful = event('b', '2026-08-12T12:00:00.000Z', {
      kind: 'field_change',
      detail: {
        schema: 'docket.field_change',
        fields: ['description', 'dueDate'],
        changes: [{ field: 'dueDate', label: 'Due date', from: 'Aug 10', to: 'Aug 12' }],
      },
    });
    expect(isSubstantiveEpisodeEvent(cosmetic)).toBe(false);
    expect(isSubstantiveEpisodeEvent(meaningful)).toBe(true);
  });

  it('cannot judge non-Docket detail field-by-field, so keeps it visible', () => {
    const generic = event('a', '2026-08-12T12:00:00.000Z', {
      kind: 'field_change',
      detail: { schema: 'generic', title: 'Provider update', summary: null, url: null },
    });
    const detailless = event('b', '2026-08-12T12:00:00.000Z', { kind: 'field_change' });
    expect(isSubstantiveEpisodeEvent(generic)).toBe(true);
    expect(isSubstantiveEpisodeEvent(detailless)).toBe(true);
  });
});

describe('episodeEventFingerprint', () => {
  it('is stable across key order in nested detail', () => {
    const left = event('a', '2026-08-12T12:00:00.000Z', {
      detail: { schema: 'docket.state_change', fromState: 'in_progress', toState: 'done' },
    });
    const right = event('b', '2026-08-12T12:00:00.000Z', {
      detail: { schema: 'docket.state_change', toState: 'done', fromState: 'in_progress' },
    });
    expect(episodeEventFingerprint(left)).toBe(episodeEventFingerprint(right));
  });

  it('distinguishes different detail, including inside arrays', () => {
    const base = {
      kind: 'field_change' as const,
      detail: {
        schema: 'docket.field_change' as const,
        fields: ['dueDate'],
        changes: [{ field: 'dueDate', label: 'Due date', from: 'Aug 10', to: 'Aug 12' }],
      },
    };
    const moved = {
      kind: 'field_change' as const,
      detail: {
        schema: 'docket.field_change' as const,
        fields: ['dueDate'],
        changes: [{ field: 'dueDate', label: 'Due date', from: 'Aug 10', to: 'Aug 20' }],
      },
    };
    expect(episodeEventFingerprint(event('a', '2026-08-12T12:00:00.000Z', base))).not.toBe(
      episodeEventFingerprint(event('b', '2026-08-12T12:00:00.000Z', moved)),
    );
  });

  it('identifies an unresolved actor by source identity, then by name', () => {
    const external = event('a', '2026-08-12T12:00:00.000Z', {
      actorDocketId: null,
      actorSource: 'github',
      actorExternalId: 'gh_42',
    });
    const nameOnly = event('b', '2026-08-12T12:00:00.000Z', {
      actorDocketId: null,
      actorSource: null,
      actorExternalId: null,
      actorName: 'A Stranger',
    });
    expect(episodeEventFingerprint(external)).toContain('gh_42');
    expect(episodeEventFingerprint(nameOnly)).toContain('A Stranger');
    expect(episodeEventFingerprint(nameOnly)).toContain('unknown');
  });
});

describe('groupAdjacentEpisodes', () => {
  it('returns nothing for no events', () => {
    expect(groupAdjacentEpisodes([])).toEqual([]);
  });

  it('clusters consecutive events about one subject and never reorders them', () => {
    const newer = event('newer', '2026-08-12T12:00:00.000Z');
    const older = event('older', '2026-08-12T11:30:00.000Z');
    const episodes = groupAdjacentEpisodes([newer, older]);
    expect(episodes).toHaveLength(1);
    expect(assertDefined(episodes[0]).allEvents.map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('splits a run when the adjacent gap exceeds the window, and not when it meets it', () => {
    const anchor = event('anchor', '2026-08-12T12:00:00.000Z');
    const atLimit = event(
      'at-limit',
      new Date(Date.parse(anchor.occurredAt) - EPISODE_GAP_MS).toISOString(),
    );
    const beyond = event(
      'beyond',
      new Date(Date.parse(anchor.occurredAt) - EPISODE_GAP_MS - 1000).toISOString(),
    );
    expect(groupAdjacentEpisodes([anchor, atLimit])).toHaveLength(1);
    expect(groupAdjacentEpisodes([anchor, beyond])).toHaveLength(2);
  });

  it('breaks a run when the subject changes, even moments apart', () => {
    const mine = event('mine', '2026-08-12T12:00:00.000Z');
    const theirs = otherSubject('theirs', '2026-08-12T11:59:00.000Z');
    expect(groupAdjacentEpisodes([mine, theirs])).toHaveLength(2);
  });

  it('derives the same episode key from ascending and descending input', () => {
    const first = event('first', '2026-08-12T11:00:00.000Z');
    const second = event('second', '2026-08-12T11:30:00.000Z');
    const third = event('third', '2026-08-12T12:00:00.000Z');
    const descending = groupAdjacentEpisodes([third, second, first]);
    const ascending = groupAdjacentEpisodes([first, second, third]);
    expect(descending).toHaveLength(1);
    expect(ascending).toHaveLength(1);
    expect(assertDefined(ascending[0]).key).toBe(assertDefined(descending[0]).key);
  });

  it('breaks a timestamp tie by id so the key cannot depend on listing order', () => {
    const alpha = event('alpha', '2026-08-12T12:00:00.000Z');
    const beta = event('beta', '2026-08-12T12:00:00.000Z');
    expect(assertDefined(groupAdjacentEpisodes([alpha, beta])[0]).key).toBe(
      assertDefined(groupAdjacentEpisodes([beta, alpha])[0]).key,
    );
  });

  it('separates substantive events from disclosed activity without dropping any', () => {
    const done = event('done', '2026-08-12T12:00:00.000Z', { kind: 'completed' });
    const reaction = event('reaction', '2026-08-12T11:58:00.000Z', { kind: 'reaction' });
    const status = event('status', '2026-08-12T11:56:00.000Z');
    const episode = assertDefined(groupAdjacentEpisodes([done, reaction, status])[0]);
    expect(episode.visibleEvents.map((e) => e.id)).toEqual(['done', 'status']);
    expect(episode.relatedEvents.map((e) => e.id)).toEqual(['reaction']);
    expect(episode.allEvents).toHaveLength(3);
    expect(episode.minorOnly).toBe(false);
  });

  it('marks an all-minor episode so it can still be summarized', () => {
    const started = event('started', '2026-08-12T12:00:00.000Z', { kind: 'timer_started' });
    const stopped = event('stopped', '2026-08-12T11:59:00.000Z', { kind: 'timer_stopped' });
    const episode = assertDefined(groupAdjacentEpisodes([started, stopped])[0]);
    expect(episode.visibleEvents).toEqual([]);
    expect(episode.minorOnly).toBe(true);
  });

  it('folds a near-simultaneous repeat but keeps a genuine recurrence visible', () => {
    const detail = {
      schema: 'docket.state_change',
      fromState: 'in_progress',
      toState: 'done',
    } as const;
    const first = event('first', '2026-08-12T12:00:00.000Z', { kind: 'completed', detail });
    const echo = event('echo', '2026-08-12T11:58:00.000Z', { kind: 'completed', detail });
    const later = event('later', '2026-08-12T11:00:00.000Z', { kind: 'completed', detail });

    const folded = assertDefined(groupAdjacentEpisodes([first, echo])[0]);
    expect(folded.visibleEvents.map((e) => e.id)).toEqual(['first']);
    expect(folded.relatedEvents.map((e) => e.id)).toEqual(['echo']);

    const recurrence = assertDefined(groupAdjacentEpisodes([first, later])[0]);
    expect(recurrence.visibleEvents.map((e) => e.id)).toEqual(['first', 'later']);
  });
});

describe('groupSubjectDayEpisodes', () => {
  it('returns nothing for no events', () => {
    expect(groupSubjectDayEpisodes([], DAY)).toEqual([]);
  });

  it('makes one episode per subject however far apart the work was', () => {
    const morning = event('morning', '2026-08-12T09:00:00.000Z');
    const evening = event('evening', '2026-08-12T21:00:00.000Z');
    const episodes = groupSubjectDayEpisodes([morning, evening], DAY);
    expect(episodes).toHaveLength(1);
    expect(assertDefined(episodes[0]).allEvents.map((e) => e.id)).toEqual(['morning', 'evening']);
  });

  it('orders episodes by when each subject was first touched', () => {
    const late = event('late', '2026-08-12T18:00:00.000Z');
    const early = otherSubject('early', '2026-08-12T08:00:00.000Z');
    expect(
      groupSubjectDayEpisodes([late, early], DAY).map((e) => assertDefined(e.allEvents[0]).id),
    ).toEqual(['early', 'late']);
  });

  it('produces identical episodes from ascending and descending input', () => {
    const events = [
      event('a', '2026-08-12T09:00:00.000Z'),
      otherSubject('b', '2026-08-12T10:00:00.000Z'),
      event('c', '2026-08-12T11:00:00.000Z'),
    ];
    expect(groupSubjectDayEpisodes([...events].reverse(), DAY)).toEqual(
      groupSubjectDayEpisodes(events, DAY),
    );
  });

  it('keeps the key stable when a backfilled event joins the episode', () => {
    // The failure this prevents: a poll over an eventually-consistent provider search surfaces a
    // 13:00 event only after the day was already narrated and curated at 15:30. A key derived from
    // the episode's membership would move, orphaning the curation into a duplicate row.
    const known = [
      event('14', '2026-08-12T14:00:00.000Z'),
      event('15', '2026-08-12T15:00:00.000Z'),
    ];
    const backfilled = [event('13', '2026-08-12T13:00:00.000Z'), ...known];

    const before = groupSubjectDayEpisodes(known, DAY);
    const after = groupSubjectDayEpisodes(backfilled, DAY);

    expect(after).toHaveLength(1);
    expect(assertDefined(after[0]).key).toBe(assertDefined(before[0]).key);
    expect(assertDefined(after[0]).allEvents.map((e) => e.id)).toEqual(['13', '14', '15']);
  });

  it('keys each episode by its subject and the day', () => {
    const only = assertDefined(
      groupSubjectDayEpisodes([event('a', '2026-08-12T09:00:00.000Z')], DAY)[0],
    );
    expect(only.key).toBe(subjectDayEpisodeKey(only.subjectKey, DAY));
  });

  it('applies the same substantive classification as adjacent grouping', () => {
    const done = event('done', '2026-08-12T09:00:00.000Z', { kind: 'completed' });
    const reaction = event('reaction', '2026-08-12T20:00:00.000Z', { kind: 'reaction' });
    const episode = assertDefined(groupSubjectDayEpisodes([done, reaction], DAY)[0]);
    expect(episode.visibleEvents.map((e) => e.id)).toEqual(['done']);
    expect(episode.relatedEvents.map((e) => e.id)).toEqual(['reaction']);
  });
});
