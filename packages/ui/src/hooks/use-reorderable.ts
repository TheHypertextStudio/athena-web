'use client';

/**
 * `@docket/ui/hooks` — reorder a bucket of rows by dragging or by keyboard.
 *
 * @remarks
 * ## Headless on purpose
 *
 * The hook owns the *mechanics* of a reorder — which row is in flight, which edge of which row the
 * pointer is over, what index a drop lands on, and what a screen reader hears — and hands back two
 * prop bags the caller spreads onto its own markup. Rendering stays with the surface: a status row
 * in settings, a lane in a board, and a section in a picker all look different, and the design
 * system describes the interaction rather than the row.
 *
 * The caller supplies one bucket's ids in their current display order, renders the insertion line
 * from `data-drop-edge` (a `::before` / `::after` pseudo-element on the row), and renders
 * {@link ReorderableBinding.liveMessage} into an `aria-live="polite"` region.
 *
 * ## Why this is its own primitive
 *
 * `apps/web/src/components/dnd/` already carries a drag contract, and this deliberately does not
 * build on it. That contract is *object-centric*: a drag is an object reference of a registered
 * kind, and a drop dispatches a registered action, expressly so that no data-mutating capability
 * exists as a mouse gesture alone — "a pointer gesture has no keyboard equivalent", so routing
 * drops through the action registry hands the same capability to the palette, the right-click
 * menu, and the keyboard for free.
 *
 * A row in a reorderable bucket is frequently not a Docket object at all — a workspace status is a
 * setting, with no object kind and no place in the registry — and its order is local to the list
 * it lives in. What it does share is the principle: the keyboard path below is a first-class way
 * to perform the move, not a courtesy. Every reorder this hook can perform with a pointer, it can
 * also perform from the grip with the keyboard alone.
 *
 * ## Pointer model
 *
 * Native HTML5 drag events, because this repository has no drag-and-drop library and gains one
 * only by taking on a dependency it has so far done without. On `dragover` the pointer's `clientY`
 * is compared against the row's midpoint, and the resulting edge is published as
 * `data-drop-edge="above" | "below"` so the CSS can draw the line.
 *
 * ## Keyboard model
 *
 * The grip is a toggle button: Space or Enter grabs the row, ArrowUp / ArrowDown move it one slot
 * at a time, Space or Enter drops it, and Escape abandons the move. Alt+ArrowUp / Alt+ArrowDown
 * move a row one slot with no grab step, for someone who knows where the row is going.
 *
 * While a row is grabbed the moves are *pending* — the hook tracks the target index and announces
 * it, and calls `onReorder` once, at the drop. That is what lets Escape restore the original order
 * without a second write: the cancelled move never reached the caller's data. Nothing here moves
 * focus, so the grip keeps it through the whole gesture, and every key the hook acts on is
 * `preventDefault`ed so the page does not scroll out from under the row.
 */
import * as React from 'react';

import { DRAGGABLE } from '../lib/draggable';

/** Which side of the row being hovered a drop would land on. */
export type DropEdge = 'above' | 'below';

/** Options for {@link useReorderable}. */
export interface UseReorderableOptions {
  /**
   * One bucket's item ids, in their current display order.
   *
   * @remarks
   * One bucket, never a whole grouped list: an index only means something within the set of rows
   * the user can actually shuffle. A surface with several buckets calls the hook once per bucket.
   */
  readonly itemIds: readonly string[];
  /**
   * Commit a move: `id` belongs at `toIndex` in the bucket's new order.
   *
   * @remarks
   * The index is the item's destination *after* it leaves its old slot, which is the form a
   * splice-and-insert (and Docket's ordering endpoints) want. Called once per completed move, and
   * never for a move that would leave the item where it already is.
   */
  readonly onReorder: (id: string, toIndex: number) => void;
  /**
   * Name an item for a screen reader, e.g. `(id) => statusById[id].name`.
   *
   * @remarks
   * Announcements are useless without it: "moved to position 3 of 5" says nothing about *what*
   * moved when several grips sit on one screen.
   */
  readonly describeItem: (id: string) => string;
  /** Suppress reordering entirely, e.g. for a viewer without permission to change the order. */
  readonly disabled?: boolean | undefined;
}

