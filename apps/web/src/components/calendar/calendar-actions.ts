'use client';

/** Calendar-item relation actions shared by every calendar renderer. */
import { CornerDownLeft, Link, Workflow } from '@docket/ui/icons';
import { CalendarItemId } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { createCalendarRelationCommandPort } from '@/components/calendar/calendar-relation-port';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
import { type ActionContext, defineActionDomain, useRegisterActionDomain } from '@/lib/actions';
import { api } from '@/lib/api';
import { UserFacingError } from '@/lib/problem';
import { queryKeys, unwrap } from '@/lib/query';

const RELATION_RESPONSIVENESS = {
  // The shared relation adapter owns painted and spoken feedback for these commands.
  ownership: 'autonomous',
} as const;

/** Register related, contained, and follow-up calendar-item relations. */
export function useRegisterCalendarActions(): void {
  const queryClient = useQueryClient();
  const pickerOverlay = usePickerOverlay();
  const definitions = useMemo(() => {
    const port = createCalendarRelationCommandPort({
      relate: async (sourceItemId, targetItemId, role) => {
        try {
          await unwrap(
            () =>
              api.v1.me.calendar.items[':id'].relations.$post({
                param: { id: CalendarItemId.parse(sourceItemId) },
                json: { targetItemId: CalendarItemId.parse(targetItemId), role },
              }),
            'Could not relate the calendar items.',
          );
        } catch (error) {
          if (error instanceof UserFacingError && error.status === 409) return 'unchanged';
          throw error;
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.calendarItem(sourceItemId) }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.calendarItemRelations(sourceItemId),
          }),
        ]);
        return 'applied';
      },
    });
    const relate = async (
      context: ActionContext,
      relationId: 'calendar-item.related' | 'calendar-item.contained' | 'calendar-item.follow-up',
    ): Promise<void> => {
      const source = context.objects.find(
        (object) => object.kind === 'calendar_event' || object.kind === 'time_block',
      );
      const target = context.target;
      if (target === undefined) {
        pickerOverlay.open({
          kind: 'relation-target',
          relationId,
          organizationId: context.organizationId,
          subjects: context.objects,
        });
        return;
      }
      if (
        source === undefined ||
        (target.kind !== 'calendar_event' && target.kind !== 'time_block')
      )
        return;
      const destinationOwnsRelation = context.source === 'drag' || context.source === 'shortcut';
      const effectiveRelationId = destinationOwnsRelation
        ? target.kind === 'time_block'
          ? 'calendar-item.contained'
          : 'calendar-item.related'
        : relationId;
      // Scheduling destinations own their outgoing edges. A drop into a time block means that the
      // block contains the dragged event, while picker actions keep the selected source as owner.
      const relationSource = destinationOwnsRelation ? target : source;
      const relationTarget = destinationOwnsRelation ? source : target;
      await port.execute({
        relationId: effectiveRelationId,
        effect: 'link',
        subjects: [
          {
            kind: 'calendar_item',
            id: relationSource.id,
            organizationId: relationSource.organizationId,
          },
        ],
        target: {
          kind: 'calendar_item',
          id: relationTarget.id,
          organizationId: relationTarget.organizationId,
        },
      });
    };
    return defineActionDomain('calendar', [
      {
        id: 'calendar.related',
        relationId: 'calendar-item.related',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Relate calendar items',
        icon: Link,
        objectKinds: ['calendar_event', 'time_block'],
        section: 'organize',
        run: (context) => relate(context, 'calendar-item.related'),
      },
      {
        id: 'calendar.contained',
        relationId: 'calendar-item.contained',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Contain calendar item',
        icon: CornerDownLeft,
        objectKinds: ['calendar_event', 'time_block'],
        section: 'organize',
        run: (context) => relate(context, 'calendar-item.contained'),
      },
      {
        id: 'calendar.followUp',
        relationId: 'calendar-item.follow-up',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Mark as follow-up',
        icon: Workflow,
        objectKinds: ['calendar_event', 'time_block'],
        section: 'organize',
        run: (context) => relate(context, 'calendar-item.follow-up'),
      },
    ]);
  }, [pickerOverlay, queryClient]);

  useRegisterActionDomain('calendar', definitions);
}
