import type {
  RelationCommandPort,
  RelationEndpoint,
  RelationIntent,
} from '@docket/work/relation-contract';

/** Calendar-item relations owned by the Calendar application domain. */
export type CalendarRelationId =
  'calendar-item.related' | 'calendar-item.contained' | 'calendar-item.follow-up';

/** Narrow Calendar relation intent accepted by the Calendar command port. */
export interface CalendarRelationIntent extends Omit<RelationIntent, 'relationId' | 'subjects'> {
  readonly relationId: CalendarRelationId;
  readonly subjects: readonly (RelationEndpoint & { readonly kind: 'calendar_item' })[];
}

/** Calendar-owned operation injected into the relation port. */
export interface CalendarRelationDependencies {
  readonly relate: (
    sourceItemId: string,
    targetItemId: string,
    role: 'related' | 'contained' | 'follow_up',
  ) => Promise<'applied' | 'unchanged'>;
}

/** Build the Calendar relation command port from its typed application operation. */
export function createCalendarRelationCommandPort(
  dependencies: CalendarRelationDependencies,
): RelationCommandPort<CalendarRelationIntent> {
  return {
    execute: async (intent) => {
      const role =
        intent.relationId === 'calendar-item.related'
          ? 'related'
          : intent.relationId === 'calendar-item.contained'
            ? 'contained'
            : 'follow_up';
      let applied = false;
      for (const subject of intent.subjects) {
        const result = await dependencies.relate(subject.id, intent.target.id, role);
        if (result === 'applied') applied = true;
      }
      return { status: applied ? 'applied' : 'unchanged' };
    },
  };
}
