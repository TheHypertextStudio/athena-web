import '@testing-library/jest-dom/vitest';

import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CURSOR_DRAGGABLE } from '../../src/lib/actions/cursor';
import { objectTargetProps, type ObjectRef } from '../../src/lib/actions/object';
import { InteractionProvider } from '../../src/lib/actions/interaction-provider';
import {
  type ActionRegistry,
  createActionRegistry,
  defineActionDomain,
} from '../../src/lib/actions/registry';
import type { ActionContext } from '../../src/lib/actions/types';
import {
  hasObjectPayload,
  OBJECT_DRAG_MIME,
  readObjectPayload,
  writeObjectPayload,
} from '../../src/components/dnd/drag-payload';
import { useDraggable } from '../../src/components/dnd/use-draggable';
import { useDropTarget } from '../../src/components/dnd/use-drop-target';
import { ENTITY_DRAG_MIME, readEntityDragObject } from '../../src/lib/entity-drag';

import { fakeDataTransfer, taskRef } from './harness';

afterEach(() => {
  cleanup();
});

const project: ObjectRef = { kind: 'project', id: 'p1', organizationId: 'org1', title: 'Launch' };
const foreignProject: ObjectRef = {
  kind: 'project',
  id: 'p2',
  organizationId: 'org2',
  title: 'Other workspace',
};
const timeBlock: ObjectRef = {
  kind: 'time_block',
  id: 'tb1',
  organizationId: null,
  title: 'Deep work',
  meta: { startsAt: '2026-08-02T09:00:00Z' },
};
const task = taskRef('1');

/** A registry recording every relational action the drops dispatch. */
function dropRegistry(seen: ActionContext[]): ActionRegistry {
  const registry = createActionRegistry();
  registry.register(
    'task',
    defineActionDomain('task', [
      {
        id: 'task.moveToProject',
        label: 'Move to project',
        objectKinds: ['task'],
        multi: true,
        run: (context) => {
          seen.push(context);
        },
      },
      {
        id: 'task.scheduleInBlock',
        label: 'Schedule in time block',
        objectKinds: ['task'],
        run: (context) => {
          seen.push(context);
        },
      },
    ]),
  );
  return registry;
}

/** Props for the drag fixture. */
interface BoardProps {
  readonly registry: ActionRegistry;
}

/** A page with a draggable task, a project drop target, a time block, and a foreign project. */
function Board({ registry }: BoardProps): JSX.Element {
  return (
    <InteractionProvider registry={registry}>
      <DraggableTask />
      <ProjectDropZone target={project} testId="project" />
      <ProjectDropZone target={foreignProject} testId="foreign-project" />
      <TimeBlockDropZone />
    </InteractionProvider>
  );
}

/** The dragged row. */
function DraggableTask(): JSX.Element {
  const drag = useDraggable({ object: task, surfaceId: 'tasks' });
  return (
    <div data-testid="task" {...objectTargetProps(task)} {...drag} className={drag.className} />
  );
}

/** A project row that adopts tasks from its own workspace. */
function ProjectDropZone({
  target,
  testId,
}: {
  readonly target: ObjectRef;
  readonly testId: string;
}): JSX.Element {
  const drop = useDropTarget({
    accepts: ['task'],
    action: 'task.moveToProject',
    effect: 'move',
    resolveContext: (dragged) =>
      dragged.organizationId === target.organizationId
        ? {
            objects: [dragged],
            target,
            source: 'drag',
            organizationId: target.organizationId,
          }
        : null,
  });
  return <div data-testid={testId} {...drop.dropProps} className={drop.dropProps.className} />;
}

/** A time block that schedules a dropped task into itself. */
function TimeBlockDropZone(): JSX.Element {
  const drop = useDropTarget({
    accepts: ['task'],
    action: 'task.scheduleInBlock',
    effect: 'link',
    resolveContext: (dragged) => ({
      objects: [dragged],
      target: timeBlock,
      source: 'drag',
      organizationId: dragged.organizationId,
      params: { startsAt: '2026-08-02T09:00:00Z' },
    }),
  });
  return <div data-testid="time-block" {...drop.dropProps} className={drop.dropProps.className} />;
}

/** Start a drag on `element` and return the transfer it wrote. */
function startDrag(element: Element): DataTransfer {
  const dataTransfer = fakeDataTransfer();
  fireEvent.dragStart(element, { dataTransfer });
  return dataTransfer;
}

/** Fire a cancelable `dragover` and report whether the target claimed it. */
function dragOver(element: Element, dataTransfer: DataTransfer): DragEvent {
  const event = createEvent.dragOver(element, { dataTransfer, bubbles: true, cancelable: true });
  fireEvent(element, event);
  return event as DragEvent;
}

