/**
 * Unit tests for object-extractor.ts
 *
 * Tests extraction of objects from tool call results.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  extractObjectsFromToolResult,
  toolReturnsObjects,
  getToolObjectType,
} from '@/lib/assistant/object-extractor';

// =============================================================================
// extractObjectsFromToolResult Tests
// =============================================================================

describe('extractObjectsFromToolResult', () => {
  describe('task tools', () => {
    it('extracts created task from create_task result', () => {
      const result = {
        success: true,
        taskId: 'task-123',
        title: 'Test task',
      };

      const objects = extractObjectsFromToolResult('create_task', result);

      expect(objects).toHaveLength(1);
      expect(objects[0]).toEqual({
        type: 'task',
        id: 'task-123',
        action: 'created',
        data: result,
      });
    });

    it('returns empty array when create_task fails', () => {
      const result = { success: false, error: 'Something went wrong' };
      const objects = extractObjectsFromToolResult('create_task', result);
      expect(objects).toHaveLength(0);
    });

    it('extracts updated task from update_task result', () => {
      const result = {
        success: true,
        taskId: 'task-456',
        title: 'Updated task',
      };

      const objects = extractObjectsFromToolResult('update_task', result);

      expect(objects).toHaveLength(1);
      expect(objects[0]).toEqual({
        type: 'task',
        id: 'task-456',
        action: 'updated',
        data: result,
      });
    });

    it('extracts completed task from complete_task result', () => {
      const result = {
        success: true,
        taskId: 'task-789',
        status: 'completed',
      };

      const objects = extractObjectsFromToolResult('complete_task', result);

      expect(objects).toHaveLength(1);
      expect(objects[0]).toEqual({
        type: 'task',
        id: 'task-789',
        action: 'updated',
        data: result,
      });
    });

    it('extracts multiple tasks from list_tasks result', () => {
      const result = {
        tasks: [
          { id: 'task-1', title: 'Task 1' },
          { id: 'task-2', title: 'Task 2' },
          { id: 'task-3', title: 'Task 3' },
        ],
      };

      const objects = extractObjectsFromToolResult('list_tasks', result);

      expect(objects).toHaveLength(3);
      expect(objects[0]).toEqual({
        type: 'task',
        id: 'task-1',
        action: 'returned',
        data: { id: 'task-1', title: 'Task 1' },
      });
      expect(objects[2]).toEqual({
        type: 'task',
        id: 'task-3',
        action: 'returned',
        data: { id: 'task-3', title: 'Task 3' },
      });
    });

    it('returns empty array when list_tasks has no tasks', () => {
      const result = { tasks: [] };
      const objects = extractObjectsFromToolResult('list_tasks', result);
      expect(objects).toHaveLength(0);
    });

    it('returns empty array when list_tasks tasks is not array', () => {
      const result = { tasks: 'not an array' };
      const objects = extractObjectsFromToolResult('list_tasks', result);
      expect(objects).toHaveLength(0);
    });

    it('extracts tasks from search_tasks result', () => {
      const result = {
        tasks: [{ id: 'search-1', title: 'Found task' }],
      };

      const objects = extractObjectsFromToolResult('search_tasks', result);

      expect(objects).toHaveLength(1);
      expect(objects.at(0)?.action).toBe('returned');
    });
  });

  describe('event tools', () => {
    it('extracts created event from create_event result', () => {
      const result = {
        success: true,
        eventId: 'event-123',
        title: 'Test event',
      };

      const objects = extractObjectsFromToolResult('create_event', result);

      expect(objects).toHaveLength(1);
      expect(objects[0]).toEqual({
        type: 'event',
        id: 'event-123',
        action: 'created',
        data: result,
      });
    });

    it('extracts events from list_events result', () => {
      const result = {
        events: [
          { id: 'event-1', title: 'Event 1' },
          { id: 'event-2', title: 'Event 2' },
        ],
      };

      const objects = extractObjectsFromToolResult('list_events', result);

      expect(objects).toHaveLength(2);
      expect(objects.at(0)?.type).toBe('event');
      expect(objects.at(0)?.action).toBe('returned');
    });
  });

  describe('project tools', () => {
    it('extracts projects from list_projects result', () => {
      const result = {
        projects: [{ id: 'proj-1', name: 'Project 1' }],
      };

      const objects = extractObjectsFromToolResult('list_projects', result);

      expect(objects).toHaveLength(1);
      expect(objects[0]).toEqual({
        type: 'project',
        id: 'proj-1',
        action: 'returned',
        data: { id: 'proj-1', name: 'Project 1' },
      });
    });
  });

  describe('agenda tool', () => {
    it('extracts both tasks and events from get_agenda result', () => {
      const result = {
        tasks: [{ id: 'task-1', title: 'Task 1' }],
        events: [{ id: 'event-1', title: 'Event 1' }],
      };

      const objects = extractObjectsFromToolResult('get_agenda', result);

      expect(objects).toHaveLength(2);

      const taskRef = objects.find((o) => o.type === 'task');
      const eventRef = objects.find((o) => o.type === 'event');

      expect(taskRef?.id).toBe('task-1');
      expect(eventRef?.id).toBe('event-1');
    });

    it('handles agenda with only tasks', () => {
      const result = { tasks: [{ id: 'task-1', title: 'Task' }] };
      const objects = extractObjectsFromToolResult('get_agenda', result);
      expect(objects).toHaveLength(1);
    });

    it('handles agenda with only events', () => {
      const result = { events: [{ id: 'event-1', title: 'Event' }] };
      const objects = extractObjectsFromToolResult('get_agenda', result);
      expect(objects).toHaveLength(1);
    });
  });

  describe('timer tools', () => {
    it('returns empty array for start_timer', () => {
      const result = { success: true, timerId: '123' };
      const objects = extractObjectsFromToolResult('start_timer', result);
      expect(objects).toHaveLength(0);
    });

    it('returns empty array for stop_timer', () => {
      const result = { success: true, duration: 3600 };
      const objects = extractObjectsFromToolResult('stop_timer', result);
      expect(objects).toHaveLength(0);
    });

    it('returns empty array for get_timer_status', () => {
      const result = { active: true, elapsed: 1800 };
      const objects = extractObjectsFromToolResult('get_timer_status', result);
      expect(objects).toHaveLength(0);
    });
  });

  describe('productivity summary', () => {
    it('returns empty array for get_productivity_summary', () => {
      const result = { completedTasks: 10, totalTime: 7200 };
      const objects = extractObjectsFromToolResult('get_productivity_summary', result);
      expect(objects).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for null result', () => {
      const objects = extractObjectsFromToolResult('create_task', null);
      expect(objects).toHaveLength(0);
    });

    it('returns empty array for undefined result', () => {
      const objects = extractObjectsFromToolResult('create_task', undefined);
      expect(objects).toHaveLength(0);
    });

    it('returns empty array for non-object result', () => {
      const objects = extractObjectsFromToolResult('create_task', 'string result');
      expect(objects).toHaveLength(0);
    });

    it('returns empty array for unknown tool', () => {
      const result = { something: 'data' };
      const objects = extractObjectsFromToolResult('unknown_tool', result);
      expect(objects).toHaveLength(0);
    });

    it('handles extractor error gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      // Create a result that will cause an error in the extractor
      const result = {
        tasks: null, // Will fail when iterating
      };

      const objects = extractObjectsFromToolResult('list_tasks', result);
      expect(objects).toHaveLength(0);

      consoleSpy.mockRestore();
    });
  });
});

// =============================================================================
// toolReturnsObjects Tests
// =============================================================================

describe('toolReturnsObjects', () => {
  it('returns true for task tools', () => {
    expect(toolReturnsObjects('create_task')).toBe(true);
    expect(toolReturnsObjects('update_task')).toBe(true);
    expect(toolReturnsObjects('complete_task')).toBe(true);
    expect(toolReturnsObjects('list_tasks')).toBe(true);
    expect(toolReturnsObjects('search_tasks')).toBe(true);
  });

  it('returns true for event tools', () => {
    expect(toolReturnsObjects('create_event')).toBe(true);
    expect(toolReturnsObjects('list_events')).toBe(true);
  });

  it('returns true for project tools', () => {
    expect(toolReturnsObjects('list_projects')).toBe(true);
  });

  it('returns true for get_agenda', () => {
    expect(toolReturnsObjects('get_agenda')).toBe(true);
  });

  it('returns false for timer tools', () => {
    expect(toolReturnsObjects('start_timer')).toBe(false);
    expect(toolReturnsObjects('stop_timer')).toBe(false);
    expect(toolReturnsObjects('get_timer_status')).toBe(false);
  });

  it('returns false for productivity summary', () => {
    expect(toolReturnsObjects('get_productivity_summary')).toBe(false);
  });

  it('returns false for unknown tools', () => {
    expect(toolReturnsObjects('unknown_tool')).toBe(false);
  });
});

// =============================================================================
// getToolObjectType Tests
// =============================================================================

describe('getToolObjectType', () => {
  it('returns task for task tools', () => {
    expect(getToolObjectType('create_task')).toBe('task');
    expect(getToolObjectType('update_task')).toBe('task');
    expect(getToolObjectType('complete_task')).toBe('task');
    expect(getToolObjectType('list_tasks')).toBe('task');
    expect(getToolObjectType('search_tasks')).toBe('task');
  });

  it('returns event for event tools', () => {
    expect(getToolObjectType('create_event')).toBe('event');
    expect(getToolObjectType('list_events')).toBe('event');
  });

  it('returns project for list_projects', () => {
    expect(getToolObjectType('list_projects')).toBe('project');
  });

  it('returns null for get_agenda (mixed types)', () => {
    expect(getToolObjectType('get_agenda')).toBe(null);
  });

  it('returns null for timer tools', () => {
    expect(getToolObjectType('start_timer')).toBe(null);
    expect(getToolObjectType('stop_timer')).toBe(null);
  });

  it('returns null for unknown tools', () => {
    expect(getToolObjectType('unknown')).toBe(null);
  });
});
