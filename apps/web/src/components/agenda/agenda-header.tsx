/**
 * Agenda header with date navigation and view toggle.
 *
 * @packageDocumentation
 */

'use client';

import Link from 'next/link';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate, isToday } from '@/hooks/use-agenda';

interface AgendaHeaderProps {
  /** Currently selected date (YYYY-MM-DD) */
  date: string;
  /** Callback when date changes */
  onDateChange: (date: string) => void;
  /** Current view mode */
  view: 'daily' | 'weekly';
}

/**
 * Header component for agenda views with date navigation.
 */
export function AgendaHeader({ date, onDateChange, view }: AgendaHeaderProps) {
  function goToPreviousDay() {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    onDateChange(d.toISOString().slice(0, 10));
  }

  function goToNextDay() {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    onDateChange(d.toISOString().slice(0, 10));
  }

  function goToToday() {
    onDateChange(new Date().toISOString().slice(0, 10));
  }

  const todaySelected = isToday(date);

  return (
    <div className="flex items-center justify-between border-b px-6 py-4">
      {/* Date Navigation */}
      <div className="flex items-center gap-2">
        <Button variant="outlined" size="icon" onClick={goToPreviousDay} aria-label="Previous day">
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Button variant={todaySelected ? 'filled' : 'outlined'} size="sm" onClick={goToToday}>
          Today
        </Button>

        <Button variant="outlined" size="icon" onClick={goToNextDay} aria-label="Next day">
          <ChevronRight className="h-4 w-4" />
        </Button>

        <h1 className="ml-4 text-xl font-semibold">{formatDate(date)}</h1>
      </div>

      {/* View Toggle */}
      <div className="flex items-center gap-2">
        <Link href="/home">
          <Button variant={view === 'daily' ? 'filled' : 'text'} size="sm">
            <Calendar className="mr-2 h-4 w-4" />
            Daily
          </Button>
        </Link>
        <Link href="/home/weekly">
          <Button variant={view === 'weekly' ? 'filled' : 'text'} size="sm">
            <Calendar className="mr-2 h-4 w-4" />
            Weekly
          </Button>
        </Link>
      </div>
    </div>
  );
}
