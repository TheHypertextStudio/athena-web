/**
 * Calendar data hook that combines events and time blocks.
 *
 * Fetches both events and time blocks for a given date and provides
 * unified mutation callbacks for calendar operations.
 *
 * @packageDocumentation
 */

'use client';

import { useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CalendarEntry } from '@/components/objects/surfaces/DayCalendar';
import {
  useEventsForDay,
  useUndoableCreateEvent,
  useUndoableUpdateEvent,
  useUndoableDeleteEvent,
} from './useEvents';
import {
  useTimeBlocksForDay,
  useUndoableCreateTimeBlock,
  useUndoableUpdateTimeBlock,
  useUndoableDeleteTimeBlock,
} from './useTimeBlocks';
import { useCalendarPush, useCalendarSync } from './useCalendarSync';
import {
  toCalendarEntries,
  calendarEntryToEventInput,
  calendarEntryToTimeBlockInput,
  calendarUpdateToEventUpdate,
  calendarUpdateToTimeBlockUpdate,
  getDayBounds,
  type AccountColorMap,
} from '@/lib/calendar-utils';
import { eventKeys, timeBlockKeys } from '@/lib/api-client';
import { useSnackbar } from '@/components/ui/snackbar';

export interface UseCalendarDataOptions {
  date: Date;
}

export interface UseCalendarDataReturn {
  entries: CalendarEntry[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  createEntry: (entry: Omit<CalendarEntry, 'id'>) => Promise<void>;
  updateEntry: (
    entryId: string,
    updates: Partial<CalendarEntry>,
    type: 'event' | 'time-block',
  ) => Promise<void>;
  deleteEntry: (entryId: string, type: 'event' | 'time-block') => Promise<void>;
  moveEntry: (
    entryId: string,
    newStart: Date,
    newEnd: Date,
    type: 'event' | 'time-block',
  ) => Promise<void>;
  resizeEntry: (
    entryId: string,
    newStart: Date,
    newEnd: Date,
    type: 'event' | 'time-block',
  ) => Promise<void>;
  refetch: () => void;
}

/**
 * Hook for fetching and managing calendar data for a specific date.
 *
 * Combines events and time blocks into a unified CalendarEntry array
 * and provides mutation callbacks that route to the appropriate API.
 */
export function useCalendarData({ date }: UseCalendarDataOptions): UseCalendarDataReturn {
  const queryClient = useQueryClient();
  const snackbar = useSnackbar();
  const { startDate, endDate } = getDayBounds(date);

  // Calendar sync integration
  const { hasBidirectionalSync, syncEvent, deleteEvent: deleteFromExternal } = useCalendarPush();
  const { connections } = useCalendarSync();

  // Build account color map from connections
  const accountColorMap = useMemo<AccountColorMap>(() => {
    const map = new Map<string, string | null>();
    for (const conn of connections) {
      map.set(conn.id, conn.accountColor);
    }
    return map;
  }, [connections]);

  // Fetch events and time blocks
  const eventsQuery = useEventsForDay(date);
  const timeBlocksQuery = useTimeBlocksForDay(date);

  // Undoable mutations
  const createEvent = useUndoableCreateEvent();
  const updateEvent = useUndoableUpdateEvent();
  const deleteEvent = useUndoableDeleteEvent();
  const createTimeBlock = useUndoableCreateTimeBlock();
  const updateTimeBlock = useUndoableUpdateTimeBlock();
  const deleteTimeBlock = useUndoableDeleteTimeBlock();

  // Combine into calendar entries
  const entries = useMemo(() => {
    const events = eventsQuery.data?.data ?? [];
    const timeBlocks = timeBlocksQuery.data?.data ?? [];
    return toCalendarEntries(events, timeBlocks, accountColorMap);
  }, [eventsQuery.data, timeBlocksQuery.data, accountColorMap]);

  // Create entry callback
  const createEntry = useCallback(
    async (entry: Omit<CalendarEntry, 'id'>) => {
      if (entry.type === 'event') {
        const result = await createEvent.mutateAsync(calendarEntryToEventInput(entry));
        snackbar.show({ message: 'Event created' });

        // Sync to external calendars if bidirectional sync is enabled
        if (hasBidirectionalSync) {
          syncEvent(result.data.id);
        }
      } else {
        await createTimeBlock.mutateAsync(calendarEntryToTimeBlockInput(entry));
        snackbar.show({ message: 'Time block created' });
      }
    },
    [createEvent, createTimeBlock, snackbar, hasBidirectionalSync, syncEvent],
  );

  // Update entry callback
  const updateEntry = useCallback(
    async (entryId: string, updates: Partial<CalendarEntry>, type: 'event' | 'time-block') => {
      if (type === 'event') {
        await updateEvent.mutateAsync({
          id: entryId,
          data: calendarUpdateToEventUpdate(updates),
        });

        // Sync update to external calendars if bidirectional sync is enabled
        if (hasBidirectionalSync) {
          syncEvent(entryId);
        }
      } else {
        await updateTimeBlock.mutateAsync({
          id: entryId,
          data: calendarUpdateToTimeBlockUpdate(updates),
        });
      }
    },
    [updateEvent, updateTimeBlock, hasBidirectionalSync, syncEvent],
  );

  // Delete entry callback
  const deleteEntry = useCallback(
    async (entryId: string, type: 'event' | 'time-block') => {
      // Find the entry to get its data for undo
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) return;

      if (type === 'event') {
        // Delete from external calendars BEFORE local delete
        // (so the mapping still exists when we try to find it)
        if (hasBidirectionalSync) {
          deleteFromExternal(entryId);
        }

        // Get event data from cache or entry
        const events = eventsQuery.data?.data ?? [];
        const eventData = events.find((e) => e.id === entryId);
        if (eventData) {
          await deleteEvent.mutateAsync({ id: entryId, eventData });
          snackbar.show({ message: 'Event deleted' });
        }
      } else {
        // Get time block data from cache or entry
        const timeBlocks = timeBlocksQuery.data?.data ?? [];
        const blockData = timeBlocks.find((b) => b.id === entryId);
        if (blockData) {
          await deleteTimeBlock.mutateAsync({ id: entryId, blockData });
          snackbar.show({ message: 'Time block deleted' });
        }
      }
    },
    [
      deleteEvent,
      deleteTimeBlock,
      snackbar,
      entries,
      eventsQuery.data,
      timeBlocksQuery.data,
      hasBidirectionalSync,
      deleteFromExternal,
    ],
  );

