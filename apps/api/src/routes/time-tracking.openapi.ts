/**
 * Time Tracking OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  TimeEntryIdParamSchema,
  TimeEntriesQuerySchema,
  TimeSummaryQuerySchema,
  StartTimerRequestSchema,
  SwitchTimerRequestSchema,
  CreateTimeEntryRequestSchema,
  UpdateTimeEntryRequestSchema,
  TimeEntriesResponseSchema,
  TimeEntryResponseSchema,
  TimeSummaryResponseSchema,
  ActiveTimerResponseSchema,
  StopTimerResponseSchema,
  SwitchTimerResponseSchema,
  ElapsedTimeResponseSchema,
} from '@athena/types/openapi/time-tracking';
import {
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ErrorResponseSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// List Time Entries
// =============================================================================

export const listTimeEntries = createRoute({
  method: 'get',
  path: '/',
  tags: ['Time Tracking'],
  summary: 'List time entries',
  description: 'List time entries for the authenticated user.',
  request: {
    query: TimeEntriesQuerySchema,
  },
  responses: {
    200: {
      description: 'Time entries retrieved successfully',
      content: {
        'application/json': {
          schema: TimeEntriesResponseSchema,
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
// Get Time Summary
// =============================================================================

export const getTimeSummary = createRoute({
  method: 'get',
  path: '/summary',
  tags: ['Time Tracking'],
  summary: 'Get time summary',
  description: 'Get time tracking summary for a date range.',
  request: {
    query: TimeSummaryQuerySchema,
  },
  responses: {
    200: {
      description: 'Time summary retrieved successfully',
      content: {
        'application/json': {
          schema: TimeSummaryResponseSchema,
        },
      },
    },
    400: {
      description: 'Missing required dates',
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
// Get Active Timer
// =============================================================================

export const getActiveTimer = createRoute({
  method: 'get',
  path: '/active',
  tags: ['Time Tracking'],
  summary: 'Get active timer',
  description: 'Get the currently active time entry.',
  responses: {
    200: {
      description: 'Active timer retrieved',
      content: {
        'application/json': {
          schema: ActiveTimerResponseSchema,
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
// Get Time Entry
// =============================================================================

export const getTimeEntry = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Time Tracking'],
  summary: 'Get time entry',
  description: 'Get a time entry by ID.',
  request: {
    params: TimeEntryIdParamSchema,
  },
  responses: {
    200: {
      description: 'Time entry retrieved successfully',
      content: {
        'application/json': {
          schema: TimeEntryResponseSchema,
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
    404: {
      description: 'Time entry not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Start Timer
// =============================================================================

export const startTimer = createRoute({
  method: 'post',
  path: '/start',
  tags: ['Time Tracking'],
  summary: 'Start timer',
  description: 'Start a new timer.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: StartTimerRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Timer started successfully',
      content: {
        'application/json': {
          schema: TimeEntryResponseSchema,
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
    404: {
      description: 'Task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
    409: {
      description: 'Timer already running',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Stop Timer
// =============================================================================

export const stopTimer = createRoute({
  method: 'post',
  path: '/stop',
  tags: ['Time Tracking'],
  summary: 'Stop timer',
  description: 'Stop the current timer.',
  responses: {
    200: {
      description: 'Timer stopped successfully',
      content: {
        'application/json': {
          schema: StopTimerResponseSchema,
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
    404: {
      description: 'No active timer',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Switch Timer
// =============================================================================

export const switchTimer = createRoute({
  method: 'post',
  path: '/switch',
  tags: ['Time Tracking'],
  summary: 'Switch timer',
  description: 'Stop current timer and start a new one.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: SwitchTimerRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Timer switched successfully',
      content: {
        'application/json': {
          schema: SwitchTimerResponseSchema,
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
    404: {
      description: 'Task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Elapsed Time
// =============================================================================

export const getElapsedTime = createRoute({
  method: 'get',
  path: '/elapsed',
  tags: ['Time Tracking'],
  summary: 'Get elapsed time',
  description: 'Get elapsed time of current timer.',
  responses: {
    200: {
      description: 'Elapsed time retrieved',
      content: {
        'application/json': {
          schema: ElapsedTimeResponseSchema,
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
// Create Time Entry
// =============================================================================

export const createTimeEntry = createRoute({
  method: 'post',
  path: '/',
  tags: ['Time Tracking'],
  summary: 'Create time entry',
  description: 'Create a manual time entry.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTimeEntryRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Time entry created successfully',
      content: {
        'application/json': {
          schema: TimeEntryResponseSchema,
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
    404: {
      description: 'Task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Time Entry
// =============================================================================

export const updateTimeEntry = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Time Tracking'],
  summary: 'Update time entry',
  description: 'Update a time entry.',
  request: {
    params: TimeEntryIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateTimeEntryRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Time entry updated successfully',
      content: {
        'application/json': {
          schema: TimeEntryResponseSchema,
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
    404: {
      description: 'Time entry not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Time Entry
// =============================================================================

export const deleteTimeEntry = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Time Tracking'],
  summary: 'Delete time entry',
  description: 'Delete a time entry.',
  request: {
    params: TimeEntryIdParamSchema,
  },
  responses: {
    204: {
      description: 'Time entry deleted successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Time entry not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
