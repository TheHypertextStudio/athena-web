/**
 * Agenda surface for step 3 of onboarding.
 *
 * Displays AI-generated agenda using the DayCalendar component:
 * - Shows time blocks generated based on intent and calendar data
 * - Allows drag to reorder and resize
 * - Uses streaming to show blocks as they're generated
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useMemo, useCallback } from 'react';
import type { MouseEvent } from 'react';
import { motion } from 'framer-motion';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import EventIcon from '@mui/icons-material/Event';
import { useOnboarding } from '@/hooks/use-onboarding';
import { useOnboardingStore } from '@/lib/onboarding';
import { Button } from '@/components/ui/button';
import { DayCalendar } from '@/components/objects/surfaces/DayCalendar';
import type { CalendarEntry } from '@/components/objects/surfaces/DayCalendar/types';
import { SelectionProvider } from '@/components/objects/context/SelectionContext';
import { ONBOARDING_TEST_IDS } from '../test-ids';

/**
 * AgendaSurface component for displaying AI-generated agenda.
 */
export function AgendaSurface() {
  const { agendaEntries, agendaLoading, agendaGenerated, addMessage, updateAgendaEntry } =
    useOnboardingStore();
  const { generateAgenda, isLoading } = useOnboarding();

  // Generate agenda on mount if not already generated
  useEffect(() => {
    if (!agendaGenerated && !agendaLoading && !isLoading) {
      const today = new Date().toISOString().split('T')[0] ?? '';
      if (today) {
        void generateAgenda(today);
      }
    }
  }, [agendaGenerated, agendaLoading, isLoading, generateAgenda]);

  // Notify Athena when agenda is generated
  useEffect(() => {
    if (agendaGenerated && agendaEntries.length > 0) {
      const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
      addMessage(
        'athena',
        `Here's your ${dayName}. I've added focus time around your schedule. Drag anything to move it.`,
      );
    }
  }, [agendaGenerated, agendaEntries.length, addMessage]);

  // Convert onboarding time blocks to CalendarEntry format
  const calendarEntries: CalendarEntry[] = useMemo(() => {
    return agendaEntries.map((entry, index) => ({
      id: `onboarding-${String(index)}`,
      type: 'time-block' as const,
      title: entry.title,
      startTime: new Date(entry.startTime),
      endTime: new Date(entry.endTime),
      color: entry.color ?? '#8b5cf6', // Purple for AI-generated
      source: 'local' as const,
    }));
  }, [agendaEntries]);

  // Handle entry click - show details or allow editing
  const handleEntryClick = useCallback((entry: CalendarEntry, _e: MouseEvent) => {
    // In onboarding, clicking an entry could open a detail modal
    // For now, we just log and allow selection (handled by DayCalendar)
    console.log('Entry clicked:', entry.id);
  }, []);

  // Handle entry move via drag
  const handleEntryMove = useCallback(
    (entryId: string, newStart: Date, newEnd: Date) => {
      // Update local state with new times
      updateAgendaEntry(entryId, {
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
      });
    },
    [updateAgendaEntry],
  );

  // Handle entry resize
  const handleEntryResize = useCallback(
    (entryId: string, newStart: Date, newEnd: Date) => {
      // Update local state with new times
      updateAgendaEntry(entryId, {
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
      });
    },
    [updateAgendaEntry],
  );

  const formattedDate = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, []);

  const today = useMemo(() => new Date(), []);

  return (
    <div className="mx-auto max-w-3xl" data-testid={ONBOARDING_TEST_IDS.agenda.surface}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-headline-small text-on-surface">Your day at a glance</h2>
          <p
            className="text-body-medium text-on-surface-variant"
            data-testid={ONBOARDING_TEST_IDS.agenda.date}
          >
            {formattedDate}
          </p>
        </div>
      </div>

      {/* Loading state */}
      {agendaLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex h-96 items-center justify-center"
          data-testid={ONBOARDING_TEST_IDS.agenda.loading}
        >
          <div className="text-center">
            <div className="border-primary mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
            <p className="text-body-medium text-on-surface-variant">
              Generating your personalized agenda...
            </p>
          </div>
        </motion.div>
      )}

      {/* Calendar view */}
      {!agendaLoading && agendaEntries.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          data-testid={ONBOARDING_TEST_IDS.agenda.calendar}
        >
          <SelectionProvider>
            <DayCalendar
              date={today}
              entries={calendarEntries}
              viewMode="day"
              scrollMode="fit"
              startHour={6}
              endHour={22}
              onEntryClick={handleEntryClick}
              onEntryMove={handleEntryMove}
              onEntryResize={handleEntryResize}
              className="border-outline-variant h-[500px] border"
            />
          </SelectionProvider>
        </motion.div>
      )}

      {/* Empty state */}
      {!agendaLoading && agendaEntries.length === 0 && agendaGenerated && (
        <div className="py-12 text-center" data-testid={ONBOARDING_TEST_IDS.agenda.empty}>
          <p className="text-body-large text-on-surface-variant">
            No agenda items yet. Connect a calendar to see your schedule.
          </p>
        </div>
      )}

      {/* Legend */}
      {agendaEntries.length > 0 && (
        <div
          className="text-body-small text-on-surface-variant mt-6 flex flex-wrap items-center gap-4"
          data-testid={ONBOARDING_TEST_IDS.agenda.legend}
        >
          <div className="flex items-center gap-2">
            <EventIcon sx={{ fontSize: 16 }} />
            <span>Calendar event</span>
          </div>
          <div className="flex items-center gap-2">
            <AutoAwesomeIcon sx={{ fontSize: 16 }} />
            <span>AI suggested</span>
          </div>
        </div>
      )}

      {/* Regenerate button */}
      {agendaGenerated && !agendaLoading && (
        <div className="mt-6 text-center">
          <Button
            variant="text"
            size="sm"
            onClick={() => {
              const todayStr = new Date().toISOString().split('T')[0] ?? '';
              if (todayStr) {
                void generateAgenda(todayStr);
              }
            }}
            data-testid={ONBOARDING_TEST_IDS.agenda.regenerate}
          >
            Regenerate agenda
          </Button>
        </div>
      )}
    </div>
  );
}
