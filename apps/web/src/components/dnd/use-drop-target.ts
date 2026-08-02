'use client';

/**
 * `components/dnd/use-drop-target` — declare that something can be dropped on.
 *
 * @remarks
 * A drop target says three things and nothing else: which kinds it accepts, which registered
 * action a drop performs, and how to build that action's context from the dropped object. It never
 * mutates anything itself.
 *
 * **Why a drop must dispatch a registered action, not a callback.** A drag is a pointer gesture,
 * and a pointer gesture has no keyboard equivalent. If dropping a task on a project called a
 * bespoke `onDrop` handler, then "move this task to that project" would exist *only* as a mouse
 * gesture — unreachable by keyboard, absent from the command palette, absent from the right-click
 * menu. Routing every drop through {@link ActionId} means the same capability is automatically
 * available from all four, defined once. It is also what keeps the promise that no data-mutating
 * user gesture exists outside the registry.
 *
 * **Why acceptance is decided from state, not from the payload.** Browsers hide drag data until
 * the drop, so during `dragover` the payload is unreadable — see {@link ./drag-payload}. The hook
 * therefore asks {@link ./drag-context} what is in the air. A drag started in another window has
 * no such record, so it is refused rather than optimistically accepted and then failed on drop:
 * a target must never light up green for something it cannot actually take.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';

import { CURSOR_DROP_STATE } from '@/lib/actions/cursor';
import type { ObjectKind, ObjectRef } from '@/lib/actions/object';
import { useActionDispatch } from '@/lib/actions/registry-context';
import type { ActionContext, ActionId, ActionInvocationResult } from '@/lib/actions/types';

import { useDragState } from './drag-context';
import { readObjectPayload } from './drag-payload';

/** How the target visually and semantically relates to the drag hovering it. */
export type DropState = 'idle' | 'accept' | 'reject';

/** Options for {@link useDropTarget}. */
export interface UseDropTargetOptions {
  /**
   * Which objects this target takes.
   *
   * @remarks
   * A kind list for the common case ("this lane takes tasks"), or a predicate when acceptance
   * depends on the object ("this project row takes tasks from its own workspace only").
   */
  readonly accepts: readonly ObjectKind[] | ((object: ObjectRef) => boolean);
  /** The registered action a drop performs. */
  readonly action: ActionId;
  /**
   * Build the action's context from the dropped object — the call site's context injection.
   *
   * @remarks
   * Return `null` to refuse this particular object. Refusing here is how a target expresses a
   * constraint it can only evaluate against the object itself, and the refusal is honored during
   * `dragover` too, so the cursor is rejecting *before* the user lets go.
   *
   * Must be pure: it is consulted on every render while a drag hovers, not only on drop.
   */
  readonly resolveContext: (object: ObjectRef) => ActionContext | null;
  /**
   * The drag effect this target performs. Defaults to `'move'`.
   *
   * @remarks
   * Drives the platform's drop cursor and badge: `'move'` for re-parenting, `'link'` for creating
   * an association that leaves the original where it is, `'copy'` for duplication.
   */
  readonly effect?: 'move' | 'copy' | 'link';
  /** Turn the target off entirely (a read-only view, a busy state). */
  readonly disabled?: boolean;
  /** Observe the dropped action's outcome, e.g. to surface application-owned failure copy. */
  readonly onResult?: (result: ActionInvocationResult) => void;
}

/** The props {@link useDropTarget} contributes to an element. */
export interface DropTargetProps {
  /** Opens the hover state. */
  readonly onDragEnter: (event: ReactDragEvent) => void;
  /** Signals acceptance (or not) to the platform on every move. */
  readonly onDragOver: (event: ReactDragEvent) => void;
  /** Closes the hover state when the pointer genuinely leaves. */
  readonly onDragLeave: (event: ReactDragEvent) => void;
  /** Performs the drop by dispatching the registered action. */
  readonly onDrop: (event: ReactDragEvent) => void;
  /** `idle` | `accept` | `reject` — style hooks and the rejecting-cursor selector key off this. */
  readonly 'data-drop-state': DropState;
  /** The rejecting-cursor class; merge with the element's own via `cn`. */
  readonly className: string;
}