describe('drag payload', () => {
  it('round-trips a full object, including kinds the legacy payload cannot express', () => {
    const transfer = fakeDataTransfer();
    writeObjectPayload(transfer, timeBlock);
    expect(readObjectPayload(transfer)).toEqual(timeBlock);
    expect(transfer.getData('text/plain')).toBe('Deep work');
  });

  it('mirrors the legacy entity payload so existing drop targets keep working', () => {
    const transfer = fakeDataTransfer();
    writeObjectPayload(transfer, task);
    expect(transfer.types).toContain(OBJECT_DRAG_MIME);
    expect(transfer.types).toContain(ENTITY_DRAG_MIME);
    expect(readEntityDragObject(transfer)).toMatchObject({ kind: 'task', id: '1' });
  });

  it('carries an initiative through the legacy shape with its parent links intact', () => {
    // The legacy payload has a wider shape for initiatives alone (they are the only kind whose
    // drop targets need to know where the dragged node currently hangs). Losing those two ids
    // silently reparents to the root instead of refusing, so they are asserted, not assumed.
    const transfer = fakeDataTransfer();
    writeObjectPayload(transfer, {
      kind: 'initiative',
      id: 'i1',
      organizationId: 'org1',
      title: 'Reduce churn',
      meta: { parentInitiativeId: 'i0', parentLinkId: 'link1' },
    });
    expect(readEntityDragObject(transfer)).toEqual({
      kind: 'initiative',
      id: 'i1',
      organizationId: 'org1',
      title: 'Reduce churn',
      parentInitiativeId: 'i0',
      parentLinkId: 'link1',
    });
  });

  it('nulls initiative parent links that are absent or not strings', () => {
    const transfer = fakeDataTransfer();
    writeObjectPayload(transfer, {
      kind: 'initiative',
      id: 'i2',
      organizationId: 'org1',
      title: 'Top level',
      meta: { parentInitiativeId: 7 },
    });
    expect(readEntityDragObject(transfer)).toMatchObject({
      parentInitiativeId: null,
      parentLinkId: null,
    });
  });

  it('skips the legacy mirror for kinds and scopes it cannot express', () => {
    // The legacy shape is organization-scoped and closed over six kinds. A personal object or a
    // calendar event must still drag — it simply travels in the object payload alone, rather than
    // being forced into a shape that would have to invent an organization for it.
    const personal = fakeDataTransfer();
    writeObjectPayload(personal, { ...task, organizationId: null });
    expect(personal.types).toContain(OBJECT_DRAG_MIME);
    expect(personal.types).not.toContain(ENTITY_DRAG_MIME);

    const event = fakeDataTransfer();
    writeObjectPayload(event, {
      kind: 'calendar_event',
      id: 'e1',
      organizationId: 'org1',
      title: 'Standup',
    });
    expect(event.types).toContain(OBJECT_DRAG_MIME);
    expect(event.types).not.toContain(ENTITY_DRAG_MIME);
  });

  it('answers whether a drag is ours at all, which is all `dragover` can ask', () => {
    const ours = fakeDataTransfer();
    writeObjectPayload(ours, task);
    expect(hasObjectPayload(ours)).toBe(true);

    const foreign = fakeDataTransfer();
    foreign.setData('text/plain', 'some text dragged in from another app');
    expect(hasObjectPayload(foreign)).toBe(false);
  });

  it('reads null for a foreign or malformed drag instead of throwing into a drop handler', () => {
    const empty = fakeDataTransfer();
    expect(readObjectPayload(empty)).toBeNull();

    const corrupt = fakeDataTransfer();
    corrupt.setData(OBJECT_DRAG_MIME, '{not json');
    expect(readObjectPayload(corrupt)).toBeNull();

    const unknownKind = fakeDataTransfer();
    unknownKind.setData(
      OBJECT_DRAG_MIME,
      JSON.stringify({ kind: 'milestone', id: 'x', title: 'x' }),
    );
    expect(readObjectPayload(unknownKind)).toBeNull();

    const notAnObject = fakeDataTransfer();
    notAnObject.setData(OBJECT_DRAG_MIME, '"just a string"');
    expect(readObjectPayload(notAnObject)).toBeNull();

    const nullPayload = fakeDataTransfer();
    nullPayload.setData(OBJECT_DRAG_MIME, 'null');
    expect(readObjectPayload(nullPayload)).toBeNull();

    const blankId = fakeDataTransfer();
    blankId.setData(OBJECT_DRAG_MIME, JSON.stringify({ kind: 'task', id: '', title: 'x' }));
    expect(readObjectPayload(blankId)).toBeNull();

    const noTitle = fakeDataTransfer();
    noTitle.setData(OBJECT_DRAG_MIME, JSON.stringify({ kind: 'task', id: '1' }));
    expect(readObjectPayload(noTitle)).toBeNull();
  });

  it('degrades a malformed org or meta to a usable object rather than discarding the drag', () => {
    // A drag that arrives with junk in one optional field still names a real object. Refusing it
    // outright would lose a gesture the person actually made; dropping just the junk does not.
    const transfer = fakeDataTransfer();
    transfer.setData(
      OBJECT_DRAG_MIME,
      JSON.stringify({ kind: 'task', id: '9', title: 'Ship it', organizationId: 12, meta: [1, 2] }),
    );
    expect(readObjectPayload(transfer)).toEqual({
      kind: 'task',
      id: '9',
      title: 'Ship it',
      organizationId: null,
    });
  });
});

