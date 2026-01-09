/**
 * Agenda API client functions.
 *
 * @packageDocumentation
 */

import type { Task, Event } from './api-client';
import { env } from './env';

const API_BASE_URL = env.API_URL;

/**
 * Make an authenticated API request.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  if (options.headers) {
    const optionHeaders = new Headers(options.headers);
    optionHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    let errorMessage = 'Request failed';
    try {
      const errorData = (await response.json()) as { message?: string };
      if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch {
      // Use default error message
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// Types
// ============================================================================

export interface AgendaItem {
  type: 'task' | 'event';
  sortTime: string;
  customPosition?: number;
  data: Task | Event;
}

export interface AgendaSummary {
  totalTasks: number;
  completedTasks: number;
  totalEvents: number;
  estimatedMinutes: number;
  estimatedHours: number;
}

export interface AgendaDayResponse {
  data: {
    date: string;
    items: AgendaItem[];
    summary: AgendaSummary;
  };
}

export interface AgendaTodaySummary {
  taskCount: number;
  eventCount: number;
  timeBlockCount: number;
  estimatedTaskMinutes: number;
  scheduledEventMinutes: number;
  trackedMinutes: number;
  utilizationPercent: number;
  availableMinutes: number;
}

export interface TimeBlock {
  id: string;
  label: string;
  description: string | null;
  startTime: string;
  endTime: string;
  color: string | null;
}

export interface AgendaTodayResponse {
  data: {
    date: string;
    tasks: Task[];
    events: Event[];
    timeBlocks: TimeBlock[];
    summary: AgendaTodaySummary;
  };
}

export interface WeeklyDayData {
  tasks: Task[];
  events: Event[];
}

export interface WeeklyAgendaResponse {
  data: {
    startDate: string;
    endDate: string;
    days: Record<string, WeeklyDayData>;
    summary: {
      totalTasks: number;
      totalEvents: number;
    };
  };
}

export interface DeadlineDay {
  date: string;
  tasks: Task[];
}

export interface DeadlinesResponse {
  data: {
    tasks: Task[];
    byDay: DeadlineDay[];
    overdueCount: number;
  };
}

export interface TaskOrderResponse {
  data: {
    date: string;
    taskIds: string[];
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Agenda API functions.
 */
export const agendaApi = {
  /**
   * Get agenda for a specific date.
   */
  getDay: (date: string) => request<AgendaDayResponse>(`/api/agenda?date=${date}`),

  /**
   * Get today's agenda with utilization metrics.
   */
  getToday: () => request<AgendaTodayResponse>('/api/agenda/today'),

  /**
   * Get weekly agenda starting from a date.
   */
  getWeek: (startDate: string) =>
    request<WeeklyAgendaResponse>(`/api/agenda/week?startDate=${startDate}`),

  /**
   * Get upcoming deadlines.
   */
  getDeadlines: (days = 7) =>
    request<DeadlinesResponse>(`/api/agenda/deadlines?days=${String(days)}`),

  /**
   * Reorder tasks for a specific date.
   */
  reorderTasks: (taskIds: string[], date?: string) =>
    request<{ success: boolean }>('/api/agenda/reorder', {
      method: 'POST',
      body: JSON.stringify({ taskIds, date }),
    }),

  /**
   * Get custom task order for a date.
   */
  getOrder: (date: string) => request<TaskOrderResponse>(`/api/agenda/order?date=${date}`),
};

// ============================================================================
// Query Keys
// ============================================================================

/**
 * Query keys for agenda data.
 */
export const agendaKeys = {
  all: ['agenda'] as const,
  today: () => [...agendaKeys.all, 'today'] as const,
  day: (date: string) => [...agendaKeys.all, 'day', date] as const,
  week: (startDate: string) => [...agendaKeys.all, 'week', startDate] as const,
  deadlines: (days: number) => [...agendaKeys.all, 'deadlines', days] as const,
  order: (date: string) => [...agendaKeys.all, 'order', date] as const,
};
