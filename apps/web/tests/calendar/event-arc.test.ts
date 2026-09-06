/**
 * Unit tests for {@link import('../../src/components/calendar/item-drawer/arc-model')}.
 *
 * @remarks
 * The `follow_up` relation case is the regression this whole change exists to prevent recurring:
 * the week scheduler writes a debrief link on every planned meeting, and until now no calendar
 * surface rendered one.
 */
import type {
  CalendarItemLinkedTaskOut,
  CalendarItemRelationOut,
  CalendarItemRelationRole,
  CalendarItemTaskRole,
} from '@docket/planning/calendar-contract';
import { describe, expect, it } from 'vitest';

import { buildEventArc, eventArcCounts } from '../../src/components/calendar/item-drawer/arc-model';

function task(role: CalendarItemTaskRole, title: string): CalendarItemLinkedTaskOut {
  return { role, title } as CalendarItemLinkedTaskOut;
}

function relation(role: CalendarItemRelationRole, title: string): CalendarItemRelationOut {
  return { role, targetTitle: title } as CalendarItemRelationOut;
}

function bandTitles(
  arc: ReturnType<typeof buildEventArc>,
  id: 'before' | 'during' | 'after' | 'related',
): readonly string[] {
  const band = arc.bands.find((candidate) => candidate.id === id);
  return [
    ...(band?.tasks.map((entry) => entry.title) ?? []),
    ...(band?.relations.map((entry) => entry.targetTitle ?? '') ?? []),
  ];
}

describe('buildEventArc', () => {
  it('reads an event as before, during, and after', () => {
    const arc = buildEventArc({
      linkedTasks: [
        task('prep', 'Check the schedule'),
        task('agenda', 'Read the brief'),
        task('follow_up', 'File the expense'),
        task('outcome', 'Signed agreement'),
        task('related', 'Quarterly plan'),
      ],
      relations: [
        relation('contained', 'Breakout'),
        relation('follow_up', 'Debrief'),
        relation('related', 'Site visit'),
      ],
    });

    expect(bandTitles(arc, 'before')).toEqual(['Check the schedule']);
    expect(bandTitles(arc, 'during')).toEqual(['Read the brief', 'Breakout']);
    expect(bandTitles(arc, 'after')).toEqual(['File the expense', 'Signed agreement', 'Debrief']);
    expect(bandTitles(arc, 'related')).toEqual(['Quarterly plan', 'Site visit']);
    expect(arc.empty).toBe(false);
  });

  it('puts a contained task with its contained relations', () => {
    const arc = buildEventArc({
      linkedTasks: [task('contained', 'Scheduled work')],
      relations: [],
    });
    expect(bandTitles(arc, 'during')).toEqual(['Scheduled work']);
  });

  it('reports an event with nothing attached as empty in every band', () => {
    const arc = buildEventArc({ linkedTasks: [], relations: [] });
    expect(arc.empty).toBe(true);
    expect(arc.bands.every((band) => band.empty)).toBe(true);
  });

  it('counts each band for a surface that cannot list them', () => {
    expect(
      eventArcCounts({
        linkedTasks: [task('prep', 'One'), task('prep', 'Two')],
        relations: [relation('follow_up', 'Debrief')],
      }),
    ).toEqual({ before: 2, during: 0, after: 1, related: 0 });
  });
});