/**
 * The props a reorderable row spreads onto its root element.
 *
 * @remarks
 * Every field is optional because a disabled binding contributes nothing at all — the row spreads
 * an empty bag and keeps its normal text-selection and pointer behavior. `className` carries
 * {@link DRAGGABLE} and must be merged with the row's own classes through `cn`.
 */
export interface ReorderableItemProps {
  readonly draggable?: boolean;
  readonly className?: string;
  readonly onDragStart?: (event: React.DragEvent) => void;
  readonly onDragOver?: (event: React.DragEvent) => void;
  readonly onDragLeave?: (event: React.DragEvent) => void;
  readonly onDrop?: (event: React.DragEvent) => void;
  readonly onDragEnd?: (event: React.DragEvent) => void;
  /** The edge a drop would land on, present only on the row currently hovered. */
  readonly 'data-drop-edge'?: DropEdge;
  /** Present on the row in flight under the pointer, for the lifted treatment. */
  readonly 'data-dragging'?: true;
  /** Present on the row held by the keyboard, for the same treatment. */
  readonly 'data-grabbed'?: true;
}

/**
 * The props a row's grip spreads onto its button.
 *
 * @remarks
 * Designed to spread straight onto {@link DragHandle}. `aria-pressed` is the whole state model the
 * assistive layer needs: pressed means the row is held and the arrow keys will move it.
 */
export interface ReorderableHandleProps {
  readonly type: 'button';
  readonly 'aria-label': string;
  readonly 'aria-pressed': boolean;
  readonly disabled?: boolean;
  readonly onKeyDown?: (event: React.KeyboardEvent) => void;
  readonly onClick?: (event: React.MouseEvent) => void;
}

/** What {@link useReorderable} hands back to a surface. */
export interface ReorderableBinding {
  /** Props for the row root that carries the item. */
  readonly itemProps: (id: string) => ReorderableItemProps;
  /** Props for that row's grip. */
  readonly handleProps: (id: string) => ReorderableHandleProps;
  /** The item being dragged with the pointer, or `null` when no drag is in flight. */
  readonly draggingId: string | null;
  /** The latest announcement; render it into an `aria-live="polite"` region. */
  readonly liveMessage: string;
}

/** The row held by the keyboard, its origin, and where it currently sits. */
interface Grab {
  readonly id: string;
  readonly fromIndex: number;
  readonly toIndex: number;
}

/** The row the pointer is over, and which of its edges is live. */
interface DropTarget {
  readonly id: string;
  readonly edge: DropEdge;
}

/**
 * The MIME type a reorder drag writes, so a drop target elsewhere can tell what is in the air.
 *
 * @remarks
 * Firefox refuses to start a native drag whose `dataTransfer` carries nothing, so the payload is
 * written even though the hook reads the dragged id from its own state rather than from the event
 * (browsers hide drag data until the drop, so `dragover` could not read it anyway).
 */
export const REORDER_DRAG_MIME = 'application/x-docket-reorder';

/**
 * Where an item lands when it is dropped on an edge of another row.
 *
 * @remarks
 * Exported on its own because this is the one piece of a drag that is pure arithmetic, and index
 * arithmetic is where reorder bugs live. The subtraction is the whole subtlety: dropping *below*
 * row `n` means "insert at `n + 1`", but an item travelling downward has already vacated a slot
 * above that point, so every index after its old home shifts back by one.
 *
 * @param fromIndex - The item's current index in the bucket.
 * @param overIndex - The index of the row the pointer is over.
 * @param edge - Which edge of that row the pointer is nearer.
 * @returns The item's destination index in the bucket's new order.
 *
 * @example
 * ```ts
 * // ['a', 'b', 'c', 'd'] — drop 'a' below 'c'
 * computeDropIndex(0, 2, 'below'); // 2 → ['b', 'c', 'a', 'd']
 * ```
 */
export function computeDropIndex(fromIndex: number, overIndex: number, edge: DropEdge): number {
  const insertAt = edge === 'below' ? overIndex + 1 : overIndex;
  return fromIndex < insertAt ? insertAt - 1 : insertAt;
}

/**
 * The event's `dataTransfer`, as the optional thing it really is.
 *
 * @remarks
 * The DOM type promises a `DataTransfer` on every drag event, and a synthetically dispatched one
 * (jsdom, some automation harnesses) carries none. Reading it through a widening helper keeps the
 * guard at the call site honest rather than making it look like dead code.
 */
