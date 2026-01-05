/**
 * Event schema tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  createEventSchema,
  updateEventSchema,
  participantStatusSchema,
  addParticipantSchema,
  updateParticipantStatusSchema,
} from './events.js';

describe('participantStatusSchema', () => {
  it('should accept valid status values', () => {
    expect(participantStatusSchema.parse('pending')).toBe('pending');
    expect(participantStatusSchema.parse('accepted')).toBe('accepted');
    expect(participantStatusSchema.parse('declined')).toBe('declined');
    expect(participantStatusSchema.parse('tentative')).toBe('tentative');
  });

  it('should reject invalid status values', () => {
    expect(() => participantStatusSchema.parse('maybe')).toThrow();
    expect(() => participantStatusSchema.parse('')).toThrow();
  });
});

describe('createEventSchema', () => {
  it('should validate valid create input', () => {
    const input = {
      title: 'Team Meeting',
      description: 'Weekly sync',
      startTime: '2026-01-15T10:00:00Z',
      endTime: '2026-01-15T11:00:00Z',
      location: 'Conference Room A',
    };

    const result = createEventSchema.parse(input);

    expect(result.title).toBe('Team Meeting');
    expect(result.startTime).toBe('2026-01-15T10:00:00Z');
    expect(result.endTime).toBe('2026-01-15T11:00:00Z');
  });

  it('should accept minimal input', () => {
    const input = {
      title: 'Quick Event',
      startTime: '2026-01-15T14:00:00Z',
    };

    const result = createEventSchema.parse(input);

    expect(result.title).toBe('Quick Event');
    expect(result.endTime).toBeUndefined();
  });

  it('should reject empty title', () => {
    const input = {
      title: '',
      startTime: '2026-01-15T10:00:00Z',
    };

    expect(() => createEventSchema.parse(input)).toThrow();
  });

  it('should reject missing startTime', () => {
    const input = { title: 'Event' };

    expect(() => createEventSchema.parse(input)).toThrow();
  });

  it('should accept all-day flag', () => {
    const input = {
      title: 'Holiday',
      startTime: '2026-01-15T00:00:00Z',
      isAllDay: true,
    };

    const result = createEventSchema.parse(input);

    expect(result.isAllDay).toBe(true);
  });

  it('should accept participant IDs', () => {
    const input = {
      title: 'Meeting',
      startTime: '2026-01-15T10:00:00Z',
      participantIds: [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ],
    };

    const result = createEventSchema.parse(input);

    expect(result.participantIds).toHaveLength(2);
  });

  it('should accept recurrence rule', () => {
    const input = {
      title: 'Weekly Standup',
      startTime: '2026-01-15T09:00:00Z',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    };

    const result = createEventSchema.parse(input);

    expect(result.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  });
});

describe('updateEventSchema', () => {
  it('should validate partial update', () => {
    const input = { title: 'Updated Meeting' };

    const result = updateEventSchema.parse(input);

    expect(result.title).toBe('Updated Meeting');
  });

  it('should accept empty object', () => {
    const input = {};

    const result = updateEventSchema.parse(input);

    expect(result).toEqual({});
  });

  it('should accept null endTime to clear it', () => {
    const input = { endTime: null };

    const result = updateEventSchema.parse(input);

    expect(result.endTime).toBeNull();
  });

  it('should accept null location to clear it', () => {
    const input = { location: null };

    const result = updateEventSchema.parse(input);

    expect(result.location).toBeNull();
  });

  it('should accept null recurrenceRule to stop recurring', () => {
    const input = { recurrenceRule: null };

    const result = updateEventSchema.parse(input);

    expect(result.recurrenceRule).toBeNull();
  });
});

describe('addParticipantSchema', () => {
  it('should validate valid user ID', () => {
    const input = { userId: '00000000-0000-0000-0000-000000000001' };

    const result = addParticipantSchema.parse(input);

    expect(result.userId).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('should reject invalid user ID', () => {
    const input = { userId: 'not-a-uuid' };

    expect(() => addParticipantSchema.parse(input)).toThrow();
  });

  it('should reject missing user ID', () => {
    const input = {};

    expect(() => addParticipantSchema.parse(input)).toThrow();
  });
});

describe('updateParticipantStatusSchema', () => {
  it('should validate valid status', () => {
    const input = { status: 'accepted' as const };

    const result = updateParticipantStatusSchema.parse(input);

    expect(result.status).toBe('accepted');
  });

  it('should reject invalid status', () => {
    const input = { status: 'attending' };

    expect(() => updateParticipantStatusSchema.parse(input)).toThrow();
  });
});
