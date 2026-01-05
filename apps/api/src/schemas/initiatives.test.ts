/**
 * Initiative schema tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  createInitiativeSchema,
  updateInitiativeSchema,
  initiativeStatusSchema,
} from './initiatives.js';

describe('initiativeStatusSchema', () => {
  it('should accept valid status values', () => {
    expect(initiativeStatusSchema.parse('draft')).toBe('draft');
    expect(initiativeStatusSchema.parse('active')).toBe('active');
    expect(initiativeStatusSchema.parse('completed')).toBe('completed');
    expect(initiativeStatusSchema.parse('archived')).toBe('archived');
  });

  it('should reject invalid status values', () => {
    expect(() => initiativeStatusSchema.parse('invalid')).toThrow();
    expect(() => initiativeStatusSchema.parse('')).toThrow();
    expect(() => initiativeStatusSchema.parse(123)).toThrow();
  });
});

describe('createInitiativeSchema', () => {
  it('should validate valid create input', () => {
    const input = {
      name: 'Test Initiative',
      description: 'A test initiative',
      status: 'draft' as const,
    };

    const result = createInitiativeSchema.parse(input);

    expect(result.name).toBe('Test Initiative');
    expect(result.description).toBe('A test initiative');
    expect(result.status).toBe('draft');
  });

  it('should accept minimal input', () => {
    const input = { name: 'Minimal Initiative' };

    const result = createInitiativeSchema.parse(input);

    expect(result.name).toBe('Minimal Initiative');
    expect(result.description).toBeUndefined();
    expect(result.status).toBeUndefined();
  });

  it('should reject empty name', () => {
    const input = { name: '' };

    expect(() => createInitiativeSchema.parse(input)).toThrow();
  });

  it('should reject name exceeding max length', () => {
    const input = { name: 'a'.repeat(256) };

    expect(() => createInitiativeSchema.parse(input)).toThrow();
  });

  it('should accept valid parent ID', () => {
    const input = {
      name: 'Child Initiative',
      parentId: '00000000-0000-0000-0000-000000000001',
    };

    const result = createInitiativeSchema.parse(input);

    expect(result.parentId).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('should reject invalid parent ID format', () => {
    const input = {
      name: 'Child Initiative',
      parentId: 'not-a-uuid',
    };

    expect(() => createInitiativeSchema.parse(input)).toThrow();
  });
});

describe('updateInitiativeSchema', () => {
  it('should validate partial update', () => {
    const input = { name: 'Updated Name' };

    const result = updateInitiativeSchema.parse(input);

    expect(result.name).toBe('Updated Name');
  });

  it('should accept empty object', () => {
    const input = {};

    const result = updateInitiativeSchema.parse(input);

    expect(result).toEqual({});
  });

  it('should accept null description to clear it', () => {
    const input = { description: null };

    const result = updateInitiativeSchema.parse(input);

    expect(result.description).toBeNull();
  });

  it('should accept null parentId to unlink', () => {
    const input = { parentId: null };

    const result = updateInitiativeSchema.parse(input);

    expect(result.parentId).toBeNull();
  });

  it('should validate all fields together', () => {
    const input = {
      name: 'Full Update',
      description: 'Updated description',
      status: 'completed' as const,
      parentId: '00000000-0000-0000-0000-000000000002',
    };

    const result = updateInitiativeSchema.parse(input);

    expect(result.name).toBe('Full Update');
    expect(result.description).toBe('Updated description');
    expect(result.status).toBe('completed');
    expect(result.parentId).toBe('00000000-0000-0000-0000-000000000002');
  });
});
