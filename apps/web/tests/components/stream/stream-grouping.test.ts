import { describe, expect, it } from 'vitest';

import { buildStreamGroups, isSubstantiveStreamEvent } from '@/components/stream/stream-grouping';
import type { StreamEventRow } from '@/components/stream/stream-meta';
import { assertDefined } from '@docket/test-utils';

function row(
  id: string,
  occurredAt: string,
  overrides: Partial<StreamEventRow> = {},
): StreamEventRow {
  return {
    id,
    organizationId: 'org_1',
    system: 'docket',
    origin: 'docket',
    externalUrl: null,
    kind: 'status_change',
    occurredAt,
    title: id,
    summary: null,
    permalink: null,
    actorSource: 'docket',
    actorExternalId: 'actor_willie',
    actorDocketId: 'actor_willie',
    actorName: 'Willie Chalmers III',
    actorAvatarUrl: null,
    actorIsViewer: true,
    entityKind: 'work_item',
    entityTitle: 'Ship the beta',
    entityExternalId: 'ENG-482',
    entityDocketId: 'task_482',
    entityUrl: null,
    relevance: null,
    rendering: { icon: 'status', category: 'progress' },
    detail: null,
    ...overrides,
  };
}

const NOW = new Date('2026-06-29T15:00:00');

describe('buildStreamGroups episode boundaries', () => {
  it('clusters only adjacent events about the same subject', () => {
    const sameNewer = row('a-newer', '2026-06-29T12:00:00.000Z');
    const sameOlder = row('a-older', '2026-06-29T11:30:00.000Z');
    const groups = buildStreamGroups([sameNewer, sameOlder], NOW);
    expect(assertDefined(groups[0]).episodes).toHaveLength(1);
    expect(
      assertDefined(assertDefined(groups[0]).episodes[0]).allEvents.map((event) => event.id),
    ).toEqual(['a-newer', 'a-older']);

    const other = row('b', '2026-06-29T11:45:00.000Z', { entityDocketId: 'task_b' });
    expect(
      assertDefined(buildStreamGroups([sameNewer, other, sameOlder], NOW)[0]).episodes,
    ).toHaveLength(3);
  });

  it('closes an episode after a two-hour adjacent gap', () => {
    const newer = row('newer', '2026-06-29T12:00:00.000Z');
    const older = row('older', '2026-06-29T08:59:59.000Z');
    expect(assertDefined(buildStreamGroups([newer, older], NOW)[0]).episodes).toHaveLength(2);
  });

  it('falls back to source identity and keeps subjectless events separate', () => {
    const externalA = row('external-a', '2026-06-29T12:00:00.000Z', {
      origin: 'external',
      system: 'linear',
      entityDocketId: null,
    });
    const externalB = row('external-b', '2026-06-29T11:50:00.000Z', {
      origin: 'external',
      system: 'linear',
      entityDocketId: null,
    });
    const subjectlessA = row('loose-a', '2026-06-29T11:40:00.000Z', {
      entityKind: null,
      entityTitle: null,
      entityExternalId: null,
      entityDocketId: null,
    });
    const subjectlessB = row('loose-b', '2026-06-29T11:30:00.000Z', {
      entityKind: null,
      entityTitle: null,
      entityExternalId: null,
      entityDocketId: null,
    });
    expect(assertDefined(buildStreamGroups([externalA, externalB], NOW)[0]).episodes).toHaveLength(
      1,
    );
    expect(
      assertDefined(buildStreamGroups([subjectlessA, subjectlessB], NOW)[0]).episodes,
    ).toHaveLength(2);
  });

  it('preserves recency buckets and omits empty buckets', () => {
    const groups = buildStreamGroups(
      [
        row('today', '2026-06-29T09:00:00'),
        row('yesterday', '2026-06-28T20:00:00'),
        row('thisweek', '2026-06-25T10:00:00'),
        row('earlier', '2026-05-01T10:00:00'),
      ],
      NOW,
    );
    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      'Earlier this week',
      'Earlier',
    ]);
    expect(buildStreamGroups([], NOW)).toEqual([]);
  });
});

