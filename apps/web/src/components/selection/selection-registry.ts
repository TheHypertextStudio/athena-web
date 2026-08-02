/**
 * `components/selection/selection-registry` — how a global handler finds a list's selection.
 *
 * @remarks
 * The app's single right-click handler lives at the document, above every surface, and must answer
 * a question only a surface can answer: *is the object I was just right-clicked on part of a
 * larger selection?* Right-clicking one of five selected tasks has to offer "Move 5 tasks…", not
 * "Move this task…", or multi-select is a lie the moment a menu opens.
 *
 * React context cannot carry that answer upward, so surfaces publish a read function into this
 * small module-level registry keyed by the same id they stamp onto their DOM container as
 * `data-selection-surface`. The handler walks up from the right-clicked element, reads the id off
 * the container, and asks. No provider ordering, no imports between the two, and it is trivially
 * testable.
 *
 * Registration is scoped to a mounted surface: unmounting removes it, so a stale reader can never
 * answer for a list that is gone.
 */
import type { ObjectRef } from '@/lib/actions/object';

/** What a selection surface reports about itself on demand. */
export interface SelectionSurfaceSnapshot {
  /** The surface's id, matching its `data-selection-surface` attribute. */
  readonly surfaceId: string;
  /** The workspace the surface's items belong to, or `null` when it spans workspaces. */
  readonly organizationId: string | null;
  /** The currently selected objects, in view order. */
  readonly selectedObjects: readonly ObjectRef[];
}

/** The DOM attribute a selection surface stamps onto its container. */
export const SELECTION_SURFACE_ATTRIBUTE = 'data-selection-surface';

/** The CSS selector matching any selection surface container. */
export const SELECTION_SURFACE_SELECTOR = '[data-selection-surface]';

/** Mounted surfaces, by id. */
const surfaces = new Map<string, () => SelectionSurfaceSnapshot>();

/**
 * Publish a surface's selection so global handlers can read it.
 *
 * @param surfaceId - The surface's id; must match its container's `data-selection-surface`.
 * @param read - Returns the surface's current selection. Called on demand, never cached.
 * @returns A function that withdraws the registration.
 */
export function registerSelectionSurface(
  surfaceId: string,
  read: () => SelectionSurfaceSnapshot,
): () => void {
  surfaces.set(surfaceId, read);
  return () => {
    if (surfaces.get(surfaceId) === read) surfaces.delete(surfaceId);
  };
}

/**
 * Read a mounted surface's current selection.
 *
 * @param surfaceId - The surface to ask, or `null`/`undefined` when the element had no surface.
 * @returns The snapshot, or `null` when no such surface is mounted.
 */
export function readSelectionSurface(
  surfaceId: string | null | undefined,
): SelectionSurfaceSnapshot | null {
  if (surfaceId === null || surfaceId === undefined) return null;
  return surfaces.get(surfaceId)?.() ?? null;
}

/**
 * Read the selection of the surface containing an element.
 *
 * @param element - Any element inside (or being) a selection surface.
 * @returns The containing surface's snapshot, or `null` when the element is not in one.
 */
export function readSelectionSurfaceFor(element: Element | null): SelectionSurfaceSnapshot | null {
  const container = element?.closest(SELECTION_SURFACE_SELECTOR) ?? null;
  if (container === null || !(container instanceof HTMLElement)) return null;
  return readSelectionSurface(container.dataset['selectionSurface']);
}
