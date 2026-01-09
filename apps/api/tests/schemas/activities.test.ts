/**
 * Activities schema tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  activityStreamSchema,
  activitySchema,
  activityWithStreamSchema,
  activityStreamWithActivitiesSchema,
  createActivityStreamSchema,
  updateActivityStreamSchema,
  createActivitySchema,
  updateActivitySchema,
  activityQuerySchema,
} from '../../src/schemas/activities.js';

describe('Activity Stream Schema', () => {
  const validActivityStream = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Work Activities',
    source: 'manual',
    ownerId: '123e4567-e89b-12d3-a456-426614174001',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
  };

  it('should accept valid activity stream', () => {
    const result = activityStreamSchema.safeParse(validActivityStream);
    expect(result.success).toBe(true);
  });

  it('should reject missing name', () => {
    const { name: _name, ...invalid } = validActivityStream;
    const result = activityStreamSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject empty name', () => {
    const result = activityStreamSchema.safeParse({ ...validActivityStream, name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject name exceeding max length', () => {
    const result = activityStreamSchema.safeParse({
      ...validActivityStream,
      name: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty source', () => {
    const result = activityStreamSchema.safeParse({ ...validActivityStream, source: '' });
    expect(result.success).toBe(false);
  });

  it('should reject source exceeding max length', () => {
    const result = activityStreamSchema.safeParse({
      ...validActivityStream,
      source: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

describe('Activity Schema', () => {
  const validActivity = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'coding',
    startTime: '2026-01-05T10:00:00Z',
    endTime: '2026-01-05T11:00:00Z',
    metadata: null,
    streamId: '123e4567-e89b-12d3-a456-426614174001',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
  };

  it('should accept valid activity', () => {
    const result = activitySchema.safeParse(validActivity);
    expect(result.success).toBe(true);
  });

  it('should accept activity with metadata', () => {
    const result = activitySchema.safeParse({
      ...validActivity,
      metadata: { language: 'typescript', project: 'athena' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing type', () => {
    const { type: _type, ...invalid } = validActivity;
    const result = activitySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject empty type', () => {
    const result = activitySchema.safeParse({ ...validActivity, type: '' });
    expect(result.success).toBe(false);
  });

  it('should reject type exceeding max length', () => {
    const result = activitySchema.safeParse({
      ...validActivity,
      type: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing streamId', () => {
    const { streamId: _streamId, ...invalid } = validActivity;
    const result = activitySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Activity With Stream Schema', () => {
  const validActivity = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'coding',
    startTime: '2026-01-05T10:00:00Z',
    endTime: '2026-01-05T11:00:00Z',
    metadata: null,
    streamId: '123e4567-e89b-12d3-a456-426614174001',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    stream: {
      id: '123e4567-e89b-12d3-a456-426614174001',
      name: 'Work Activities',
      source: 'manual',
      ownerId: '123e4567-e89b-12d3-a456-426614174002',
      createdAt: '2026-01-05T10:00:00Z',
      updatedAt: '2026-01-05T10:00:00Z',
    },
  };

  it('should accept activity with stream relation', () => {
    const result = activityWithStreamSchema.safeParse(validActivity);
    expect(result.success).toBe(true);
  });

  it('should accept activity without stream relation', () => {
    const { stream: _stream, ...activityOnly } = validActivity;
    const result = activityWithStreamSchema.safeParse(activityOnly);
    expect(result.success).toBe(true);
  });
});

describe('Activity Stream With Activities Schema', () => {
  const validStreamWithActivities = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Work Activities',
    source: 'manual',
    ownerId: '123e4567-e89b-12d3-a456-426614174001',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    activities: [
      {
        id: '123e4567-e89b-12d3-a456-426614174002',
        type: 'coding',
        startTime: '2026-01-05T10:00:00Z',
        endTime: '2026-01-05T11:00:00Z',
        metadata: null,
        streamId: '123e4567-e89b-12d3-a456-426614174000',
        createdAt: '2026-01-05T10:00:00Z',
        updatedAt: '2026-01-05T10:00:00Z',
      },
    ],
  };

  it('should accept stream with activities', () => {
    const result = activityStreamWithActivitiesSchema.safeParse(validStreamWithActivities);
    expect(result.success).toBe(true);
  });

  it('should accept stream without activities', () => {
    const { activities: _activities, ...streamOnly } = validStreamWithActivities;
    const result = activityStreamWithActivitiesSchema.safeParse(streamOnly);
    expect(result.success).toBe(true);
  });
});

describe('Create Activity Stream Schema', () => {
  it('should accept valid create request', () => {
    const result = createActivityStreamSchema.safeParse({
      name: 'Work Activities',
      source: 'manual',
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing name', () => {
    const result = createActivityStreamSchema.safeParse({ source: 'manual' });
    expect(result.success).toBe(false);
  });

  it('should reject missing source', () => {
    const result = createActivityStreamSchema.safeParse({ name: 'Work' });
    expect(result.success).toBe(false);
  });
});

describe('Update Activity Stream Schema', () => {
  it('should accept partial update with name only', () => {
    const result = updateActivityStreamSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('should accept partial update with source only', () => {
    const result = updateActivityStreamSchema.safeParse({ source: 'new-source' });
    expect(result.success).toBe(true);
  });

  it('should accept empty update', () => {
    const result = updateActivityStreamSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('Create Activity Schema', () => {
  it('should accept valid create request', () => {
    const result = createActivitySchema.safeParse({
      type: 'coding',
      startTime: '2026-01-05T10:00:00Z',
      endTime: '2026-01-05T11:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('should accept with optional metadata', () => {
    const result = createActivitySchema.safeParse({
      type: 'coding',
      startTime: '2026-01-05T10:00:00Z',
      endTime: '2026-01-05T11:00:00Z',
      metadata: { language: 'typescript' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing type', () => {
    const result = createActivitySchema.safeParse({
      startTime: '2026-01-05T10:00:00Z',
      endTime: '2026-01-05T11:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid datetime format', () => {
    const result = createActivitySchema.safeParse({
      type: 'coding',
      startTime: 'invalid',
      endTime: '2026-01-05T11:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('Update Activity Schema', () => {
  it('should accept partial update with type only', () => {
    const result = updateActivitySchema.safeParse({ type: 'meeting' });
    expect(result.success).toBe(true);
  });

  it('should accept partial update with times', () => {
    const result = updateActivitySchema.safeParse({
      startTime: '2026-01-05T10:00:00Z',
      endTime: '2026-01-05T12:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty update', () => {
    const result = updateActivitySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('Activity Query Schema', () => {
  it('should accept valid date range', () => {
    const result = activityQuerySchema.safeParse({
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-01-31T23:59:59Z',
    });
    expect(result.success).toBe(true);
  });

  it('should accept startDate only', () => {
    const result = activityQuerySchema.safeParse({
      startDate: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty query', () => {
    const result = activityQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