describe('buildStreamGroups meaning preservation', () => {
  it.each([
    'created',
    'completed',
    'status_change',
    'assignment',
    'comment',
    'message',
    'mention',
    'agent_blocked',
    'agent_completed',
    'agent_failed',
  ] as const)('keeps %s visible', (kind) => {
    expect(isSubstantiveStreamEvent(row(kind, '2026-06-29T12:00:00.000Z', { kind }))).toBe(true);
  });

  it.each([
    'reaction',
    'timer_started',
    'timer_paused',
    'timer_resumed',
    'timer_switched',
    'timer_stopped',
    'agent_progress',
  ] as const)('moves %s into related activity', (kind) => {
    expect(isSubstantiveStreamEvent(row(kind, '2026-06-29T12:00:00.000Z', { kind }))).toBe(false);
  });

  it('only treats cosmetic field changes as minor', () => {
    const cosmetic = row('cosmetic', '2026-06-29T12:00:00.000Z', {
      kind: 'field_change',
      detail: {
        schema: 'docket.field_change',
        fields: ['description', 'labels'],
        changes: [
          { field: 'description', label: 'Description', from: 'Draft', to: 'Ready' },
          { field: 'labels', label: 'Labels', from: 'One', to: 'One, Two' },
        ],
      },
    });
    const dueDate = row('due', '2026-06-29T11:55:00.000Z', {
      kind: 'field_change',
      detail: {
        schema: 'docket.field_change',
        fields: ['dueDate'],
        changes: [{ field: 'dueDate', label: 'Due date', from: 'Aug 10', to: 'Aug 12' }],
      },
    });
    const unknown = row('unknown', '2026-06-29T11:50:00.000Z', {
      kind: 'field_change',
      detail: { schema: 'generic', title: 'Provider update', summary: null, url: null },
    });
    expect(isSubstantiveStreamEvent(cosmetic)).toBe(false);
    expect(isSubstantiveStreamEvent(dueDate)).toBe(true);
    expect(isSubstantiveStreamEvent(unknown)).toBe(true);
  });

  it('retains every canonical event while separating substantive and related activity', () => {
    const completion = row('done', '2026-06-29T12:00:00.000Z', { kind: 'completed' });
    const reaction = row('reaction', '2026-06-29T11:58:00.000Z', { kind: 'reaction' });
    const status = row('status', '2026-06-29T11:56:00.000Z', { kind: 'status_change' });
    const episode = assertDefined(
      assertDefined(buildStreamGroups([completion, reaction, status], NOW)[0]).episodes[0],
    );
    expect(episode.visibleEvents.map((event) => event.id)).toEqual(['done', 'status']);
    expect(episode.relatedEvents.map((event) => event.id)).toEqual(['reaction']);
    expect(episode.allEvents.map((event) => event.id)).toEqual(['done', 'reaction', 'status']);
    expect(episode.minorOnly).toBe(false);
  });

  it('produces a summary-only episode when every event is minor', () => {
    const first = row('one', '2026-06-29T12:00:00.000Z', { kind: 'timer_started' });
    const second = row('two', '2026-06-29T11:59:00.000Z', { kind: 'reaction' });
    const episode = assertDefined(
      assertDefined(buildStreamGroups([first, second], NOW)[0]).episodes[0],
    );
    expect(episode.visibleEvents).toEqual([]);
    expect(episode.relatedEvents).toEqual([first, second]);
    expect(episode.minorOnly).toBe(true);
  });

  it('folds exact five-minute repeats for display without deleting them', () => {
    const first = row('first', '2026-06-29T12:00:00.000Z', {
      kind: 'completed',
      detail: { schema: 'docket.state_change', fromState: 'in_progress', toState: 'done' },
    });
    const repeat = row('repeat', '2026-06-29T11:58:00.000Z', {
      kind: 'completed',
      detail: { schema: 'docket.state_change', fromState: 'in_progress', toState: 'done' },
    });
    const episode = assertDefined(
      assertDefined(buildStreamGroups([first, repeat], NOW)[0]).episodes[0],
    );
    expect(episode.visibleEvents.map((event) => event.id)).toEqual(['first']);
    expect(episode.relatedEvents.map((event) => event.id)).toEqual(['repeat']);
    expect(episode.allEvents).toEqual([first, repeat]);
  });
});
