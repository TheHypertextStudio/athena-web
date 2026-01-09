/**
 * Moment schema tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  createMomentSchema,
  updateMomentSchema,
  momentQuerySchema,
} from '../../src/schemas/moments.js';

describe('createMomentSchema', () => {
  it('should validate valid create input', () => {
    const input = {
      label: 'Focus Session',
      description: 'Deep work on project',
      startTime: '2026-01-15T09:00:00Z',
      endTime: '2026-01-15T11:00:00Z',
    };

    const result = createMomentSchema.parse(input);

    expect(result.label).toBe('Focus Session');
    expect(result.startTime).toBe('2026-01-15T09:00:00Z');
    expect(result.endTime).toBe('2026-01-15T11:00:00Z');
  });

  it('should accept minimal input', () => {
    const input = {
      startTime: '2026-01-15T09:00:00Z',
      endTime: '2026-01-15T10:00:00Z',
    };

    const result = createMomentSchema.parse(input);

    expect(result.label).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('should reject missing startTime', () => {
    const input = {
      label: 'Test',
      endTime: '2026-01-15T10:00:00Z',
    };

    expect(() => createMomentSchema.parse(input)).toThrow();
  });

  it('should reject missing endTime', () => {
    const input = {
      label: 'Test',
      startTime: '2026-01-15T09:00:00Z',
    };

    expect(() => createMomentSchema.parse(input)).toThrow();
  });

  it('should reject invalid time format', () => {
    const input = {
      startTime: 'not-a-date',
      endTime: '2026-01-15T10:00:00Z',
    };

    expect(() => createMomentSchema.parse(input)).toThrow();
  });

  it('should reject label exceeding max length', () => {
    const input = {
      label: 'a'.repeat(256),
      startTime: '2026-01-15T09:00:00Z',
      endTime: '2026-01-15T10:00:00Z',
    };

    expect(() => createMomentSchema.parse(input)).toThrow();
  });

  it('should reject description exceeding max length', () => {
    const input = {
      description: 'a'.repeat(2001),
      startTime: '2026-01-15T09:00:00Z',
      endTime: '2026-01-15T10:00:00Z',
    };

    expect(() => createMomentSchema.parse(input)).toThrow();
  });
});

describe('updateMomentSchema', () => {
  it('should validate partial update', () => {
    const input = { label: 'Updated Label' };

    const result = updateMomentSchema.parse(input);

    expect(result.label).toBe('Updated Label');
  });

  it('should accept empty object', () => {
    const input = {};

    const result = updateMomentSchema.parse(input);

    expect(result).toEqual({});
  });

  it('should accept null label to clear it', () => {
    const input = { label: null };

    const result = updateMomentSchema.parse(input);

    expect(result.label).toBeNull();
  });

  it('should accept null description to clear it', () => {
    const input = { description: null };

    const result = updateMomentSchema.parse(input);

    expect(result.description).toBeNull();
  });

  it('should accept time updates', () => {
    const input = {
      startTime: '2026-01-15T10:00:00Z',
      endTime: '2026-01-15T12:00:00Z',
    };

    const result = updateMomentSchema.parse(input);

    expect(result.startTime).toBe('2026-01-15T10:00:00Z');
    expect(result.endTime).toBe('2026-01-15T12:00:00Z');
  });

  it('should validate all fields together', () => {
    const input = {
      label: 'Full Update',
      description: 'Updated description',
      startTime: '2026-01-15T14:00:00Z',
      endTime: '2026-01-15T16:00:00Z',
    };

    const result = updateMomentSchema.parse(input);

    expect(result.label).toBe('Full Update');
    expect(result.description).toBe('Updated description');
  });
});

describe('momentQuerySchema', () => {
  it('should accept valid date range', () => {
    const input = {
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-01-31T23:59:59Z',
    };

    const result = momentQuerySchema.parse(input);

    expect(result.startDate).toBe('2026-01-01T00:00:00Z');
    expect(result.endDate).toBe('2026-01-31T23:59:59Z');
  });

  it('should accept empty query', () => {
    const input = {};

    const result = momentQuerySchema.parse(input);

    expect(result).toEqual({});
  });

  it('should accept only startDate', () => {
    const input = { startDate: '2026-01-01T00:00:00Z' };

    const result = momentQuerySchema.parse(input);

    expect(result.startDate).toBe('2026-01-01T00:00:00Z');
    expect(result.endDate).toBeUndefined();
  });

  it('should reject invalid date format', () => {
    const input = { startDate: '2026-01-01' };

    expect(() => momentQuerySchema.parse(input)).toThrow();
  });
});
