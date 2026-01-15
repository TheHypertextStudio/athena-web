/**
 * Event routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and, gte, lte, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, eventParticipants } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { getCalendarSyncService } from '../services/calendar-sync/index.js';

const eventRoutes = new Hono();

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
const DEFAULT_EVENT_IS_ALL_DAY = false;
const ERROR_EVENT_NOT_FOUND = 'Event not found';
const ERROR_EVENT_NOT_AUTHORIZED = 'Event not found or not authorized';
const ERROR_PARTICIPANT_NOT_FOUND = 'Participant not found';

/**
 * List all events for the authenticated user.
 * GET /api/events
 */
eventRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  // Get events where user is creator or participant
  const userParticipations = await db.query.eventParticipants.findMany({
    where: eq(eventParticipants.userId, userId),
  });

  const participantEventIds = userParticipations.map((p) => p.eventId);

  let whereClause = or(
    eq(events.creatorId, userId),
    participantEventIds.length > 0
      ? or(...participantEventIds.map((eid) => eq(events.id, eid)))
      : undefined,
  );

  if (startDate) {
    whereClause = and(whereClause, gte(events.startTime, new Date(startDate)));
  }

  if (endDate) {
    whereClause = and(whereClause, lte(events.startTime, new Date(endDate)));
  }

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

  return c.json({ data: result });
});

/**
 * Get a single event by ID.
 * GET /api/events/:id
 */
eventRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

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

  return c.json({ data: result });
});

/**
 * Create a new event.
 * POST /api/events
 */
eventRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    title: string;
    description?: string;
    startTime: string;
    endTime?: string;
    isAllDay?: boolean;
    location?: string;
    recurrenceRule?: string;
    participantIds?: string[];
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(events).values({
    id,
    title: body.title,
    description: body.description,
    startTime: new Date(body.startTime),
    endTime: body.endTime ? new Date(body.endTime) : null,
    isAllDay: body.isAllDay ?? DEFAULT_EVENT_IS_ALL_DAY,
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

  // Auto-push to bidirectional calendar connections (fire-and-forget)
  getCalendarSyncService()
    .pushEventToAllConnections(userId, id, 'create')
    .catch((err: unknown) => {
      console.error('Auto-push create failed:', err);
    });

  return c.json({ data: result }, 201);
});

/**
 * Update an event.
 * PATCH /api/events/:id
 */
eventRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    title?: string;
    description?: string;
    startTime?: string;
    endTime?: string | null;
    isAllDay?: boolean;
    location?: string;
    recurrenceRule?: string | null;
  }>();

  const existing = await db.query.events.findFirst({
    where: and(eq(events.id, id), eq(events.creatorId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_EVENT_NOT_AUTHORIZED }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.startTime !== undefined) updateData.startTime = new Date(body.startTime);
  if (body.endTime !== undefined) {
    updateData.endTime = body.endTime ? new Date(body.endTime) : null;
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

  // Auto-push to bidirectional calendar connections (fire-and-forget)
  getCalendarSyncService()
    .pushEventToAllConnections(userId, id, 'update')
    .catch((err: unknown) => {
      console.error('Auto-push update failed:', err);
    });

  return c.json({ data: result });
});

/**
 * Delete an event.
 * DELETE /api/events/:id
 */
eventRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

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
eventRoutes.post('/:id/participants', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{ userId: string }>();

  const event = await db.query.events.findFirst({
    where: and(eq(events.id, id), eq(events.creatorId, userId)),
  });

  if (!event) {
    return c.json({ error: ERROR_EVENT_NOT_AUTHORIZED }, 404);
  }

  await db.insert(eventParticipants).values({
    id: crypto.randomUUID(),
    eventId: id,
    userId: body.userId,
    status: DEFAULT_EVENT_PARTICIPANT_STATUS,
    createdAt: new Date(),
  });

  return c.body(null, 201);
});

/**
 * Update participant status (RSVP).
 * PATCH /api/events/:id/participants/:participantId
 */
eventRoutes.patch('/:id/participants/:participantId', async (c) => {
  const userId = getUserId(c);
  const participantId = c.req.param('participantId');
  const body = await c.req.json<{ status: EventParticipantStatus }>();

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

  return c.json({ data: { status: body.status } });
});

/**
 * Remove a participant from an event.
 * DELETE /api/events/:id/participants/:participantId
 */
eventRoutes.delete('/:id/participants/:participantId', async (c) => {
  const userId = getUserId(c);
  const eventId = c.req.param('id');
  const participantId = c.req.param('participantId');

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
