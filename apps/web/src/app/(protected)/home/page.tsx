'use client';

import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { CalendarContainer } from '@/components/objects/surfaces/CalendarContainer';
import { EntryCreationPopover } from '@/components/calendar/EntryCreationPopover';
import { EntryCreationDialog } from '@/components/calendar/EntryCreationDialog';
import { EntryContextMenu } from '@/components/calendar/EntryContextMenu';
import { EntryDetailPopover } from '@/components/calendar/EntryDetailPopover';
import { surfaceId } from '@/components/objects/types';
import { useCalendarState } from '@/hooks/useCalendarState';
import { useCalendarData } from '@/hooks/useCalendarData';
import { useAutoCalendarSync } from '@/hooks/useCalendarSync';
import { useCalendarViewMode } from '@/hooks/useCalendarViewMode';
import { CalendarTimezoneProvider } from '@/contexts/TimezoneContext';

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

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Configure drag activation: require 5px movement before drag starts
  // This allows clicks to work normally
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const calendarData = useCalendarData({ date: today });

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
              date={calendar.date}
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
      </DndContext>
    </CalendarTimezoneProvider>
  );
}
