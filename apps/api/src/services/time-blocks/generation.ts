/**
 * Time block generation service.
 *
 * Generates AI-suggested time blocks based on:
 * - User's calendar events
 * - User's stated intent/preferences
 * - Time of day patterns
 *
 * This is a general-purpose service usable for onboarding, daily planning,
 * and schedule reorganization.
 *
 * @packageDocumentation
 */

import { db } from '../../db/index.js';
import { events } from '../../db/schema/index.js';
import { eq, and, gte, lte } from 'drizzle-orm';

/**
 * Generated time block structure.
 */
export interface GeneratedTimeBlock {
  type: 'time_block';
  source: 'ai' | 'calendar';
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  color?: string;
}

/**
 * User intent for personalization.
 */
export interface UserIntent {
  selectedChips: string[];
  customText?: string | null;
}

/**
 * Generation options.
 */
export interface GenerateOptions {
  intent?: UserIntent;
  calendarEventIds?: string[];
}

/**
 * Generation chunk types for streaming.
 */
export type GenerationChunk =
  | { type: 'block'; block: GeneratedTimeBlock }
  | { type: 'done'; totalBlocks: number };

/**
 * Generate personalized time blocks for a date.
 *
 * Yields time blocks as they're generated, suitable for SSE streaming.
 *
 * @param userId - User ID
 * @param date - Date string (YYYY-MM-DD)
 * @param options - Generation options
 */
export async function* generateTimeBlocks(
  userId: string,
  date: string,
  options: GenerateOptions = {},
): AsyncGenerator<GenerationChunk> {
  const { intent, calendarEventIds } = options;

  // Fetch calendar events for the date
  const targetDate = new Date(date);
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const userEvents = calendarEventIds
    ? await db.query.events.findMany({
        where: and(
          eq(events.creatorId, userId),
          gte(events.startTime, startOfDay),
          lte(events.startTime, endOfDay),
        ),
      })
    : await db.query.events.findMany({
        where: and(
          eq(events.creatorId, userId),
          gte(events.startTime, startOfDay),
          lte(events.startTime, endOfDay),
        ),
        orderBy: (events, { asc }) => [asc(events.startTime)],
      });

  // Calculate free slots
  const freeSlots = calculateFreeSlots(targetDate, userEvents);

  const chips = intent?.selectedChips ?? [];
  const blocks: GeneratedTimeBlock[] = [];

  // First, yield existing calendar events as blocks
  for (const event of userEvents) {
    if (!event.isAllDay && event.endTime) {
      const block: GeneratedTimeBlock = {
        type: 'time_block',
        source: 'calendar',
        title: event.title,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
        color: '#3b82f6', // Blue for calendar events
      };
      blocks.push(block);
      yield { type: 'block', block };
    }
  }

  // Generate AI-suggested blocks for free slots based on intent
  for (const slot of freeSlots) {
    const slotDuration = slot.durationMinutes;

    // Skip slots that are too short
    if (slotDuration < 30) continue;

    // Determine what type of block to suggest based on intent and time
    const startHour = new Date(slot.startTime).getHours();
    const suggestedBlock = suggestBlockForSlot(slot, startHour, slotDuration, chips);

    if (suggestedBlock) {
      blocks.push(suggestedBlock);
      yield { type: 'block', block: suggestedBlock };
    }
  }

  yield { type: 'done', totalBlocks: blocks.length };
}

/**
 * Calculate free time slots during working hours.
 */
