'use client';

/**
 * `components/dnd/drag-context` — what is currently in the air.
 *
 * @remarks
 * Native HTML5 drag hides its payload until the drop (protected mode), so a drop target cannot
 * read what it is being offered at the moment it must decide whether to accept it. Every drag-and-
 * drop implementation on the web solves this the same way: keep the in-flight object in
 * application state for the duration of the gesture. This is that state, held once for the app.
 *
 * It also publishes the drag on `<html data-dragging-kind="task">`, so a surface can reveal its
 * drop zones from CSS alone — no prop threading, no re-render per row. A calendar lane can light
 * up for a dragged task and stay inert for a dragged team without either side importing the other.
 *
 * The provider is intentionally not the drag *mechanism*: {@link ./use-draggable} starts and ends
 * gestures, {@link ./use-drop-target} consumes them. This only remembers.
 */
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { ObjectRef } from '@/lib/actions/object';

/** The drag currently in flight, if any. */
export interface DragState {
  /** The object being dragged, or `null` when nothing is. */
  readonly object: ObjectRef | null;
  /** Ordered objects carried by the gesture; first is the primary object. */
  readonly objects: readonly ObjectRef[];
  /** The selection surface the drag started from, when it started in one. */
  readonly sourceSurfaceId: string | null;
}

/** Imperative control over the in-flight drag, used by {@link ./use-draggable}. */
export interface DragController {
  /** Record the start of a gesture. */
  readonly begin: (
    object: ObjectRef,
    sourceSurfaceId: string | null,
    objects?: readonly ObjectRef[],
  ) => void;
  /** Record the end of a gesture, whether it dropped or was cancelled. */
  readonly end: () => void;
}

const IDLE: DragState = { object: null, objects: [], sourceSurfaceId: null };

const DragStateContext = createContext<DragState>(IDLE);
const DragControllerContext = createContext<DragController | null>(null);

/** Props for {@link DragProvider}. */
export interface DragProviderProps {
  /** The subtree whose drags and drop targets share this state. */
  readonly children: ReactNode;
}

/**
 * Track the app's in-flight drag.
 *
 * @remarks
 * Split into two contexts on purpose: the *controller* is stable for the provider's lifetime, so a
 * draggable row subscribing to it never re-renders, while only the handful of components that
 * genuinely care about what is in the air subscribe to the *state*.
 *
 * @param props - The subtree.
 * @returns The provider element.
 */
export function DragProvider({ children }: DragProviderProps): JSX.Element {
  const [state, setState] = useState<DragState>(IDLE);

  const controller = useMemo<DragController>(
    () => ({
      begin: (object, sourceSurfaceId, objects = [object]) => {
        setState({ object, objects, sourceSurfaceId });
      },
      end: () => {
        setState(IDLE);
      },
    }),
    [],
  );

  // Publish the drag on the document so surfaces can reveal drop zones from CSS alone.
  useEffect(() => {
    const root = document.documentElement;
    if (state.object === null) {
      delete root.dataset['draggingKind'];
      return;
    }
    root.dataset['draggingKind'] = state.object.kind;
    return () => {
      delete root.dataset['draggingKind'];
    };
  }, [state.object]);

  return (
    <DragControllerContext.Provider value={controller}>
      <DragStateContext.Provider value={state}>{children}</DragStateContext.Provider>
    </DragControllerContext.Provider>
  );
}

/**
 * What is currently being dragged.
 *
 * @remarks
 * Returns the idle state outside a {@link DragProvider} rather than throwing, so an isolated
 * component (a story, a unit test, a detail page rendered outside the shell) still renders.
 * Nothing here is required for correctness — a missing provider degrades to "no drag in flight",
 * which is what a surface with no drag machinery around it should believe.
 *
 * @returns The in-flight {@link DragState}.
 */
export function useDragState(): DragState {
  return useContext(DragStateContext);
}

/**
 * Control the in-flight drag record.
 *
 * @returns A {@link DragController}; a no-op controller outside a {@link DragProvider}.
 */
export function useDragController(): DragController {
  const controller = useContext(DragControllerContext);
  const fallbackBegin = useCallback(() => undefined, []);
  const fallbackEnd = useCallback(() => undefined, []);
  const fallback = useMemo<DragController>(
    () => ({ begin: fallbackBegin, end: fallbackEnd }),
    [fallbackBegin, fallbackEnd],
  );
  return controller ?? fallback;
}
