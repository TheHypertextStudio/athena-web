/**
 * Agenda OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  AgendaQuerySchema,
  AgendaRangeQuerySchema,
  DeadlinesQuerySchema,
  WeekQuerySchema,
  AgendaReorderRequestSchema,
  AgendaResponseSchema,
  AgendaRangeResponseSchema,
  TodayAgendaResponseSchema,
  ReorderResponseSchema,
  TaskOrderResponseSchema,
  DeadlinesResponseSchema,
  WeekAgendaResponseSchema,
} from '@athena/types/openapi/agenda';
import { UnauthorizedErrorSchema, ErrorResponseSchema } from '@athena/types/openapi/common';

// =============================================================================
// Get Agenda
// =============================================================================

export const getAgenda = createRoute({
  method: 'get',
  path: '/',
  tags: ['Agenda'],
  summary: 'Get agenda',
  description: 'Get agenda for a specific date.',
  request: {
    query: AgendaQuerySchema,
  },
  responses: {
    200: {
      description: 'Agenda retrieved successfully',
      content: {
        'application/json': {
          schema: AgendaResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Agenda Range
// =============================================================================

export const getAgendaRange = createRoute({
  method: 'get',
  path: '/range',
  tags: ['Agenda'],
  summary: 'Get agenda range',
  description: 'Get agenda for a date range.',
  request: {
    query: AgendaRangeQuerySchema,
  },
  responses: {
    200: {
      description: 'Agenda range retrieved successfully',
      content: {
        'application/json': {
          schema: AgendaRangeResponseSchema,
        },
      },
    },
    400: {
      description: 'Missing required parameters',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Today Agenda
// =============================================================================

export const getTodayAgenda = createRoute({
  method: 'get',
  path: '/today',
  tags: ['Agenda'],
  summary: 'Get today agenda',
  description: 'Get agenda for today with time blocks and utilization.',
  responses: {
    200: {
      description: 'Today agenda retrieved successfully',
      content: {
        'application/json': {
          schema: TodayAgendaResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Reorder Tasks
// =============================================================================

export const reorderTasks = createRoute({
  method: 'post',
  path: '/reorder',
  tags: ['Agenda'],
  summary: 'Reorder tasks',
  description: 'Reorder tasks in the agenda for a specific date.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: AgendaReorderRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks reordered successfully',
      content: {
        'application/json': {
          schema: ReorderResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Task Order
// =============================================================================

export const getTaskOrder = createRoute({
  method: 'get',
  path: '/order',
  tags: ['Agenda'],
  summary: 'Get task order',
  description: 'Get custom task order for a specific date.',
  request: {
    query: AgendaQuerySchema,
  },
  responses: {
    200: {
      description: 'Task order retrieved successfully',
      content: {
        'application/json': {
          schema: TaskOrderResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Deadlines
// =============================================================================

export const getDeadlines = createRoute({
  method: 'get',
  path: '/deadlines',
  tags: ['Agenda'],
  summary: 'Get upcoming deadlines',
  description: 'Get upcoming task deadlines.',
  request: {
    query: DeadlinesQuerySchema,
  },
  responses: {
    200: {
      description: 'Deadlines retrieved successfully',
      content: {
        'application/json': {
          schema: DeadlinesResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Week Agenda
// =============================================================================

export const getWeekAgenda = createRoute({
  method: 'get',
  path: '/week',
  tags: ['Agenda'],
  summary: 'Get week agenda',
  description: 'Get weekly overview.',
  request: {
    query: WeekQuerySchema,
  },
  responses: {
    200: {
      description: 'Week agenda retrieved successfully',
      content: {
        'application/json': {
          schema: WeekAgendaResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});