/** What {@link useDropTarget} returns. */
export interface DropTargetBinding {
  /** Props to spread onto the drop element. */
  readonly dropProps: DropTargetProps;
  /** Whether a drag is currently over this target. */
  readonly isOver: boolean;
  /** Whether the drag in flight would be accepted. `false` when nothing is in flight. */
  readonly canDrop: boolean;
  /** The combined state, for rendering an accepting or refusing treatment. */
  readonly dropState: DropState;
}

/** Evaluate the kind filter. */
function matchesAccepts(accepts: UseDropTargetOptions['accepts'], object: ObjectRef): boolean {
  return typeof accepts === 'function' ? accepts(object) : accepts.includes(object.kind);
}

/**
 * Declare an element as a drop target for core objects.
 *
 * @param options - What the target accepts and which action a drop performs.
 * @returns Props to spread, plus the live hover/acceptance state.
 *
 * @example
 * ```tsx
 * const drop = useDropTarget({
 *   accepts: ['task'],
 *   action: 'task.moveToProject',
 *   effect: 'move',
 *   resolveContext: (task) =>
 *     task.organizationId === project.organizationId
 *       ? {
 *           objects: [task],
 *           target: project,
 *           source: 'drag',
 *           organizationId: project.organizationId,
 *         }
 *       : null,
 * });
 *
 * <li {...drop.dropProps} className={cn('flex h-10 items-center', drop.dropProps.className)} />
 * ```
 */
export function useDropTarget(options: UseDropTargetOptions): DropTargetBinding {
  const { accepts, action, resolveContext, effect = 'move', disabled = false, onResult } = options;
  const dispatch = useActionDispatch();
  const dragged = useDragState().object;
  const [isOver, setIsOver] = useState(false);
  // `dragenter`/`dragleave` fire for every descendant the pointer crosses, so a naive boolean
  // flickers off the moment the pointer moves onto a child. Counting entries fixes it.
  const depth = useRef(0);

  const canDrop =
    !disabled &&
    dragged !== null &&
    matchesAccepts(accepts, dragged) &&
    resolveContext(dragged) !== null;

  const onDragEnter = useCallback(
    (event: ReactDragEvent) => {
      if (disabled) return;
      depth.current += 1;
      if (depth.current === 1) setIsOver(true);
      // Claiming the drag here (as well as in `dragover`) is what makes the very first frame after
      // entry show the right cursor rather than the platform's default refusal.
      if (canDrop) event.preventDefault();
    },
    [disabled, canDrop],
  );

  const onDragOver = useCallback(
    (event: ReactDragEvent) => {
      if (disabled) return;
      if (!canDrop) {
        // Not calling `preventDefault` is what tells the platform to refuse — and lets the event
        // bubble to an ancestor that may legitimately accept it.
        event.dataTransfer.dropEffect = 'none';
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = effect;
    },
    [disabled, canDrop, effect],
  );

  const onDragLeave = useCallback(() => {
    if (disabled) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setIsOver(false);
  }, [disabled]);

  const onDrop = useCallback(
    (event: ReactDragEvent) => {
      depth.current = 0;
      setIsOver(false);
      if (disabled) return;
      const object = readObjectPayload(event.dataTransfer);
      if (object === null || !matchesAccepts(accepts, object)) return;
      const context = resolveContext(object);
      if (context === null) return;
      event.preventDefault();
      void dispatch(action, () => context).then((result) => {
        onResult?.(result);
      });
    },
    [disabled, accepts, resolveContext, dispatch, action, onResult],
  );

  const dropState: DropState = !isOver ? 'idle' : canDrop ? 'accept' : 'reject';

  return useMemo<DropTargetBinding>(
    () => ({
      dropProps: {
        onDragEnter,
        onDragOver,
        onDragLeave,
        onDrop,
        'data-drop-state': dropState,
        className: CURSOR_DROP_STATE,
      },
      isOver,
      canDrop,
      dropState,
    }),
    [onDragEnter, onDragOver, onDragLeave, onDrop, dropState, isOver, canDrop],
  );
}
