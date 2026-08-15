import { describe, expect, it } from 'vitest';

import {
  type EpisodeEvent,
  episodeSubjectKey,
  groupSubjectDayEpisodes,
  subjectDayEpisodeKey,
} from '../src/digest-episodes';

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

describe('Athena digest episodes', () => {
  it('uses a tenant-qualified stable subject key that prefers the resolved Docket entity', () => {
    const viaDocket = event('a', '2026-08-12T12:00:00.000Z');
    const viaLinear = event('b', '2026-08-12T12:00:00.000Z', { system: 'linear' });

    expect(episodeSubjectKey(viaDocket)).toBe(episodeSubjectKey(viaLinear));
    expect(subjectDayEpisodeKey(episodeSubjectKey(viaDocket), DAY)).toBe(
      'day:2026-08-12:org_1:docket:task_482',
    );
  });

  it('groups all activity for a subject into one chronological day episode regardless of input order', () => {
    const early = event('early', '2026-08-12T09:00:00.000Z');
    const late = event('late', '2026-08-12T17:00:00.000Z', { kind: 'comment' });
    const another = event('another', '2026-08-12T10:00:00.000Z', {
      entityDocketId: 'task_999',
      entityExternalId: 'ENG-999',
    });

    const episodes = groupSubjectDayEpisodes([late, another, early], DAY);

    expect(episodes).toHaveLength(2);
    expect(episodes[0]?.allEvents.map((item) => item.id)).toEqual(['early', 'late']);
    expect(episodes[1]?.allEvents.map((item) => item.id)).toEqual(['another']);
    expect(episodes.map((item) => item.key)).toEqual([
      'day:2026-08-12:org_1:docket:task_482',
      'day:2026-08-12:org_1:docket:task_999',
    ]);
  });

  it('keeps subject-less events separate rather than inventing a shared story', () => {
    const first = event('first', '2026-08-12T09:00:00.000Z', {
      entityKind: null,
      entityExternalId: null,
      entityDocketId: null,
    });
    const second = event('second', '2026-08-12T09:05:00.000Z', {
      entityKind: null,
      entityExternalId: null,
      entityDocketId: null,
    });

    expect(groupSubjectDayEpisodes([first, second], DAY)).toHaveLength(2);
  });

  it('keeps substantive activity visible while retaining minor activity as related facts', () => {
    const reaction = event('reaction', '2026-08-12T09:00:00.000Z', { kind: 'reaction' });
    const completed = event('completed', '2026-08-12T09:05:00.000Z', { kind: 'completed' });

    const [episode] = groupSubjectDayEpisodes([completed, reaction], DAY);

    expect(episode?.visibleEvents.map((item) => item.id)).toEqual(['completed']);
    expect(episode?.relatedEvents.map((item) => item.id)).toEqual(['reaction']);
    expect(episode?.minorOnly).toBe(false);
  });

  it('keeps all-minor activity narratable instead of dropping its whole episode', () => {
    const started = event('started', '2026-08-12T09:00:00.000Z', { kind: 'timer_started' });
    const progress = event('progress', '2026-08-12T09:05:00.000Z', { kind: 'agent_progress' });

    const [episode] = groupSubjectDayEpisodes([started, progress], DAY);

    expect(episode?.visibleEvents).toEqual([]);
    expect(episode?.relatedEvents.map((item) => item.id)).toEqual(['started', 'progress']);
    expect(episode?.minorOnly).toBe(true);
  });

  it('treats all-cosmetic Docket field changes as related but keeps meaningful changes visible', () => {
    const cosmetic = event('cosmetic', '2026-08-12T09:00:00.000Z', {
      kind: 'field_change',
      detail: {
        schema: 'docket.field_change',
        fields: ['description', 'labels'],
      },
    });
    const meaningful = event('meaningful', '2026-08-12T09:05:00.000Z', {
      kind: 'field_change',
      detail: {
        schema: 'docket.field_change',
        fields: ['description', 'dueDate'],
      },
    });

    const [onlyCosmetic] = groupSubjectDayEpisodes([cosmetic], DAY);
    const [withMeaningful] = groupSubjectDayEpisodes([cosmetic, meaningful], DAY);

    expect(onlyCosmetic?.minorOnly).toBe(true);
    expect(onlyCosmetic?.relatedEvents.map((item) => item.id)).toEqual(['cosmetic']);
    expect(withMeaningful?.visibleEvents.map((item) => item.id)).toEqual(['meaningful']);
    expect(withMeaningful?.relatedEvents.map((item) => item.id)).toEqual(['cosmetic']);
  });

  it('folds a near duplicate by stable detail fingerprint but retains a genuine recurrence', () => {
    const first = event('first', '2026-08-12T09:00:00.000Z', {
      kind: 'completed',
      detail: {
        schema: 'docket.state_change',
        state: { from: 'in_progress', to: 'done' },
      },
    });
    const echo = event('echo', '2026-08-12T09:04:00.000Z', {
      kind: 'completed',
      detail: {
        state: { to: 'done', from: 'in_progress' },
        schema: 'docket.state_change',
      },
    });
    const recurrence = event('recurrence', '2026-08-12T09:05:01.000Z', {
      kind: 'completed',
      detail: {
        schema: 'docket.state_change',
        state: { from: 'in_progress', to: 'done' },
      },
    });

    const [folded] = groupSubjectDayEpisodes([echo, first], DAY);
    const [repeated] = groupSubjectDayEpisodes([recurrence, first], DAY);

    expect(folded?.visibleEvents.map((item) => item.id)).toEqual(['first']);
    expect(folded?.relatedEvents.map((item) => item.id)).toEqual(['echo']);
    expect(repeated?.visibleEvents.map((item) => item.id)).toEqual(['first', 'recurrence']);
  });
});
