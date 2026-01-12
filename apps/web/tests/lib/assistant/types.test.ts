/**
 * Unit tests for types.ts
 *
 * Tests type guards and constants.
 */

import { describe, it, expect } from 'vitest';
import { isObjectOfType, TOOL_LABELS, TOOL_ICONS } from '@/lib/assistant/types';
import type { ObjectReference } from '@/lib/assistant/types';

// =============================================================================
// isObjectOfType Tests
// =============================================================================

describe('isObjectOfType', () => {
  it('returns true when type matches', () => {
    const ref: ObjectReference = {
      type: 'task',
      id: 'task-123',
      action: 'created',
      data: { id: 'task-123', title: 'Test task' },
    };

    expect(isObjectOfType(ref, 'task')).toBe(true);
  });

  it('returns false when type does not match', () => {
    const ref: ObjectReference = {
      type: 'task',
      id: 'task-123',
      action: 'created',
      data: { id: 'task-123', title: 'Test task' },
    };

    expect(isObjectOfType(ref, 'event')).toBe(false);
    expect(isObjectOfType(ref, 'project')).toBe(false);
    expect(isObjectOfType(ref, 'initiative')).toBe(false);
  });

  it('works with event type', () => {
    const ref: ObjectReference = {
      type: 'event',
      id: 'event-123',
      action: 'created',
      data: { id: 'event-123', title: 'Test event', startTime: '2024-01-01' },
    };

    expect(isObjectOfType(ref, 'event')).toBe(true);
    expect(isObjectOfType(ref, 'task')).toBe(false);
  });

  it('works with project type', () => {
    const ref: ObjectReference = {
      type: 'project',
      id: 'proj-123',
      action: 'returned',
      data: { id: 'proj-123', name: 'Test project' },
    };

    expect(isObjectOfType(ref, 'project')).toBe(true);
    expect(isObjectOfType(ref, 'task')).toBe(false);
  });

  it('works with initiative type', () => {
    const ref: ObjectReference = {
      type: 'initiative',
      id: 'init-123',
      action: 'returned',
      data: { id: 'init-123', name: 'Test initiative' },
    };

    expect(isObjectOfType(ref, 'initiative')).toBe(true);
    expect(isObjectOfType(ref, 'task')).toBe(false);
  });

  it('narrows type correctly (type safety)', () => {
    const ref: ObjectReference = {
      type: 'task',
      id: 'task-123',
      action: 'created',
      data: { id: 'task-123', title: 'Test task' },
    };

    if (isObjectOfType(ref, 'task')) {
      // TypeScript should narrow this to TypedObjectReference<'task'>
      // This test just ensures the narrowing compiles
      expect(ref.type).toBe('task');
    }
  });
});

// =============================================================================
// TOOL_LABELS and TOOL_ICONS Tests
// =============================================================================

describe('TOOL_LABELS', () => {
  it('provides labels for known tools', () => {
    // Just verify the structure exists - don't test literal values
    expect(Object.keys(TOOL_LABELS).length).toBeGreaterThan(0);
  });
});

describe('TOOL_ICONS', () => {
  it('provides icons for known tools', () => {
    expect(Object.keys(TOOL_ICONS).length).toBeGreaterThan(0);
  });
});
