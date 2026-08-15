/** `@docket/web` — task hierarchy graph drag resolution tests. */
import { act, renderHook } from '@testing-library/react';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import type { DragEvent as ReactDragEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveHierarchyDrag,
  useTaskHierarchyDrag,
} from '@/components/canvas/use-task-hierarchy-drag';
import { OBJECT_SET_DRAG_MIME } from '@/components/dnd/drag-payload';

const nativeDrag: {
  value: {
    object: null;
    objects: { kind: 'task'; id: string; title: string; organizationId: string }[];
    sourceSurfaceId: null;
  };
} = vi.hoisted(() => ({
  value: { object: null, objects: [], sourceSurfaceId: null },
}));

vi.mock('@/components/dnd/drag-context', () => ({
  useDragState: () => nativeDrag.value,
}));

const node = (id: string, parentTaskId: string | null): Node => ({
  id,
  type: 'taskBranch',
  position: { x: 0, y: 0 },
  data: { parentTaskId, title: id },
});

const nodes = [
  node('root', null),
  node('child', 'root'),
  node('grandchild', 'child'),
  node('other', null),
  node('other-child', 'other'),
];

describe('resolveHierarchyDrag', () => {
  it('chooses the deepest eligible intersecting task', () => {
    expect(resolveHierarchyDrag(nodes, ['root'], 'root', ['other', 'other-child'])).toMatchObject({
      subjectIds: ['root'],
      targetId: 'other-child',
    });
  });

  it('rejects the dragged subtree as a parent target', () => {
    expect(resolveHierarchyDrag(nodes, ['root'], 'root', ['child', 'grandchild'])).toMatchObject({
      targetId: null,
      invalidTargetId: 'grandchild',
    });
  });

  it('treats dropping every subject on its current parent as a no-op', () => {
    expect(resolveHierarchyDrag(nodes, ['child'], 'child', ['root'])).toMatchObject({
      targetId: null,
      invalidTargetId: 'root',
    });
  });

  it('reduces overlapping selections to movable roots', () => {
    expect(
      resolveHierarchyDrag(nodes, ['root', 'child', 'other'], 'root', ['other-child']),
    ).toMatchObject({ subjectIds: ['root', 'other'], targetId: null });
  });

  it('moves only the dragged node when it is outside the current selection', () => {
    expect(resolveHierarchyDrag(nodes, ['root'], 'other', ['child'])).toMatchObject({
      subjectIds: ['other'],
      targetId: 'child',
    });
  });

  it('accepts a same-workspace task dragged in from outside the current graph scope', () => {
    expect(resolveHierarchyDrag(nodes, ['external'], 'external', ['other'])).toMatchObject({
      subjectIds: ['external'],
      targetId: 'other',
    });
  });

  it('previews the deepest hit, snaps back, and commits once on drag stop', () => {
    const rootNode = node('root', null);
    const setNodes = vi.fn();
    const onCommit = vi.fn();
    const instance = {
      screenToFlowPosition: vi.fn(() => ({ x: 20, y: 30 })),
      getIntersectingNodes: vi.fn(() => [nodes[3], nodes[4]]),
      setNodes,
    } as unknown as ReactFlowInstance;
    const { result } = renderHook(() =>
      useTaskHierarchyDrag({
        nodes,
        selectedIds: ['root'],
        organizationId: 'org-1',
        instance,
        onCommit,
      }),
    );
    const pointer = { clientX: 20, clientY: 30 } as MouseEvent;

    act(() => {
      result.current.onNodeDragStart(pointer, rootNode, [rootNode]);
      result.current.onNodeDrag(pointer, rootNode, [rootNode]);
    });
    expect(result.current.status).toContain('other');

    act(() => {
      result.current.onNodeDragStop(pointer, rootNode, [rootNode]);
    });
    expect(onCommit).toHaveBeenCalledWith(['root'], 'other-child');
    expect(setNodes).toHaveBeenCalled();
    expect(result.current.status).toBeNull();
  });

  it('accepts a native object-set drop on a visible task through the same resolver', () => {
    const onCommit = vi.fn();
    nativeDrag.value.objects = [
      { kind: 'task', id: 'external', title: 'External', organizationId: 'org-1' },
    ];
    const instance = { setNodes: vi.fn() } as unknown as ReactFlowInstance;
    const { result } = renderHook(() =>
      useTaskHierarchyDrag({
        nodes,
        selectedIds: [],
        organizationId: 'org-1',
        instance,
        onCommit,
      }),
    );
    const target = document.createElement('div');
    target.dataset['objectKind'] = 'task';
    target.dataset['objectId'] = 'other';
    const objects = nativeDrag.value.objects;
    const dataTransfer = {
      dropEffect: 'none',
      getData: (type: string) =>
        type === OBJECT_SET_DRAG_MIME ? JSON.stringify({ version: 1, objects }) : '',
    } as DataTransfer;
    const preventDefault = vi.fn();
    const event = {
      target,
      dataTransfer,
      preventDefault,
    } as unknown as ReactDragEvent<HTMLElement>;

    act(() => {
      result.current.onNativeDragOver(event);
      result.current.onNativeDrop(event);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledWith(['external'], 'other');
  });
});