describe('dragging an object', () => {
  it('writes the object and reports the grab cursor at rest', () => {
    render(<Board registry={dropRegistry([])} />);
    const row = screen.getByTestId('task');
    expect(row).toHaveAttribute('draggable', 'true');
    expect(row.className).toBe(CURSOR_DRAGGABLE);
    expect(CURSOR_DRAGGABLE).toContain('cursor-grab');
    expect(CURSOR_DRAGGABLE).toContain('active:cursor-grabbing');

    const transfer = startDrag(row);
    expect(readObjectPayload(transfer)).toMatchObject({ kind: 'task', id: '1' });
  });

  it('publishes the in-flight kind on the document and clears it on drag end', async () => {
    render(<Board registry={dropRegistry([])} />);
    const row = screen.getByTestId('task');
    startDrag(row);
    await waitFor(() => {
      expect(document.documentElement.dataset['draggingKind']).toBe('task');
    });
    fireEvent.dragEnd(row);
    await waitFor(() => {
      expect(document.documentElement.dataset['draggingKind']).toBeUndefined();
    });
  });
});

describe('dropping on a target', () => {
  it('associates a task with a project it is dropped on', async () => {
    const seen: ActionContext[] = [];
    render(<Board registry={dropRegistry(seen)} />);
    const transfer = startDrag(screen.getByTestId('task'));
    const zone = screen.getByTestId('project');

    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    await waitFor(() => {
      expect(zone).toHaveAttribute('data-drop-state', 'accept');
    });
    const over = dragOver(zone, transfer);
    expect(over.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe('move');

    fireEvent.drop(zone, { dataTransfer: transfer });
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0]?.objects.map((object) => object.id)).toEqual(['1']);
    expect(seen[0]?.target?.id).toBe('p1');
    expect(seen[0]?.source).toBe('drag');
  });

  it('schedules a task into a time block, carrying the slot as a parameter', async () => {
    const seen: ActionContext[] = [];
    render(<Board registry={dropRegistry(seen)} />);
    const transfer = startDrag(screen.getByTestId('task'));
    const zone = screen.getByTestId('time-block');

    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    dragOver(zone, transfer);
    expect(transfer.dropEffect).toBe('link');
    fireEvent.drop(zone, { dataTransfer: transfer });

    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0]?.target?.kind).toBe('time_block');
    expect(seen[0]?.params).toEqual({ startsAt: '2026-08-02T09:00:00Z' });
  });

  it('refuses a target that cannot take this object, and mutates nothing on release', async () => {
    // A target that lights up green and then does nothing is worse than one that refuses.
    const seen: ActionContext[] = [];
    render(<Board registry={dropRegistry(seen)} />);
    const transfer = startDrag(screen.getByTestId('task'));
    const zone = screen.getByTestId('foreign-project');

    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    await waitFor(() => {
      expect(zone).toHaveAttribute('data-drop-state', 'reject');
    });
    const over = dragOver(zone, transfer);
    expect(over.defaultPrevented).toBe(false);
    expect(transfer.dropEffect).toBe('none');
    expect(zone.className).toContain('cursor-no-drop');

    fireEvent.drop(zone, { dataTransfer: transfer });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(seen).toHaveLength(0);
  });

  it('refuses an object of a kind it does not accept', async () => {
    const seen: ActionContext[] = [];
    render(<Board registry={dropRegistry(seen)} />);
    const transfer = fakeDataTransfer();
    writeObjectPayload(transfer, project);
    const zone = screen.getByTestId('time-block');

    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    const over = dragOver(zone, transfer);
    expect(over.defaultPrevented).toBe(false);
    fireEvent.drop(zone, { dataTransfer: transfer });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(seen).toHaveLength(0);
  });

  it('returns to idle once the pointer leaves', async () => {
    render(<Board registry={dropRegistry([])} />);
    const transfer = startDrag(screen.getByTestId('task'));
    const zone = screen.getByTestId('project');
    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    await waitFor(() => {
      expect(zone).toHaveAttribute('data-drop-state', 'accept');
    });
    fireEvent.dragLeave(zone, { dataTransfer: transfer });
    await waitFor(() => {
      expect(zone).toHaveAttribute('data-drop-state', 'idle');
    });
  });
});