function dragTransfer(event: React.DragEvent): DataTransfer | undefined {
  return (event as { dataTransfer?: DataTransfer }).dataTransfer;
}

/** Which edge of the hovered row the pointer is nearer, from the row's own box. */
function edgeFromPointer(event: React.DragEvent): DropEdge {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
}

/** Keep an index inside the bucket. */
function clampIndex(index: number, total: number): number {
  if (index < 0) return 0;
  if (index > total - 1) return total - 1;
  return index;
}

/** Announce that a row is now held and the arrow keys will move it. */
function grabbedMessage(name: string, position: number, total: number): string {
  return `${name} grabbed, position ${position} of ${total}. Use the arrow keys to move it, then press Enter to drop it.`;
}

/** Announce where a row sits mid-move. */
function positionMessage(name: string, position: number, total: number): string {
  return `${name}, position ${position} of ${total}.`;
}

/** Announce a committed move. */
function droppedMessage(name: string, position: number, total: number): string {
  return `${name} dropped at position ${position} of ${total}.`;
}

/** Announce an abandoned move. */
function canceledMessage(name: string, position: number, total: number): string {
  return `${name} back at position ${position} of ${total}.`;
}

/**
 * Make one bucket of rows reorderable by pointer and by keyboard.
 *
 * @param options - The bucket's order, the commit callback, and how to name a row aloud.
 * @returns Prop bags for each row and grip, the id in flight, and the latest announcement.
 *
 * @example
 * ```tsx
 * const { itemProps, handleProps, liveMessage } = useReorderable({
 *   itemIds: statuses.map((s) => s.id),
 *   onReorder: (id, toIndex) => moveStatus.mutate({ id, toIndex }),
 *   describeItem: (id) => nameById[id] ?? id,
 * });
 *
 * <ul>
 *   {statuses.map((status) => (
 *     <li key={status.id} {...itemProps(status.id)} className={cn(ROW, itemProps(status.id).className)}>
 *       <DragHandle {...handleProps(status.id)} />
 *       {status.name}
 *     </li>
 *   ))}
 * </ul>
 * <p aria-live="polite" className="sr-only">{liveMessage}</p>
 * ```
 *
 * @see {@link computeDropIndex} for the index arithmetic a drop resolves to.
 * @see {@link DragHandle} for the grip these `handleProps` are shaped for.
 */
