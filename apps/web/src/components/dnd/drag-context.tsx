'use client';

/**
 * `components/dnd/drag-context` — what is currently in the air.
 *
 * @remarks
 * Dnd Kit carries the canonical object identity in memory for the duration of the gesture. This
 * adapter exposes the same state to surfaces that only need to reveal contextual destinations.
 *
 * It also publishes the drag on `<html data-dragging-kind="task">`, so a surface can reveal its
 * drop zones from CSS alone — no prop threading, no re-render per row. A calendar lane can light
 * up for a dragged task and stay inert for a dragged team without either side importing the other.
 *
 * {@link ./use-draggable} starts gestures and {@link ./use-relation-drop-target} resolves them.
 */
import {
  DragDropProvider,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useDragOperation,
} from '@dnd-kit/react';
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

import { describeObject, type ObjectRef } from '@/lib/actions/object';

import { isObjectDragData } from './object-drag-data';
import { OBJECT_POINTER_SENSOR } from './object-pointer-sensor';

export { dragActivationProfile, type DragActivationProfile } from './object-pointer-sensor';

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
  /** Publish application-owned drag or relation feedback through the shared live region. */
  readonly announce: (message: string) => void;
}

const IDLE: DragState = { object: null, objects: [], sourceSurfaceId: null };

const DragStateContext = createContext<DragState>(IDLE);
const DragControllerContext = createContext<DragController | null>(null);

/** Read application-owned effect copy carried by a destination adapter. */
function targetEffectLabel(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('effectLabel' in data)) return null;
  const label = (data as { readonly effectLabel?: unknown }).effectLabel;
  return typeof label === 'string' ? label : null;
}

/** Render the one object overlay with the live resolved destination effect. */
function ObjectDragOverlay(): JSX.Element {
  const operation = useDragOperation();
  const effectLabel = targetEffectLabel(operation.target?.data);
  return (
    <DragOverlay className="pointer-events-none z-50" dropAnimation={null}>
      {(source) => {
        const data = source.data;
        if (!isObjectDragData(data)) return null;
        const Icon = describeObject(data.object.kind).icon;
        return (
          <div className="bg-surface-container-high text-on-surface ring-outline-variant/40 flex max-w-80 items-center gap-2 rounded-lg px-3 py-2 shadow-lg ring-1">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{data.object.title}</span>
              {effectLabel ? (
                <span className="text-on-surface-variant block truncate text-xs">
                  {effectLabel}
                </span>
              ) : null}
            </span>
          </div>
        );
      }}
    </DragOverlay>
  );
}

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
  const [announcement, setAnnouncement] = useState('');

  const controller = useMemo<DragController>(
    () => ({
      begin: (object, sourceSurfaceId, objects = [object]) => {
        setState({ object, objects, sourceSurfaceId });
      },
      end: () => {
        setState(IDLE);
      },
      announce: setAnnouncement,
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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.operation.source?.data;
    if (!isObjectDragData(data)) return;
    setState({
      object: data.object,
      objects: data.objects,
      sourceSurfaceId: data.sourceSurfaceId,
    });
    setAnnouncement(`Dragging ${data.object.title}`);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const label = targetEffectLabel(event.operation.target?.data);
    if (label !== null) setAnnouncement(label);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const label = targetEffectLabel(event.operation.target?.data);
    setAnnouncement(label === null ? 'Drag cancelled' : `Dropped: ${label}`);
    setState(IDLE);
  }, []);

  return (
    <DragControllerContext.Provider value={controller}>
      <DragStateContext.Provider value={state}>
        <DragDropProvider
          sensors={[OBJECT_POINTER_SENSOR]}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {children}
          <ObjectDragOverlay />
          <span className="sr-only" role="status" aria-live="polite">
            {announcement}
          </span>
        </DragDropProvider>
      </DragStateContext.Provider>
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
  const fallbackAnnounce = useCallback(() => undefined, []);
  const fallback = useMemo<DragController>(
    () => ({ begin: fallbackBegin, end: fallbackEnd, announce: fallbackAnnounce }),
    [fallbackAnnounce, fallbackBegin, fallbackEnd],
  );
  return controller ?? fallback;
}
