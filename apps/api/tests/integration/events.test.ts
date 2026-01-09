/**
 * Events API integration tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetMockDb, type MockDb } from './test-utils.js';

const mockDb = vi.hoisted(() => {
  const factory = (globalThis as { __athenaMockDbFactory?: () => MockDb }).__athenaMockDbFactory;
  if (!factory) {
    throw new Error('Mock DB factory not initialized');
  }
  return factory();
});

vi.mock('../../src/db/index.js', () => ({ db: mockDb }));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: async (
    _c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    _c.set('userId', 'test-user-id');
    await next();
  },
  getUserId: (c: { get: (key: string) => unknown }) => c.get('userId') ?? 'test-user-id',
}));

vi.mock('../../src/lib/auth.js', () => ({
  auth: {
    api: { getSession: () => null },
    handler: () => new Response(),
  },
}));

import { app } from '../../src/index.js';

describe('Events API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/events', () => {
    it('should return empty list when no events exist', async () => {
      mockDb.query.eventParticipants.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/events');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return events list', async () => {
      mockDb.query.eventParticipants.findMany.mockResolvedValue([]);
      const mockEvents = [
        {
          id: 'event-1',
          title: 'Test Event',
          startTime: new Date(),
          creatorId: 'test-user-id',
          participants: [{ userId: 'test-user-id' }],
        },
      ];
      mockDb.query.events.findMany.mockResolvedValue(mockEvents);

      const res = await app.request('/api/events');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockEvents };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.title).toBe('Test Event');
    });

    it('should filter events by startDate', async () => {
      mockDb.query.eventParticipants.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/events?startDate=2026-01-01');
      expect(res.status).toBe(200);
    });

    it('should filter events by endDate', async () => {
      mockDb.query.eventParticipants.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/events?endDate=2026-12-31');
      expect(res.status).toBe(200);
    });

    it('should combine date filters', async () => {
      mockDb.query.eventParticipants.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/events?startDate=2026-01-01&endDate=2026-12-31');
      expect(res.status).toBe(200);
    });

    it('should include events where user is participant', async () => {
      mockDb.query.eventParticipants.findMany.mockResolvedValue([
        { eventId: 'event-2', userId: 'test-user-id' },
      ]);
      const mockEvents = [
        {
          id: 'event-1',
          title: 'My Event',
          creatorId: 'test-user-id',
          participants: [],
        },
        {
          id: 'event-2',
          title: 'Invited Event',
          creatorId: 'other-user',
          participants: [{ userId: 'test-user-id' }],
        },
      ];
      mockDb.query.events.findMany.mockResolvedValue(mockEvents);

      const res = await app.request('/api/events');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockEvents };
      expect(body.data).toHaveLength(2);
    });
  });

  describe('GET /api/events/:id', () => {
    it('should return 404 for non-existent event', async () => {
      mockDb.query.events.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/events/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Event not found');
    });

    it('should return event by id when user is creator', async () => {
      const mockEvent = {
        id: 'event-1',
        title: 'Test Event',
        startTime: new Date(),
        creatorId: 'test-user-id',
        participants: [],
      };
      mockDb.query.events.findFirst.mockResolvedValue(mockEvent);

      const res = await app.request('/api/events/event-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockEvent };
      expect(body.data.id).toBe('event-1');
      expect(body.data.title).toBe('Test Event');
    });

    it('should return event when user is participant', async () => {
      const mockEvent = {
        id: 'event-1',
        title: 'Invited Event',
        startTime: new Date(),
        creatorId: 'other-user',
        participants: [{ userId: 'test-user-id' }],
      };
      mockDb.query.events.findFirst.mockResolvedValue(mockEvent);

      const res = await app.request('/api/events/event-1');
      expect(res.status).toBe(200);
    });

    it('should return 404 when user is neither creator nor participant', async () => {
      const mockEvent = {
        id: 'event-1',
        title: 'Private Event',
        creatorId: 'other-user',
        participants: [{ userId: 'another-user' }],
      };
      mockDb.query.events.findFirst.mockResolvedValue(mockEvent);

      const res = await app.request('/api/events/event-1');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/events', () => {
    it('should create a new event with minimal fields', async () => {
      const newEvent = {
        id: 'new-event',
        title: 'New Event',
        startTime: new Date('2026-06-15T10:00:00Z'),
        creatorId: 'test-user-id',
        participants: [],
      };
      mockDb.query.events.findFirst.mockResolvedValue(newEvent);

      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Event',
          startTime: '2026-06-15T10:00:00Z',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newEvent };
      expect(body.data.title).toBe('New Event');
    });

    it('should create event with all optional fields', async () => {
      const newEvent = {
        id: 'new-event',
        title: 'Full Event',
        description: 'Event description',
        startTime: new Date('2026-06-15T10:00:00Z'),
        endTime: new Date('2026-06-15T12:00:00Z'),
        isAllDay: false,
        location: 'Conference Room A',
        recurrenceRule: 'FREQ=WEEKLY',
        creatorId: 'test-user-id',
        participants: [],
      };
      mockDb.query.events.findFirst.mockResolvedValue(newEvent);

      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Full Event',
          description: 'Event description',
          startTime: '2026-06-15T10:00:00Z',
          endTime: '2026-06-15T12:00:00Z',
          isAllDay: false,
          location: 'Conference Room A',
          recurrenceRule: 'FREQ=WEEKLY',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should create all-day event', async () => {
      const newEvent = {
        id: 'new-event',
        title: 'All Day Event',
        startTime: new Date('2026-06-15'),
        isAllDay: true,
        creatorId: 'test-user-id',
        participants: [],
      };
      mockDb.query.events.findFirst.mockResolvedValue(newEvent);

      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'All Day Event',
          startTime: '2026-06-15',
          isAllDay: true,
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should create event with participants', async () => {
      const newEvent = {
        id: 'new-event',
        title: 'Team Meeting',
        startTime: new Date('2026-06-15T10:00:00Z'),
        creatorId: 'test-user-id',
        participants: [
          { userId: 'user-1', status: 'pending' },
          { userId: 'user-2', status: 'pending' },
        ],
      };
      mockDb.query.events.findFirst.mockResolvedValue(newEvent);

      const res = await app.request('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Team Meeting',
          startTime: '2026-06-15T10:00:00Z',
          participantIds: ['user-1', 'user-2'],
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/events/:id', () => {
    it('should return 404 for non-existent event', async () => {
      mockDb.query.events.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/events/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update event title', async () => {
      const existingEvent = { id: 'event-1', title: 'Original', creatorId: 'test-user-id' };
      const updatedEvent = {
        id: 'event-1',
        title: 'Updated',
        creatorId: 'test-user-id',
        participants: [],
      };

      mockDb.query.events.findFirst
        .mockResolvedValueOnce(existingEvent)
        .mockResolvedValueOnce(updatedEvent);

      const res = await app.request('/api/events/event-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { title: string } };
      expect(body.data.title).toBe('Updated');
    });

    it('should update event description', async () => {
      const existingEvent = { id: 'event-1', description: null, creatorId: 'test-user-id' };
      const updatedEvent = {
        id: 'event-1',
        description: 'New description',
        creatorId: 'test-user-id',
        participants: [],
      };

      mockDb.query.events.findFirst
        .mockResolvedValueOnce(existingEvent)
        .mockResolvedValueOnce(updatedEvent);

      const res = await app.request('/api/events/event-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'New description' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update event times', async () => {
      const existingEvent = { id: 'event-1', creatorId: 'test-user-id' };
      const updatedEvent = {
        id: 'event-1',
        startTime: new Date('2026-06-20T10:00:00Z'),
        endTime: new Date('2026-06-20T12:00:00Z'),
        creatorId: 'test-user-id',
        participants: [],
      };

      mockDb.query.events.findFirst
        .mockResolvedValueOnce(existingEvent)
        .mockResolvedValueOnce(updatedEvent);

      const res = await app.request('/api/events/event-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: '2026-06-20T10:00:00Z',
          endTime: '2026-06-20T12:00:00Z',
        }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear endTime with null', async () => {
      const existingEvent = {
        id: 'event-1',
        endTime: new Date(),
        creatorId: 'test-user-id',
      };
      const updatedEvent = {
        id: 'event-1',
        endTime: null,
        creatorId: 'test-user-id',
        participants: [],
      };

      mockDb.query.events.findFirst
        .mockResolvedValueOnce(existingEvent)
        .mockResolvedValueOnce(updatedEvent);

      const res = await app.request('/api/events/event-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endTime: null }),
      });

      expect(res.status).toBe(200);
    });

    it('should update isAllDay', async () => {
      const existingEvent = { id: 'event-1', isAllDay: false, creatorId: 'test-user-id' };
      const updatedEvent = {
        id: 'event-1',
        isAllDay: true,
        creatorId: 'test-user-id',
        participants: [],
      };

      mockDb.query.events.findFirst
        .mockResolvedValueOnce(existingEvent)
        .mockResolvedValueOnce(updatedEvent);

      const res = await app.request('/api/events/event-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAllDay: true }),
      });

      expect(res.status).toBe(200);
    });

    it('should update event location', async () => {
      const existingEvent = { id: 'event-1', location: null, creatorId: 'test-user-id' };
      const updatedEvent = {
        id: 'event-1',
        location: 'Room 101',
        creatorId: 'test-user-id',
        participants: [],
      };

      mockDb.query.events.findFirst
        .mockResolvedValueOnce(existingEvent)
        .mockResolvedValueOnce(updatedEvent);

      const res = await app.request('/api/events/event-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: 'Room 101' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update recurrenceRule', async () => {
      const existingEvent = { id: 'event-1', recurrenceRule: null, creatorId: 'test-user-id' };
      const updatedEvent = {
        id: 'event-1',
        recurrenceRule: 'FREQ=DAILY',
        creatorId: 'test-user-id',
        participants: [],
      };

      mockDb.query.events.findFirst
        .mockResolvedValueOnce(existingEvent)
        .mockResolvedValueOnce(updatedEvent);

      const res = await app.request('/api/events/event-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrenceRule: 'FREQ=DAILY' }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear recurrenceRule with null', async () => {
      const existingEvent = {
        id: 'event-1',
        recurrenceRule: 'FREQ=DAILY',
        creatorId: 'test-user-id',
      };
      const updatedEvent = {
        id: 'event-1',
        recurrenceRule: null,
        creatorId: 'test-user-id',
        participants: [],
      };

      mockDb.query.events.findFirst
        .mockResolvedValueOnce(existingEvent)
        .mockResolvedValueOnce(updatedEvent);

      const res = await app.request('/api/events/event-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrenceRule: null }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/events/:id', () => {
    it('should return 404 for non-existent event', async () => {
      mockDb.query.events.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/events/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete event', async () => {
      mockDb.query.events.findFirst.mockResolvedValue({
        id: 'event-1',
        creatorId: 'test-user-id',
      });

      const res = await app.request('/api/events/event-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });

  describe('POST /api/events/:id/participants', () => {
    it('should return 404 for non-existent event', async () => {
      mockDb.query.events.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/events/non-existent/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-1' }),
      });

      expect(res.status).toBe(404);
    });

    it('should add participant to event', async () => {
      mockDb.query.events.findFirst.mockResolvedValue({
        id: 'event-1',
        creatorId: 'test-user-id',
      });

      const res = await app.request('/api/events/event-1/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-1' }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/events/:id/participants/:participantId', () => {
    it('should return 404 for non-existent participant', async () => {
      mockDb.query.eventParticipants.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/events/event-1/participants/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update participant status to accepted', async () => {
      mockDb.query.eventParticipants.findFirst.mockResolvedValue({
        id: 'participant-1',
        eventId: 'event-1',
        userId: 'test-user-id',
        status: 'pending',
      });

      const res = await app.request('/api/events/event-1/participants/participant-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { status: string } };
      expect(body.data.status).toBe('accepted');
    });

    it('should update participant status to declined', async () => {
      mockDb.query.eventParticipants.findFirst.mockResolvedValue({
        id: 'participant-1',
        eventId: 'event-1',
        userId: 'test-user-id',
        status: 'pending',
      });

      const res = await app.request('/api/events/event-1/participants/participant-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'declined' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update participant status to tentative', async () => {
      mockDb.query.eventParticipants.findFirst.mockResolvedValue({
        id: 'participant-1',
        eventId: 'event-1',
        userId: 'test-user-id',
        status: 'pending',
      });

      const res = await app.request('/api/events/event-1/participants/participant-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'tentative' }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/events/:id/participants/:participantId', () => {
    it('should return 404 for non-existent event', async () => {
      mockDb.query.events.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/events/non-existent/participants/participant-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should remove participant from event', async () => {
      mockDb.query.events.findFirst.mockResolvedValue({
        id: 'event-1',
        creatorId: 'test-user-id',
      });

      const res = await app.request('/api/events/event-1/participants/participant-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
