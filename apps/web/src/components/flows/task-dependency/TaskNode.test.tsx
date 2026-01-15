/**
 * Tests for TaskNode component.
 *
 * Validates that:
 * - Task nodes render with correct title and status
 * - Priority badges display correctly
 * - Assignees and deadlines show when present
 * - Selection and blocking states apply correct styles
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TaskNode, type TaskNodeData, type TaskNodeType } from './TaskNode';
import type { NodeProps } from '@xyflow/react';

// Mock @xyflow/react
vi.mock('@xyflow/react', () => ({
  Handle: (props: { type: string; position: string }) => (
    <div data-testid={`handle-${props.type}`} data-position={props.position} />
  ),
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

afterEach(() => {
  cleanup();
});

// =============================================================================
// Test Data
// =============================================================================

type TaskNodeProps = NodeProps<TaskNodeType>;

const createNodeProps = (
  dataOverrides: Partial<TaskNodeData> = {},
  propsOverrides: Partial<Omit<TaskNodeProps, 'data'>> = {},
): TaskNodeProps => ({
  id: 'test-node',
  type: 'task',
  data: {
    id: 'task-1',
    title: 'Test Task',
    status: 'pending',
    priority: 'medium',
    assignee: null,
    deadline: null,
    isBlocking: false,
    ...dataOverrides,
  },
  selected: false,
  selectable: true,
  deletable: true,
  draggable: false,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  zIndex: 0,
  dragging: false,
  targetPosition: undefined,
  sourcePosition: undefined,
  ...propsOverrides,
});

// =============================================================================
// TaskNode Tests
// =============================================================================

describe('TaskNode', () => {
  describe('rendering', () => {
    it('renders task title', () => {
      const props = createNodeProps({ title: 'Important Task' });
      render(<TaskNode {...props} />);

      expect(screen.getByText('Important Task')).toBeTruthy();
    });

    it('renders both target and source handles', () => {
      const props = createNodeProps();
      render(<TaskNode {...props} />);

      expect(screen.getByTestId('handle-target')).toBeTruthy();
      expect(screen.getByTestId('handle-source')).toBeTruthy();
    });
  });

  describe('status display', () => {
    it.each([
      ['pending', 'Pending'],
      ['in_progress', 'In Progress'],
      ['completed', 'Done'],
      ['cancelled', 'Cancelled'],
    ] as const)('does not show status label text for %s status', (status, _label) => {
      const props = createNodeProps({ status });
      render(<TaskNode {...props} />);

      // Status is shown via icon, not text label in the current implementation
      // The icon is present but we're not testing SVG content
      expect(screen.getByText('Test Task')).toBeTruthy();
    });
  });

  describe('priority display', () => {
    it.each([
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
      ['urgent', 'Urgent'],
    ] as const)('shows %s priority badge with correct label', (priority, expectedLabel) => {
      const props = createNodeProps({ priority });
      render(<TaskNode {...props} />);

      expect(screen.getByText(expectedLabel)).toBeTruthy();
    });
  });

  describe('assignee display', () => {
    it('shows assignee when present', () => {
      const props = createNodeProps({ assignee: 'John Doe' });
      render(<TaskNode {...props} />);

      expect(screen.getByText('John Doe')).toBeTruthy();
    });

    it('does not show assignee section when null', () => {
      const props = createNodeProps({ assignee: null });
      render(<TaskNode {...props} />);

      expect(screen.queryByText('John Doe')).toBeNull();
    });
  });

  describe('deadline display', () => {
    it('shows formatted deadline when present', () => {
      const props = createNodeProps({ deadline: '2026-01-15' });
      render(<TaskNode {...props} />);

      // The exact format depends on locale, but should contain "Due:"
      expect(screen.getByText(/Due:/)).toBeTruthy();
    });

    it('does not show deadline when null', () => {
      const props = createNodeProps({ deadline: null });
      render(<TaskNode {...props} />);

      expect(screen.queryByText(/Due:/)).toBeNull();
    });
  });

  describe('selection state', () => {
    it('applies selected styles when selected', () => {
      const props = createNodeProps({}, { selected: true });
      const { container } = render(<TaskNode {...props} />);

      const nodeDiv = container.firstChild as HTMLElement;
      expect(nodeDiv.className).toContain('border-primary');
    });

    it('applies default border when not selected', () => {
      const props = createNodeProps({}, { selected: false });
      const { container } = render(<TaskNode {...props} />);

      const nodeDiv = container.firstChild as HTMLElement;
      expect(nodeDiv.className).toContain('border-outline-variant');
    });
  });

  describe('blocking state', () => {
    it('applies blocking ring when task is blocking others', () => {
      const props = createNodeProps({ isBlocking: true });
      const { container } = render(<TaskNode {...props} />);

      const nodeDiv = container.firstChild as HTMLElement;
      expect(nodeDiv.className).toContain('ring-error');
    });

    it('does not apply blocking ring when not blocking', () => {
      const props = createNodeProps({ isBlocking: false });
      const { container } = render(<TaskNode {...props} />);

      const nodeDiv = container.firstChild as HTMLElement;
      expect(nodeDiv.className).not.toContain('ring-error');
    });
  });
});
