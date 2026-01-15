'use client';

import { useState, useCallback, type MouseEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { CalendarContainer } from '@/components/objects/surfaces/CalendarContainer';
import { EntryCreationPopover } from '@/components/calendar/EntryCreationPopover';
import { EntryCreationDialog } from '@/components/calendar/EntryCreationDialog';
import { EntryContextMenu } from '@/components/calendar/EntryContextMenu';
import { EntryDetailPopover } from '@/components/calendar/EntryDetailPopover';
import { TimeBlockDetailModal, TimeBlockTaskSelector } from '@/components/calendar';
import { surfaceId } from '@/components/objects/types';
import { useCalendarState } from '@/hooks/useCalendarState';
import { useCalendarData } from '@/hooks/useCalendarData';
import { useAutoCalendarSync } from '@/hooks/useCalendarSync';
import { useCalendarViewMode } from '@/hooks/useCalendarViewMode';
import { CalendarTimezoneProvider } from '@/contexts/TimezoneContext';
import { useTasksData } from '@/hooks/useTasksData';
import {
  useLinkTaskToTimeBlock,
  useUnlinkTaskFromTimeBlock,
  useUpdateTimeBlock,
  useDeleteTimeBlock,
} from '@/hooks/useTimeBlocks';
import type { TimeBlock, TimeBlockLinkedTask } from '@/lib/api-client';
import type { CalendarEntry } from '@/components/objects/surfaces/DayCalendar';

/**
 * Width configuration for each view mode.
 * Day view is narrow and focused; week/month views need more space.
 * Day width must accommodate header controls (nav, timezone, view toggle, zoom).
 */
const VIEW_WIDTHS = {
  day: 480,
  week: 1152,
  month: 1152,
} as const;

export default function HomePage() {
  // Auto-sync calendar data on page load
  useAutoCalendarSync();

  // View mode state - lifted up for animated width control
  const { viewMode, setViewMode } = useCalendarViewMode();
  const prefersReducedMotion = useReducedMotion();

  // Lifted date state - controls both data fetching and display
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Configure drag activation: require 5px movement before drag starts
  // This allows clicks to work normally
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const calendarData = useCalendarData({ date: selectedDate });

  // Tasks data for task selector
  const { tasks, isLoading: tasksLoading } = useTasksData({
    filters: { status: 'all' },
  });

  // Time block mutations
  const linkTask = useLinkTaskToTimeBlock();
  const unlinkTask = useUnlinkTaskFromTimeBlock();
  const updateTimeBlockMutation = useUpdateTimeBlock();
  const deleteTimeBlockMutation = useDeleteTimeBlock();

  // Time block modal state
  const [timeBlockModal, setTimeBlockModal] = useState<{
    open: boolean;
    timeBlock: TimeBlock | null;
  }>({ open: false, timeBlock: null });

  const [taskSelectorState, setTaskSelectorState] = useState<{
    open: boolean;
    anchorRect: DOMRect | null;
  }>({ open: false, anchorRect: null });

  const calendar = useCalendarState({
    entries: calendarData.entries,
    mutations: {
      onCreateEntry: calendarData.createEntry,
      onUpdateEntry: calendarData.updateEntry,
      onDeleteEntry: calendarData.deleteEntry,
      onMoveEntry: calendarData.moveEntry,
      onResizeEntry: calendarData.resizeEntry,
    },
  });

  // Helper to convert CalendarEntry to TimeBlock for modal
  const entryToTimeBlock = useCallback((entry: CalendarEntry): TimeBlock | null => {
    if (entry.type !== 'time-block') return null;
    return {
      id: entry.id,
      label: entry.title,
      description: null,
      startTime: entry.startTime.toISOString(),
      endTime: entry.endTime.toISOString(),
      color: entry.color ?? null,
      recurrenceRule: entry.recurrenceRule ?? null,
      ownerId: '',
      linkedTasks:
        entry.tasks?.map((t, idx) => ({
          id: t.id,
          title: t.title,
          status: t.completed ? ('completed' as const) : ('pending' as const),
          priority: t.priority ?? ('medium' as const),
          position: idx,
        })) ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, []);

  // Custom entry click handler - opens time block modal for time blocks
  const handleEntryClick = useCallback(
    (entry: CalendarEntry, event: MouseEvent) => {
      if (entry.type === 'time-block') {
        const timeBlock = entryToTimeBlock(entry);
        if (timeBlock) {
          setTimeBlockModal({ open: true, timeBlock });
        }
      } else {
        // Delegate to default handler for events
        calendar.handlers.onEntryClick(entry, event);
      }
    },
    [calendar.handlers, entryToTimeBlock],
  );

  // Time block modal handlers
  const handleTimeBlockUpdate = useCallback(
    async (id: string, data: Partial<TimeBlock>) => {
      await updateTimeBlockMutation.mutateAsync({
        id,
        data: {
          label: data.label,
          description: data.description,
          startTime: data.startTime,
          endTime: data.endTime,
          color: data.color,
        },
      });
      // Refresh calendar data
      calendarData.refetch();
    },
    [updateTimeBlockMutation, calendarData],
  );

  const handleTimeBlockDelete = useCallback(
    async (id: string) => {
      await deleteTimeBlockMutation.mutateAsync(id);
      calendarData.refetch();
    },
    [deleteTimeBlockMutation, calendarData],
  );

  const handleUnlinkTask = useCallback(
    async (timeBlockId: string, taskId: string) => {
      await unlinkTask.mutateAsync({ timeBlockId, taskId });
      // Update local state to reflect the unlink
      setTimeBlockModal((prev) => {
        if (prev.timeBlock?.id !== timeBlockId) return prev;
        return {
          ...prev,
          timeBlock: {
            ...prev.timeBlock,
            linkedTasks: prev.timeBlock.linkedTasks.filter((t) => t.id !== taskId),
          },
        };
      });
      calendarData.refetch();
    },
    [unlinkTask, calendarData],
  );

  const handleLinkTask = useCallback(
    async (taskId: string) => {
      if (!timeBlockModal.timeBlock) return;
      await linkTask.mutateAsync({
        timeBlockId: timeBlockModal.timeBlock.id,
        taskId,
      });
      // Update local state to reflect the link
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        setTimeBlockModal((prev) => {
          if (!prev.timeBlock) return prev;
          const newLinkedTask: TimeBlockLinkedTask = {
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            position: prev.timeBlock.linkedTasks.length,
          };
          return {
            ...prev,
            timeBlock: {
              ...prev.timeBlock,
              linkedTasks: [...prev.timeBlock.linkedTasks, newLinkedTask],
            },
          };
        });
      }
      calendarData.refetch();
    },
    [linkTask, timeBlockModal.timeBlock, tasks, calendarData],
  );

  // Animated container width based on view mode
  const containerWidth = VIEW_WIDTHS[viewMode];

  return (
    <CalendarTimezoneProvider>
      <DndContext sensors={sensors}>
        <main className="h-screen overflow-hidden p-4 md:p-6">
          <motion.div
            className="mx-auto h-full"
            animate={{ maxWidth: containerWidth }}
            initial={false}
            transition={
              prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0, 0, 1] } // MD3 ease-standard
            }
          >
            <CalendarContainer
              date={selectedDate}
              entries={calendar.entries}
              startHour={0}
              endHour={24}
              scrollMode="scroll"
              id={surfaceId('home-calendar')}
              className="h-full"
              previewEntry={calendar.previewEntry}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              {...calendar.handlers}
              onEntryClick={handleEntryClick}
              onDateChange={setSelectedDate}
            />
          </motion.div>
        </main>

        <EntryCreationPopover
          open={calendar.creationDialog.open}
          onOpenChange={calendar.setCreationDialogOpen}
          startTime={calendar.creationDialog.startTime}
          endTime={calendar.creationDialog.endTime}
          anchorRect={calendar.creationDialog.anchorRect}
          onSubmit={calendar.createEntry}
        />

        <EntryContextMenu
          entry={calendar.contextMenu.entry}
          position={calendar.contextMenu.position}
          onClose={calendar.closeContextMenu}
          onEdit={calendar.openEditDialog}
          onDelete={(entry) => {
            calendar.deleteEntry(entry.id);
          }}
          onDuplicate={calendar.duplicateEntry}
        />

        <EntryDetailPopover
          open={calendar.detailPopover.open}
          onOpenChange={(open) => {
            if (!open) calendar.closeDetailPopover();
          }}
          entry={calendar.detailPopover.entry}
          anchorRect={calendar.detailPopover.anchorRect}
          onEdit={calendar.openEditDialog}
          onDelete={(entry) => {
            calendar.deleteEntry(entry.id);
          }}
        />

        {/* Edit Dialog */}
        <EntryCreationDialog
          open={calendar.editDialog.open}
          onOpenChange={(open) => {
            if (!open) calendar.closeEditDialog();
          }}
          startTime={calendar.editDialog.entry?.startTime ?? new Date()}
          endTime={calendar.editDialog.entry?.endTime ?? new Date()}
          entry={calendar.editDialog.entry ?? undefined}
          onSubmit={calendar.createEntry}
          onUpdate={(entryId, updates) => {
            calendar.updateEntry(entryId, updates);
          }}
        />

        {/* Time Block Detail Modal */}
        <TimeBlockDetailModal
          open={timeBlockModal.open}
          timeBlock={timeBlockModal.timeBlock}
          onClose={() => {
            setTimeBlockModal({ open: false, timeBlock: null });
          }}
          onUpdate={handleTimeBlockUpdate}
          onDelete={handleTimeBlockDelete}
          onUnlinkTask={handleUnlinkTask}
          onAddTaskClick={(anchorRect) => {
            setTaskSelectorState({ open: true, anchorRect });
          }}
        />

        {/* Task Selector for Time Blocks */}
        <TimeBlockTaskSelector
          open={taskSelectorState.open}
          tasks={tasks}
          linkedTaskIds={timeBlockModal.timeBlock?.linkedTasks.map((t) => t.id) ?? []}
          isLoading={tasksLoading}
          anchorRect={taskSelectorState.anchorRect}
          onClose={() => {
            setTaskSelectorState({ open: false, anchorRect: null });
          }}
          onSelect={handleLinkTask}
        />
      </DndContext>
    </CalendarTimezoneProvider>
  );
}
