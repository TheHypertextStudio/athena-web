'use client';

import { DndContext } from '@dnd-kit/core';
import { DayCalendar } from '@/components/objects/surfaces/DayCalendar';
import { EntryCreationPopover } from '@/components/calendar/EntryCreationPopover';
import { EntryContextMenu } from '@/components/calendar/EntryContextMenu';
import { surfaceId } from '@/components/objects/types';
import { useCalendarState } from '@/hooks/useCalendarState';
import { useCalendarData } from '@/hooks/useCalendarData';
import { useMemo } from 'react';

export default function HomePage() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

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
    <DndContext>
      <main className="h-screen overflow-hidden p-4 md:p-6">
        <div className="mx-auto h-full max-w-3xl">
          <DayCalendar
            date={calendar.date}
            entries={calendar.entries}
            startHour={0}
            endHour={24}
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
    </DndContext>
  );
}
