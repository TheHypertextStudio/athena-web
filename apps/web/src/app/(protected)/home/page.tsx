'use client';

import { useMemo } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { DayCalendar } from '@/components/objects/surfaces/DayCalendar';
import { EntryCreationPopover } from '@/components/calendar/EntryCreationPopover';
import { EntryContextMenu } from '@/components/calendar/EntryContextMenu';
import { EntryDetailPopover } from '@/components/calendar/EntryDetailPopover';
import { surfaceId } from '@/components/objects/types';
import { useCalendarState } from '@/hooks/useCalendarState';
import { useCalendarData } from '@/hooks/useCalendarData';
import { useAutoCalendarSync } from '@/hooks/useCalendarSync';

export default function HomePage() {
  // Auto-sync calendar data on page load
  useAutoCalendarSync();
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

  return (
    <DndContext sensors={sensors}>
      <main className="h-screen overflow-hidden p-4 md:p-6">
        <div className="mx-auto h-full max-w-xl">
          <DayCalendar
            date={calendar.date}
            entries={calendar.entries}
            startHour={0}
            endHour={24}
            scrollMode="scroll"
            id={surfaceId('home-calendar')}
            className="h-full"
            previewEntry={calendar.previewEntry}
            {...calendar.handlers}
          />
        </div>
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
        onDelete={(entry) => {
          calendar.deleteEntry(entry.id);
        }}
      />
    </DndContext>
  );
}
