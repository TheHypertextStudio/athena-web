/**
 * Shared fixtures for the interaction-contract tests.
 *
 * @remarks
 * Two things every test here needs and neither jsdom nor the app provides: a `DataTransfer`
 * stand-in (jsdom implements none, so a drag cannot otherwise be simulated at all) and a minimal
 * list surface that exercises the row bindings exactly the way a real surface is expected to.
 *
 * The list is deliberately built the way the contract documents — an `<a href>` for navigation, a
 * checkbox for pointing, `objectTargetProps` on the row root — so that if the documented pattern
 * stops working the tests fail rather than passing against a bespoke arrangement.
 */
import type { JSX } from 'react';

import { objectTargetProps, type ObjectRef } from '../../src/lib/actions/object';
import { useDraggable } from '../../src/components/dnd/use-draggable';
import {
  SelectionCheckbox,
  SelectAllCheckbox,
} from '../../src/components/selection/selection-checkbox';
import {
  useSelectableRow,
  useSelection,
  useSelectionContainerRef,
} from '../../src/components/selection/selection-context';

/** A stand-in for the `DataTransfer` jsdom does not implement. */
export class FakeDataTransfer {
  private readonly store = new Map<string, string>();
  /** The effect the source permits. */
  effectAllowed = 'uninitialized';
  /** The effect the current target has claimed. */
  dropEffect = 'none';

  /** Every MIME type currently written. */
  get types(): readonly string[] {
    return [...this.store.keys()];
  }

  /** Write one MIME entry. */
  setData(type: string, value: string): void {
    this.store.set(type, value);
  }

  /** Read one MIME entry; returns `''` when absent, like the platform. */
  getData(type: string): string {
    return this.store.get(type) ?? '';
  }
}

/** Build a `DataTransfer`-shaped object the React synthetic event will accept. */
export function fakeDataTransfer(): DataTransfer {
  return new FakeDataTransfer() as unknown as DataTransfer;
}

/** A task reference with sensible defaults. */
export function taskRef(id: string, overrides: Partial<ObjectRef> = {}): ObjectRef {
  return {
    kind: 'task',
    id,
    organizationId: 'org1',
    title: `Task ${id}`,
    ...overrides,
  };
}

/** Props for {@link TaskList}. */
export interface TaskListProps {
  /** The rows to render. */
  readonly items: readonly ObjectRef[];
  /** Whether rows are draggable. */
  readonly draggable?: boolean;
}

/**
 * A minimal list surface built exactly as the interaction contract documents.
 *
 * @param props - The rows to render.
 * @returns The list element.
 */
export function TaskList({ items, draggable = false }: TaskListProps): JSX.Element {
  const { containerProps, count } = useSelection();
  const containerRef = useSelectionContainerRef();
  return (
    <div>
      <div data-testid="selection-count">{count}</div>
      <SelectAllCheckbox />
      <div role="grid" ref={containerRef} {...containerProps}>
        {items.map((item) => (
          <TaskRow key={item.id} object={item} draggable={draggable} />
        ))}
      </div>
    </div>
  );
}

/** One row of {@link TaskList}. */
function TaskRow({
  object,
  draggable,
}: {
  readonly object: ObjectRef;
  readonly draggable: boolean;
}): JSX.Element {
  const { rowProps, selected } = useSelectableRow(object);
  const drag = useDraggable({ object, disabled: !draggable });
  return (
    <div
      role="row"
      data-testid={`row-${object.id}`}
      {...objectTargetProps(object)}
      {...rowProps}
      {...(draggable ? drag : {})}
      className={drag.className}
      data-row-selected={selected}
    >
      <SelectionCheckbox object={object} />
      <a href={`/tasks/${object.id}`}>{object.title}</a>
    </div>
  );
}
