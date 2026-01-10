/**
 * Event OpenAPI route definitions.
 *
 * These route definitions are used with OpenAPIHono to provide:
 * - Type-safe request/response handling
 * - OpenAPI spec generation
 * - Scalar documentation
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  EventIdParamSchema,
  EventParticipantParamsSchema,
  ListEventsQuerySchema,
  CreateEventRequestSchema,
  UpdateEventRequestSchema,
  AddParticipantRequestSchema,
  UpdateParticipantStatusRequestSchema,
  EventResponseSchema,
  EventListResponseSchema,
  EventParticipantResponseSchema,
} from '@athena/types/openapi/events';
import {
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// List Events
// =============================================================================

export const listEvents = createRoute({
  method: 'get',
  path: '/',
  tags: ['Events'],
  summary: 'List events',
  description: 'Retrieve a list of events with optional date filtering and pagination.',
  request: {
    query: ListEventsQuerySchema,
  },
  responses: {
    200: {
      description: 'Events retrieved successfully',
      content: {
        'application/json': {
          schema: EventListResponseSchema,
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
// Get Event
// =============================================================================

export const getEvent = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Events'],
  summary: 'Get an event',
  description: 'Retrieve a single event by its ID.',
  request: {
    params: EventIdParamSchema,
  },
  responses: {
    200: {
      description: 'Event retrieved successfully',
      content: {
        'application/json': {
          schema: EventResponseSchema,
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
      description: 'Event not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Event
// =============================================================================

export const createEvent = createRoute({
  method: 'post',
  path: '/',
  tags: ['Events'],
  summary: 'Create an event',
  description: 'Create a new event.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateEventRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Event created successfully',
      content: {
        'application/json': {
          schema: EventResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
// Update Event
// =============================================================================

export const updateEvent = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Events'],
  summary: 'Update an event',
  description: 'Update an existing event. Only provided fields will be updated.',
  request: {
    params: EventIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateEventRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Event updated successfully',
      content: {
        'application/json': {
          schema: EventResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
      description: 'Event not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Event
// =============================================================================

export const deleteEvent = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Events'],
  summary: 'Delete an event',
  description: 'Delete an event by its ID.',
  request: {
    params: EventIdParamSchema,
  },
  responses: {
    204: {
      description: 'Event deleted successfully',
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
      description: 'Event not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Add Participant
// =============================================================================

export const addParticipant = createRoute({
  method: 'post',
  path: '/{id}/participants',
  tags: ['Events'],
  summary: 'Add participant to event',
  description: 'Add a user as a participant to an event.',
  request: {
    params: EventIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: AddParticipantRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Participant added successfully',
      content: {
        'application/json': {
          schema: EventParticipantResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
      description: 'Event or user not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Participant Status
// =============================================================================

export const updateParticipantStatus = createRoute({
  method: 'patch',
  path: '/{id}/participants/{participantId}',
  tags: ['Events'],
  summary: 'Update participant status',
  description: 'Update the RSVP status of an event participant.',
  request: {
    params: EventParticipantParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateParticipantStatusRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Participant status updated successfully',
      content: {
        'application/json': {
          schema: EventParticipantResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
      description: 'Event or participant not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Remove Participant
// =============================================================================

export const removeParticipant = createRoute({
  method: 'delete',
  path: '/{id}/participants/{participantId}',
  tags: ['Events'],
  summary: 'Remove participant from event',
  description: 'Remove a participant from an event.',
  request: {
    params: EventParticipantParamsSchema,
  },
  responses: {
    204: {
      description: 'Participant removed successfully',
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
      description: 'Event or participant not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
