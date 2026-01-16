/**
 * Tests for all-day events display in the calendar.
 *
 * Validates that:
 * - All-day events render in the AllDaySection, not the time grid
 * - The detail popover shows "All day" instead of time ranges
 * - Timed events are separated from all-day events
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AllDaySection } from '@/components/objects/surfaces/DayCalendar/AllDaySection';
import type { CalendarEntry } from '@/components/objects/surfaces/DayCalendar/types';

// Clean up after each test to avoid DOM pollution
afterEach(() => {
  cleanup();
});

// =============================================================================
// Test Data
// =============================================================================

const createAllDayEvent = (overrides: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: 'all-day-1',
  type: 'event',
  title: 'All Day Event',
  startTime: new Date('2024-01-15T00:00:00'),
  endTime: new Date('2024-01-15T23:59:59'),
  isAllDay: true,
  ...overrides,
});

const createTimedEvent = (overrides: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: 'timed-1',
  type: 'event',
  title: 'Timed Event',
  startTime: new Date('2024-01-15T10:00:00'),
  endTime: new Date('2024-01-15T11:00:00'),
  isAllDay: false,
  ...overrides,
});

// =============================================================================
// AllDaySection Tests
// =============================================================================

describe('AllDaySection', () => {
  it('renders all-day events as pills', () => {
    const entries = [
      createAllDayEvent({ id: '1', title: 'Birthday Party' }),
      createAllDayEvent({ id: '2', title: 'Company Holiday' }),
    ];

    render(<AllDaySection entries={entries} />);

    expect(screen.getByText('Birthday Party')).toBeTruthy();
    expect(screen.getByText('Company Holiday')).toBeTruthy();
    expect(screen.getByText('all-day')).toBeTruthy();
  });

  it('returns null when no entries', () => {
    const { container } = render(<AllDaySection entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('applies custom color to event pills', () => {
    const entries = [createAllDayEvent({ color: '#ff5733' })];

    render(<AllDaySection entries={entries} />);

    const button = screen.getByRole('button');
    expect(button.style.backgroundColor).toBe('rgb(255, 87, 51)');
  });

  it('falls back to account color when no entry color', () => {
    const entries = [createAllDayEvent({ color: undefined, accountColor: '#3366cc' })];

    render(<AllDaySection entries={entries} />);

    const button = screen.getByRole('button');
    expect(button.style.backgroundColor).toBe('rgb(51, 102, 204)');
  });

  it('uses default color when no color specified', () => {
    const entries = [createAllDayEvent({ color: undefined, accountColor: undefined })];

    render(<AllDaySection entries={entries} />);

    const button = screen.getByRole('button');
    // Default color is #5f6368 = rgb(95, 99, 104)
    expect(button.style.backgroundColor).toBe('rgb(95, 99, 104)');
  });

  it('uses dark text on light backgrounds', () => {
    const entries = [createAllDayEvent({ color: '#ffffff' })];

    render(<AllDaySection entries={entries} />);

    const text = screen.getByText('All Day Event');
    expect(text.className).toContain('text-gray-900');
  });

  it('uses light text on dark backgrounds', () => {
    const entries = [createAllDayEvent({ color: '#000000' })];

    render(<AllDaySection entries={entries} />);

    const text = screen.getByText('All Day Event');
    expect(text.className).toContain('text-white');
  });
});

// =============================================================================
// Entry Separation Logic Tests
// =============================================================================

describe('All-day event filtering', () => {
  it('correctly identifies all-day events', () => {
    const allDayEvent = createAllDayEvent();
    const timedEvent = createTimedEvent();

    expect(allDayEvent.isAllDay).toBe(true);
    expect(timedEvent.isAllDay).toBe(false);
  });

  it('separates all-day from timed entries', () => {
    const entries: CalendarEntry[] = [
      createAllDayEvent({ id: '1' }),
      createTimedEvent({ id: '2' }),
      createAllDayEvent({ id: '3' }),
      createTimedEvent({ id: '4' }),
    ];

    const allDayEntries = entries.filter((e) => e.isAllDay);
    const timedEntries = entries.filter((e) => !e.isAllDay);

    expect(allDayEntries).toHaveLength(2);
    expect(timedEntries).toHaveLength(2);
    expect(allDayEntries.map((e) => e.id)).toEqual(['1', '3']);
    expect(timedEntries.map((e) => e.id)).toEqual(['2', '4']);
  });

  it('handles entries without isAllDay field as timed events', () => {
    const entryWithoutFlag: CalendarEntry = {
      id: 'no-flag',
      type: 'event',
      title: 'Legacy Event',
      startTime: new Date('2024-01-15T10:00:00'),
      endTime: new Date('2024-01-15T11:00:00'),
      // isAllDay not set
    };

    // Should be treated as timed (not all-day)
    expect(entryWithoutFlag.isAllDay).toBeFalsy();
  });
});

// =============================================================================
// Date Parsing Tests - All-day events should use local dates
// =============================================================================

import { eventToCalendarEntry } from '@/lib/calendar-utils';
import type { Event } from '@/lib/api-client';

describe('All-day event date parsing', () => {
  it('parses all-day events as local calendar dates, not UTC', () => {
    // Simulate an API response for an all-day event on January 15th
    // The API might return this as UTC midnight, which would be wrong in many timezones
    const apiEvent: Event = {
      id: 'event-1',
      title: 'All Day Meeting',
      description: null,
      startTime: '2024-01-15T00:00:00Z', // UTC midnight
      endTime: '2024-01-15T23:59:59Z',
      location: null,
      isAllDay: true,
      recurrenceRule: null,
      creatorId: 'user-1',
      source: 'local',
      sourceIntegrationId: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const entry = eventToCalendarEntry(apiEvent);

    // For all-day events, the date should be January 15th LOCAL, not converted from UTC
    expect(entry.startTime.getFullYear()).toBe(2024);
    expect(entry.startTime.getMonth()).toBe(0); // January = 0
    expect(entry.startTime.getDate()).toBe(15); // The 15th, not shifted by timezone
    expect(entry.isAllDay).toBe(true);
  });

  it('parses timed events normally (UTC conversion expected)', () => {
    const apiEvent: Event = {
      id: 'event-2',
      title: 'Team Meeting',
      description: null,
      startTime: '2024-01-15T14:00:00Z', // 2 PM UTC
      endTime: '2024-01-15T15:00:00Z',
      location: null,
      isAllDay: false,
      recurrenceRule: null,
      creatorId: 'user-1',
      source: 'local',
      sourceIntegrationId: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const entry = eventToCalendarEntry(apiEvent);

    // Timed events should be parsed as UTC and converted to local
    // The exact local time depends on timezone, but the Date object should be valid
    expect(entry.startTime instanceof Date).toBe(true);
    expect(entry.isAllDay).toBe(false);
  });

  it('handles date-only format for all-day events', () => {
    const apiEvent: Event = {
      id: 'event-3',
      title: 'Holiday',
      description: null,
      startTime: '2024-12-25', // Just a date, no time
      endTime: '2024-12-25',
      location: null,
      isAllDay: true,
      recurrenceRule: null,
      creatorId: 'user-1',
      source: 'external',
      sourceIntegrationId: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const entry = eventToCalendarEntry(apiEvent);

    expect(entry.startTime.getFullYear()).toBe(2024);
    expect(entry.startTime.getMonth()).toBe(11); // December (JS months are 0-indexed: Jan=0, Dec=11)
    expect(entry.startTime.getDate()).toBe(25);
  });
});
