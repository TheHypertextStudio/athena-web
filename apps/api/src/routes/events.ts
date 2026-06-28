/**
 * Event routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { eq, and, gte, lte, or, inArray } from 'drizzle-orm';
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
  ErrorResponseSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { events, eventParticipants } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { getCalendarSyncService } from '../services/calendar-sync/index.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { toEventParticipantWithUser, toEventWithRelations } from './events/serializers.js';

const eventRoutes = createOpenAPIApp();

eventRoutes.use('*', requireAuth);

const EVENT_PARTICIPANT_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
} as const;
type EventParticipantStatus =
  (typeof EVENT_PARTICIPANT_STATUS)[keyof typeof EVENT_PARTICIPANT_STATUS];
const DEFAULT_EVENT_PARTICIPANT_STATUS: EventParticipantStatus = EVENT_PARTICIPANT_STATUS.PENDING;
const ERROR_EVENT_NOT_FOUND = 'Event not found';
const ERROR_EVENT_NOT_AUTHORIZED = 'Event not found or not authorized';
const ERROR_PARTICIPANT_NOT_FOUND = 'Participant not found';

// =============================================================================
// List Events
// =============================================================================

const listEvents = createRoute({
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

const getEvent = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Event
// =============================================================================

const createEvent = createRoute({
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

const updateEvent = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Event
// =============================================================================

const deleteEvent = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Add Participant
// =============================================================================

const addParticipant = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Participant Status
// =============================================================================

const updateParticipantStatus = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Remove Participant
// =============================================================================

const removeParticipant = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * List all events for the authenticated user.
 * GET /api/events
 */
eventRoutes.openapi(listEvents, async (c) => {
  const userId = getUserId(c);
  const { startDate, endDate } = c.req.valid('query');

  // Get events where user is creator or participant
  const userParticipations = await db.query.eventParticipants.findMany({
    where: eq(eventParticipants.userId, userId),
  });

  const participantEventIds = userParticipations.map((p) => p.eventId);

  const baseClause =
    participantEventIds.length > 0
      ? or(eq(events.creatorId, userId), inArray(events.id, participantEventIds))
      : eq(events.creatorId, userId);

  const whereClause =
    startDate || endDate
      ? and(
          baseClause,
          ...(startDate ? [gte(events.startTime, startDate)] : []),
          ...(endDate ? [lte(events.startTime, endDate)] : []),
        )
      : baseClause;

  const result = await db.query.events.findMany({
    where: whereClause,
    with: {
      creator: true,
      participants: {
        with: {
          user: true,
        },
      },
    },
    orderBy: (events, { asc }) => [asc(events.startTime)],
  });

  return c.json({ data: result.map(toEventWithRelations) }, 200);
});

/**
 * Get a single event by ID.
 * GET /api/events/:id
 */
eventRoutes.openapi(getEvent, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.events.findFirst({
    where: eq(events.id, id),
    with: {
      creator: true,
      participants: {
        with: {
          user: true,
        },
      },
    },
  });

  if (!result) {
    return c.json({ error: ERROR_EVENT_NOT_FOUND }, 404);
  }

  // Check if user is creator or participant
  const isCreator = result.creatorId === userId;
  const isParticipant = result.participants.some((p) => p.userId === userId);

  if (!isCreator && !isParticipant) {
    return c.json({ error: ERROR_EVENT_NOT_FOUND }, 404);
  }

  return c.json({ data: toEventWithRelations(result) }, 200);
});

/**
 * Create a new event.
 * POST /api/events
 */
eventRoutes.openapi(createEvent, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(events).values({
    id,
    title: body.title,
    description: body.description,
    startTime: body.startTime,
    endTime: body.endTime ?? null,
    isAllDay: body.isAllDay,
    location: body.location,
    recurrenceRule: body.recurrenceRule,
    creatorId: userId,
    createdAt: now,
    updatedAt: now,
  });

  // Add participants if provided
  if (body.participantIds && body.participantIds.length > 0) {
    await db.insert(eventParticipants).values(
      body.participantIds.map((participantId) => ({
        id: crypto.randomUUID(),
        eventId: id,
        userId: participantId,
        status: DEFAULT_EVENT_PARTICIPANT_STATUS,
        createdAt: now,
      })),
    );
  }

  const result = await db.query.events.findFirst({
    where: eq(events.id, id),
    with: {
      creator: true,
      participants: {
        with: {
          user: true,
        },
      },
    },
  });
  if (!result) {
    throw new Error('Failed to create event');
  }

  // Auto-push to bidirectional calendar connections (fire-and-forget)
  getCalendarSyncService()
    .pushEventToAllConnections(userId, id, 'create')
    .catch((err: unknown) => {
      console.error('Auto-push create failed:', err);
    });

  return c.json({ data: toEventWithRelations(result) }, 201);
});

/**
 * Update an event.
 * PATCH /api/events/:id
 */
