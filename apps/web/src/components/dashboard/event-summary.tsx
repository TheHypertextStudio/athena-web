'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar as CalendarIcon, Clock, MapPin, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { eventsApi, type Event } from '@/lib/api-client';

function formatEventTime(startTime: string, endTime: string | null, isAllDay: boolean): string {
  if (isAllDay) return 'All day';

  const start = new Date(startTime);
  const timeFormat = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (!endTime) return timeFormat.format(start);

  const end = new Date(endTime);
  return `${timeFormat.format(start)} - ${timeFormat.format(end)}`;
}

function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function EventSummary() {
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEvents() {
      try {
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 7);

        const response = await eventsApi.list({
          startDate: now.toISOString(),
          endDate: endDate.toISOString(),
        });
        setEvents(response.data.slice(0, 5));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load events');
      } finally {
        setIsLoading(false);
      }
    }
    void fetchEvents();
  }, []);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Events</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Upcoming Events</CardTitle>
        <Link
          href="/calendar"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          View calendar <ArrowRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-muted-foreground text-sm">No upcoming events this week.</p>
        ) : (
          <ul className="space-y-4">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/calendar?event=${event.id}`}
                  className="hover:bg-accent block rounded-lg p-2 transition-colors"
                >
                  <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
                    <CalendarIcon className="h-3 w-3" />
                    {formatEventDate(event.startTime)}
                  </div>
                  <p className="font-medium">{event.title}</p>
                  <div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatEventTime(event.startTime, event.endTime, event.isAllDay)}
                    </span>
                    {event.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {event.location}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