function calculateFreeSlots(
  targetDate: Date,
  userEvents: { startTime: Date; endTime: Date | null; isAllDay: boolean }[],
): { startTime: string; endTime: string; durationMinutes: number }[] {
  const workStart = new Date(targetDate);
  workStart.setHours(9, 0, 0, 0);
  const workEnd = new Date(targetDate);
  workEnd.setHours(18, 0, 0, 0);

  const freeSlots: { startTime: string; endTime: string; durationMinutes: number }[] = [];
  let currentTime = workStart;

  // Filter to timed events only and sort
  const timedEvents = userEvents
    .filter((e) => !e.isAllDay && e.endTime)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  for (const event of timedEvents) {
    if (event.startTime > currentTime && event.startTime < workEnd) {
      const slotEnd = event.startTime < workEnd ? event.startTime : workEnd;
      const durationMinutes = Math.floor((slotEnd.getTime() - currentTime.getTime()) / 60000);
      if (durationMinutes >= 30) {
        freeSlots.push({
          startTime: currentTime.toISOString(),
          endTime: slotEnd.toISOString(),
          durationMinutes,
        });
      }
    }
    if (event.endTime && event.endTime > currentTime) {
      currentTime = event.endTime;
    }
  }

  // Check for free time after last event until end of work day
  if (currentTime < workEnd) {
    const durationMinutes = Math.floor((workEnd.getTime() - currentTime.getTime()) / 60000);
    if (durationMinutes >= 30) {
      freeSlots.push({
        startTime: currentTime.toISOString(),
        endTime: workEnd.toISOString(),
        durationMinutes,
      });
    }
  }

  return freeSlots;
}

/**
 * Suggest a time block for a given free slot based on context.
 */
function suggestBlockForSlot(
  slot: { startTime: string; endTime: string; durationMinutes: number },
  startHour: number,
  duration: number,
  chips: string[],
): GeneratedTimeBlock | null {
  // Morning slots (before 12pm) - suggest focus work
  if (startHour < 12 && duration >= 60) {
    if (chips.includes('focus') || chips.includes('projects')) {
      return {
        type: 'time_block',
        source: 'ai',
        title: 'Deep Work',
        description: 'Focused time for important tasks',
        startTime: slot.startTime,
        endTime: duration > 120 ? adjustEndTime(slot.startTime, 120) : slot.endTime,
        color: '#8b5cf6', // Purple for focus
      };
    }
  }

  // Around lunch (11-13) - suggest break if long enough
  if (startHour >= 11 && startHour <= 13 && duration >= 30) {
    return {
      type: 'time_block',
      source: 'ai',
      title: 'Lunch Break',
      startTime: slot.startTime,
      endTime: duration > 60 ? adjustEndTime(slot.startTime, 60) : slot.endTime,
      color: '#22c55e', // Green for breaks
    };
  }

  // Afternoon (13-17) - suggest project work or admin
  if (startHour >= 13 && startHour < 17 && duration >= 45) {
    if (chips.includes('projects')) {
      return {
        type: 'time_block',
        source: 'ai',
        title: 'Project Work',
        description: 'Make progress on active projects',
        startTime: slot.startTime,
        endTime: duration > 120 ? adjustEndTime(slot.startTime, 120) : slot.endTime,
        color: '#06b6d4', // Cyan for projects
      };
    }
    if (chips.includes('organized')) {
      return {
        type: 'time_block',
        source: 'ai',
        title: 'Admin & Organization',
        description: 'Clear inbox, organize tasks',
        startTime: slot.startTime,
        endTime: duration > 60 ? adjustEndTime(slot.startTime, 60) : slot.endTime,
        color: '#f59e0b', // Amber for admin
      };
    }
  }

  // Late afternoon (17+) - suggest review
  if (startHour >= 17 && duration >= 30) {
    return {
      type: 'time_block',
      source: 'ai',
      title: 'Daily Review',
      description: 'Review progress and plan tomorrow',
      startTime: slot.startTime,
      endTime: duration > 30 ? adjustEndTime(slot.startTime, 30) : slot.endTime,
      color: '#6366f1', // Indigo for planning
    };
  }

  // Default: suggest focus time for longer slots
  if (duration >= 60) {
    return {
      type: 'time_block',
      source: 'ai',
      title: 'Focus Time',
      startTime: slot.startTime,
      endTime: duration > 90 ? adjustEndTime(slot.startTime, 90) : slot.endTime,
      color: '#8b5cf6',
    };
  }

  return null;
}

/**
 * Adjust end time by adding minutes to start time.
 */
function adjustEndTime(startTime: string, minutes: number): string {
  const start = new Date(startTime);
  start.setMinutes(start.getMinutes() + minutes);
  return start.toISOString();
}