export function useReorderable({
  itemIds,
  onReorder,
  describeItem,
  disabled = false,
}: UseReorderableOptions): ReorderableBinding {
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null);
  const [grab, setGrab] = React.useState<Grab | null>(null);
  const [liveMessage, setLiveMessage] = React.useState('');
  const total = itemIds.length;

  const endPointerDrag = React.useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const commitMove = React.useCallback(
    (id: string, fromIndex: number, toIndex: number) => {
      if (toIndex === fromIndex) return;
      onReorder(id, toIndex);
    },
    [onReorder],
  );

  const itemProps = React.useCallback(
    (id: string): ReorderableItemProps => {
      if (disabled) return {};
      const edge = dropTarget?.id === id ? dropTarget.edge : undefined;
      return {
        draggable: true,
        className: DRAGGABLE,
        onDragStart: (event) => {
          const transfer = dragTransfer(event);
          if (transfer) {
            transfer.effectAllowed = 'move';
            transfer.setData(REORDER_DRAG_MIME, id);
          }
          setDraggingId(id);
          setDropTarget(null);
        },
        onDragOver: (event) => {
          // Only this bucket's own rows are accepted. A drag that started somewhere else — another
          // bucket, another window, an entity drag — is left un-`preventDefault`ed, so the row
          // never lights up for something it cannot take.
          if (draggingId === null || draggingId === id) return;
          event.preventDefault();
          const next = edgeFromPointer(event);
          setDropTarget((current) =>
            current?.id === id && current.edge === next ? current : { id, edge: next },
          );
        },
        onDragLeave: () => {
          setDropTarget((current) => (current?.id === id ? null : current));
        },
        onDrop: (event) => {
          if (draggingId === null) return;
          event.preventDefault();
          const fromIndex = itemIds.indexOf(draggingId);
          const overIndex = itemIds.indexOf(id);
          if (fromIndex >= 0 && overIndex >= 0) {
            const dropEdge = dropTarget?.id === id ? dropTarget.edge : edgeFromPointer(event);
            const toIndex = computeDropIndex(fromIndex, overIndex, dropEdge);
            if (toIndex !== fromIndex) {
              commitMove(draggingId, fromIndex, toIndex);
              setLiveMessage(droppedMessage(describeItem(draggingId), toIndex + 1, total));
            }
          }
          endPointerDrag();
        },
        onDragEnd: endPointerDrag,
        ...(edge ? { 'data-drop-edge': edge } : {}),
        ...(draggingId === id ? { 'data-dragging': true as const } : {}),
        ...(grab?.id === id ? { 'data-grabbed': true as const } : {}),
      };
    },
    [
      commitMove,
      describeItem,
      disabled,
      draggingId,
      dropTarget,
      endPointerDrag,
      grab,
      itemIds,
      total,
    ],
  );

  const beginGrab = React.useCallback(
    (id: string, index: number) => {
      setGrab({ id, fromIndex: index, toIndex: index });
      setLiveMessage(grabbedMessage(describeItem(id), index + 1, total));
    },
    [describeItem, total],
  );

  const moveGrab = React.useCallback(
    (current: Grab, delta: number) => {
      const next = clampIndex(current.toIndex + delta, total);
      setGrab({ ...current, toIndex: next });
      setLiveMessage(positionMessage(describeItem(current.id), next + 1, total));
    },
    [describeItem, total],
  );

  const dropGrab = React.useCallback(
    (current: Grab) => {
      commitMove(current.id, current.fromIndex, current.toIndex);
      setGrab(null);
      setLiveMessage(droppedMessage(describeItem(current.id), current.toIndex + 1, total));
    },
    [commitMove, describeItem, total],
  );

  const cancelGrab = React.useCallback(
    (current: Grab) => {
      setGrab(null);
      setLiveMessage(canceledMessage(describeItem(current.id), current.fromIndex + 1, total));
    },
    [describeItem, total],
  );

  const moveDirect = React.useCallback(
    (id: string, index: number, delta: number) => {
      const next = clampIndex(index + delta, total);
      if (next === index) return;
      onReorder(id, next);
      setLiveMessage(positionMessage(describeItem(id), next + 1, total));
    },
    [describeItem, onReorder, total],
  );

  const handleProps = React.useCallback(
    (id: string): ReorderableHandleProps => {
      const label = `Reorder ${describeItem(id)}`;
      if (disabled) {
        return { type: 'button', 'aria-label': label, 'aria-pressed': false, disabled: true };
      }
      const held = grab?.id === id ? grab : null;
      const index = itemIds.indexOf(id);
      const toggle = (): void => {
        if (held) {
          dropGrab(held);
          return;
        }
        beginGrab(id, index);
      };
      return {
        type: 'button',
        'aria-label': label,
        'aria-pressed': held !== null,
        onKeyDown: (event) => {
          if (index < 0) return;
          switch (event.key) {
            case ' ':
            case 'Enter': {
              event.preventDefault();
              toggle();
              return;
            }
            case 'Escape': {
              if (!held) return;
              event.preventDefault();
              cancelGrab(held);
              return;
            }
            case 'ArrowUp':
            case 'ArrowDown': {
              const delta = event.key === 'ArrowUp' ? -1 : 1;
              if (held) {
                event.preventDefault();
                moveGrab(held, delta);
                return;
              }
              if (event.altKey) {
                event.preventDefault();
                moveDirect(id, index, delta);
              }
              return;
            }
            default:
              return;
          }
        },
        onClick: (event) => {
          // A keyboard activation arrives twice: once as the keydown handled above, and once as
          // the click the browser synthesizes from it (`detail === 0`). Only pointer presses get
          // past here, so a grab never toggles itself back off.
          if (event.detail === 0 || index < 0) return;
          toggle();
        },
      };
    },
    [beginGrab, cancelGrab, describeItem, disabled, dropGrab, grab, itemIds, moveDirect, moveGrab],
  );

  return { itemProps, handleProps, draggingId, liveMessage };
}