eventRoutes.openapi(updateEvent, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.events.findFirst({
    where: and(eq(events.id, id), eq(events.creatorId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_EVENT_NOT_AUTHORIZED }, 404);
  }

  const updateData: Partial<typeof events.$inferInsert> = { updatedAt: new Date() };
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.startTime !== undefined) updateData.startTime = body.startTime;
  if (body.endTime !== undefined) {
    updateData.endTime = body.endTime ?? null;
  }
  if (body.isAllDay !== undefined) updateData.isAllDay = body.isAllDay;
  if (body.location !== undefined) updateData.location = body.location;
  if (body.recurrenceRule !== undefined) updateData.recurrenceRule = body.recurrenceRule;

  await db.update(events).set(updateData).where(eq(events.id, id));

  const result = await db.query.events.findFirst({
    where: eq(events.id, id),
    with: {
      creator: true,
      participants: {
        with: {
          user: true,
        },
      },
    },
  });
  if (!result) {
    throw new Error('Failed to update event');
  }

  // Auto-push to bidirectional calendar connections (fire-and-forget)
  getCalendarSyncService()
    .pushEventToAllConnections(userId, id, 'update')
    .catch((err: unknown) => {
      console.error('Auto-push update failed:', err);
    });

  return c.json({ data: toEventWithRelations(result) }, 200);
});

/**
 * Delete an event.
 * DELETE /api/events/:id
 */
eventRoutes.openapi(deleteEvent, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.events.findFirst({
    where: and(eq(events.id, id), eq(events.creatorId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_EVENT_NOT_AUTHORIZED }, 404);
  }

  // Auto-push delete to bidirectional calendar connections BEFORE deleting locally
  // Must await since service queries the event - don't let local delete race ahead
  await getCalendarSyncService()
    .pushEventToAllConnections(userId, id, 'delete')
    .catch((err: unknown) => {
      console.error('Auto-push delete failed:', err);
    });

  await db.delete(events).where(eq(events.id, id));

  return c.body(null, 204);
});

/**
 * Add a participant to an event.
 * POST /api/events/:id/participants
 */
eventRoutes.openapi(addParticipant, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const event = await db.query.events.findFirst({
    where: and(eq(events.id, id), eq(events.creatorId, userId)),
  });

  if (!event) {
    return c.json({ error: ERROR_EVENT_NOT_AUTHORIZED }, 404);
  }

  const participantId = crypto.randomUUID();
  await db.insert(eventParticipants).values({
    id: participantId,
    eventId: id,
    userId: body.userId,
    status: DEFAULT_EVENT_PARTICIPANT_STATUS,
    createdAt: new Date(),
  });

  const participant = await db.query.eventParticipants.findFirst({
    where: eq(eventParticipants.id, participantId),
    with: { user: true },
  });

  const fallbackParticipant = {
    id: participantId,
    eventId: id,
    userId: body.userId,
    status: DEFAULT_EVENT_PARTICIPANT_STATUS,
    createdAt: new Date(),
  };

  return c.json(
    { data: toEventParticipantWithUser(participant ?? fallbackParticipant) },
    201,
  );
});

/**
 * Update participant status (RSVP).
 * PATCH /api/events/:id/participants/:participantId
 */
eventRoutes.openapi(updateParticipantStatus, async (c) => {
  const userId = getUserId(c);
  const { participantId } = c.req.valid('param');
  const body = c.req.valid('json');

  // Users can only update their own participation status
  const participant = await db.query.eventParticipants.findFirst({
    where: and(eq(eventParticipants.id, participantId), eq(eventParticipants.userId, userId)),
  });

  if (!participant) {
    return c.json({ error: ERROR_PARTICIPANT_NOT_FOUND }, 404);
  }

  await db
    .update(eventParticipants)
    .set({ status: body.status })
    .where(eq(eventParticipants.id, participantId));

  const updatedParticipant = await db.query.eventParticipants.findFirst({
    where: eq(eventParticipants.id, participantId),
    with: { user: true },
  });

  const participantToReturn = updatedParticipant
    ? { ...updatedParticipant, status: body.status }
    : { ...participant, status: body.status };

  return c.json({ data: toEventParticipantWithUser(participantToReturn) }, 200);
});

/**
 * Remove a participant from an event.
 * DELETE /api/events/:id/participants/:participantId
 */
eventRoutes.openapi(removeParticipant, async (c) => {
  const userId = getUserId(c);
  const { id: eventId, participantId } = c.req.valid('param');

  const event = await db.query.events.findFirst({
    where: and(eq(events.id, eventId), eq(events.creatorId, userId)),
  });

  if (!event) {
    return c.json({ error: ERROR_EVENT_NOT_AUTHORIZED }, 404);
  }

  await db.delete(eventParticipants).where(eq(eventParticipants.id, participantId));

  return c.body(null, 204);
});

export { eventRoutes };
