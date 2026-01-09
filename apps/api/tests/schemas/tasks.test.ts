/**
 * Task schema tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  createTaskSchema,
  updateTaskSchema,
  taskStatusSchema,
  taskPrioritySchema,
} from '../../src/schemas/tasks.js';

describe('taskStatusSchema', () => {
  it('should accept valid status values', () => {
    expect(taskStatusSchema.parse('pending')).toBe('pending');
    expect(taskStatusSchema.parse('in_progress')).toBe('in_progress');
    expect(taskStatusSchema.parse('completed')).toBe('completed');
    expect(taskStatusSchema.parse('cancelled')).toBe('cancelled');
  });

  it('should reject invalid status values', () => {
    expect(() => taskStatusSchema.parse('done')).toThrow();
    expect(() => taskStatusSchema.parse('')).toThrow();
  });
});

describe('taskPrioritySchema', () => {
  it('should accept valid priority values', () => {
    expect(taskPrioritySchema.parse('low')).toBe('low');
    expect(taskPrioritySchema.parse('medium')).toBe('medium');
    expect(taskPrioritySchema.parse('high')).toBe('high');
    expect(taskPrioritySchema.parse('urgent')).toBe('urgent');
  });

  it('should reject invalid priority values', () => {
    expect(() => taskPrioritySchema.parse('critical')).toThrow();
  });
});

describe('createTaskSchema', () => {
  it('should validate valid create input', () => {
    const input = {
      title: 'Test Task',
      description: 'A test task',
      status: 'pending' as const,
      priority: 'high' as const,
    };

    const result = createTaskSchema.parse(input);

    expect(result.title).toBe('Test Task');
    expect(result.status).toBe('pending');
    expect(result.priority).toBe('high');
  });

  it('should accept minimal input', () => {
    const input = { title: 'Minimal Task' };

    const result = createTaskSchema.parse(input);

    expect(result.title).toBe('Minimal Task');
    expect(result.status).toBeUndefined();
    expect(result.priority).toBeUndefined();
  });

  it('should reject empty title', () => {
    const input = { title: '' };

    expect(() => createTaskSchema.parse(input)).toThrow();
  });

  it('should reject title exceeding max length', () => {
    const input = { title: 'a'.repeat(501) };

    expect(() => createTaskSchema.parse(input)).toThrow();
  });

  it('should accept valid deadline', () => {
    const input = {
      title: 'Task with deadline',
      deadline: '2026-12-31T23:59:59Z',
    };

    const result = createTaskSchema.parse(input);

    expect(result.deadline).toBe('2026-12-31T23:59:59Z');
  });

  it('should reject invalid deadline format', () => {
    const input = {
      title: 'Task',
      deadline: 'not-a-date',
    };

    expect(() => createTaskSchema.parse(input)).toThrow();
  });

  it('should accept valid estimated minutes', () => {
    const input = {
      title: 'Task',
      estimatedMinutes: 120,
    };

    const result = createTaskSchema.parse(input);

    expect(result.estimatedMinutes).toBe(120);
  });

  it('should reject negative estimated minutes', () => {
    const input = {
      title: 'Task',
      estimatedMinutes: -30,
    };

    expect(() => createTaskSchema.parse(input)).toThrow();
  });

  it('should accept tag IDs array', () => {
    const input = {
      title: 'Tagged Task',
      tagIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    };

    const result = createTaskSchema.parse(input);

    expect(result.tagIds).toHaveLength(2);
  });

  it('should reject invalid tag ID format', () => {
    const input = {
      title: 'Task',
      tagIds: ['not-a-uuid'],
    };

    expect(() => createTaskSchema.parse(input)).toThrow();
  });
});

describe('updateTaskSchema', () => {
  it('should validate partial update', () => {
    const input = { title: 'Updated Title' };

    const result = updateTaskSchema.parse(input);

    expect(result.title).toBe('Updated Title');
  });

  it('should accept empty object', () => {
    const input = {};

    const result = updateTaskSchema.parse(input);

    expect(result).toEqual({});
  });

  it('should accept null deadline to clear it', () => {
    const input = { deadline: null };

    const result = updateTaskSchema.parse(input);

    expect(result.deadline).toBeNull();
  });

  it('should accept null assigneeId to unassign', () => {
    const input = { assigneeId: null };

    const result = updateTaskSchema.parse(input);

    expect(result.assigneeId).toBeNull();
  });

  it('should accept empty tag IDs to clear tags', () => {
    const input = { tagIds: [] };

    const result = updateTaskSchema.parse(input);

    expect(result.tagIds).toEqual([]);
  });

  it('should validate all fields together', () => {
    const input = {
      title: 'Full Update',
      description: 'Updated description',
      status: 'completed' as const,
      priority: 'low' as const,
      deadline: '2027-01-15T10:00:00Z',
      estimatedMinutes: 60,
      projectId: '00000000-0000-4000-8000-000000000001',
      assigneeId: '00000000-0000-4000-8000-000000000002',
      tagIds: ['00000000-0000-4000-8000-000000000003'],
    };

    const result = updateTaskSchema.parse(input);

    expect(result.title).toBe('Full Update');
    expect(result.status).toBe('completed');
    expect(result.priority).toBe('low');
    expect(result.tagIds).toHaveLength(1);
  });
});