  // Move entry callback (convenience wrapper around updateEntry)
  const moveEntry = useCallback(
    async (entryId: string, newStart: Date, newEnd: Date, type: 'event' | 'time-block') => {
      await updateEntry(entryId, { startTime: newStart, endTime: newEnd }, type);
      snackbar.show({
        message: type === 'event' ? 'Event moved' : 'Time block moved',
      });
    },
    [updateEntry, snackbar],
  );

  // Resize entry callback (convenience wrapper around updateEntry)
  const resizeEntry = useCallback(
    async (entryId: string, newStart: Date, newEnd: Date, type: 'event' | 'time-block') => {
      await updateEntry(entryId, { startTime: newStart, endTime: newEnd }, type);
      snackbar.show({
        message: type === 'event' ? 'Event updated' : 'Time block updated',
      });
    },
    [updateEntry, snackbar],
  );

  // Refetch both queries
  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: eventKeys.list({ startDate, endDate }) });
    void queryClient.invalidateQueries({ queryKey: timeBlockKeys.list({ startDate, endDate }) });
  }, [queryClient, startDate, endDate]);

  return {
    entries,
    isLoading: eventsQuery.isLoading || timeBlocksQuery.isLoading,
    isError: eventsQuery.isError || timeBlocksQuery.isError,
    error: eventsQuery.error ?? timeBlocksQuery.error,
    createEntry,
    updateEntry,
    deleteEntry,
    moveEntry,
    resizeEntry,
    refetch,
  };
}
