/**
 * Daily agenda page.
 *
 * @packageDocumentation
 */

'use client';

import { useState } from 'react';
import { getTodayDate } from '@/hooks/use-agenda';
import { AgendaHeader } from '@/components/agenda/agenda-header';
import { DailyView } from '@/components/agenda/daily-view';

export default function AgendaPage() {
  const [selectedDate, setSelectedDate] = useState(getTodayDate);

  return (
    <div className="flex h-full flex-col">
      <AgendaHeader date={selectedDate} onDateChange={setSelectedDate} view="daily" />
      <div className="flex-1 overflow-auto">
        <DailyView date={selectedDate} />
      </div>
    </div>
  );
}
