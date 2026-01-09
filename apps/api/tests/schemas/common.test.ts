/**
 * Common schema tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  idSchema,
  timestampSchema,
  optionalTimestampSchema,
  paginationSchema,
  successResponse,
  listResponse,
  errorResponseSchema,
  deleteResponseSchema,
} from '../../src/schemas/common.js';

describe('idSchema', () => {
  it('should accept valid UUIDs', () => {
    const validId = '123e4567-e89b-12d3-a456-426614174000';
    expect(idSchema.parse(validId)).toBe(validId);
  });

  it('should reject invalid UUIDs', () => {
    expect(() => idSchema.parse('not-a-uuid')).toThrow();
    expect(() => idSchema.parse('')).toThrow();
    expect(() => idSchema.parse('123')).toThrow();
  });
});

describe('timestampSchema', () => {
  it('should accept valid ISO timestamps', () => {
    const validTimestamp = '2026-01-04T12:00:00Z';
    expect(timestampSchema.parse(validTimestamp)).toBe(validTimestamp);
  });

  it('should accept timestamps with milliseconds', () => {
    const timestamp = '2026-01-04T12:00:00.123Z';
    expect(timestampSchema.parse(timestamp)).toBe(timestamp);
  });

  it('should reject invalid timestamps', () => {
    expect(() => timestampSchema.parse('2026-01-04')).toThrow();
    expect(() => timestampSchema.parse('not-a-date')).toThrow();
    expect(() => timestampSchema.parse('')).toThrow();
  });
});

describe('optionalTimestampSchema', () => {
  it('should accept valid timestamps', () => {
    const timestamp = '2026-01-04T12:00:00Z';
    expect(optionalTimestampSchema.parse(timestamp)).toBe(timestamp);
  });

  it('should accept null', () => {
    expect(optionalTimestampSchema.parse(null)).toBeNull();
  });

  it('should accept undefined', () => {
    expect(optionalTimestampSchema.parse(undefined)).toBeUndefined();
  });
});

describe('paginationSchema', () => {
  it('should use default values', () => {
    const result = paginationSchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('should accept valid pagination values', () => {
    const result = paginationSchema.parse({ limit: 50, offset: 100 });
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(100);
  });

  it('should coerce string values', () => {
    const result = paginationSchema.parse({ limit: '25', offset: '50' });
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(50);
  });

  it('should reject limit below minimum', () => {
    expect(() => paginationSchema.parse({ limit: 0 })).toThrow();
  });

  it('should reject limit above maximum', () => {
    expect(() => paginationSchema.parse({ limit: 101 })).toThrow();
  });

  it('should reject negative offset', () => {
    expect(() => paginationSchema.parse({ offset: -1 })).toThrow();
  });
});

describe('successResponse', () => {
  it('should create a valid response schema', () => {
    const dataSchema = z.object({ id: z.string(), name: z.string() });
    const responseSchema = successResponse(dataSchema);

    const result = responseSchema.parse({
      data: { id: '123', name: 'Test' },
    });

    expect(result.data.id).toBe('123');
    expect(result.data.name).toBe('Test');
  });

  it('should reject response without data', () => {
    const dataSchema = z.object({ id: z.string() });
    const responseSchema = successResponse(dataSchema);

    expect(() => responseSchema.parse({})).toThrow();
  });
});

describe('listResponse', () => {
  it('should create a valid list response schema', () => {
    const itemSchema = z.object({ id: z.string() });
    const responseSchema = listResponse(itemSchema);

    const result = responseSchema.parse({
      data: [{ id: '1' }, { id: '2' }],
    });

    expect(result.data).toHaveLength(2);
  });

  it('should accept empty array', () => {
    const itemSchema = z.object({ id: z.string() });
    const responseSchema = listResponse(itemSchema);

    const result = responseSchema.parse({ data: [] });

    expect(result.data).toHaveLength(0);
  });

  it('should accept optional total', () => {
    const itemSchema = z.object({ id: z.string() });
    const responseSchema = listResponse(itemSchema);

    const result = responseSchema.parse({
      data: [{ id: '1' }],
      total: 100,
    });

    expect(result.total).toBe(100);
  });
});

describe('errorResponseSchema', () => {
  it('should validate error response', () => {
    const result = errorResponseSchema.parse({
      error: 'Not found',
      message: 'Resource not found',
    });

    expect(result.error).toBe('Not found');
    expect(result.message).toBe('Resource not found');
  });

  it('should accept error only', () => {
    const result = errorResponseSchema.parse({ error: 'Error' });

    expect(result.error).toBe('Error');
    expect(result.message).toBeUndefined();
  });

  it('should accept details', () => {
    const result = errorResponseSchema.parse({
      error: 'Validation error',
      details: { field: 'name', issue: 'required' },
    });

    expect(result.details).toEqual({ field: 'name', issue: 'required' });
  });
});

describe('deleteResponseSchema', () => {
  it('should validate delete response', () => {
    const result = deleteResponseSchema.parse({ success: true });

    expect(result.success).toBe(true);
  });

  it('should reject false success', () => {
    expect(() => deleteResponseSchema.parse({ success: false })).toThrow();
  });
});
