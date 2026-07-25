/**
 * `entity-drag` — the one typed payload every core object writes when it is dragged.
 *
 * @remarks
 * Docket's core objects (initiatives, programs, projects, tasks, cycles, teams) are draggable from
 * anywhere in their bounds, and a drop target — not the row — decides what a drop *means*. The
 * calendar reads a drag and schedules it; an initiative row reads the same drag and re-parents it;
 * a cycle reads it and assigns it. That inversion is the point: adding a new drop target requires
 * no change to any row, because every row already publishes the same self-describing object.
 *
 * This module owns the vocabulary. `@docket/ui`'s `dragSourceProps` owns the mechanics (the
 * `draggable` attribute, selection suppression, the grabbing cursor) and knows nothing about
 * Docket's object model — so the design system stays domain-free.
 *
 * **Compatibility.** Two hand-rolled payloads predate this one: the scheduling object read by the
 * calendar and scheduling canvas, and the initiative object read by the hierarchy treegrid. A
 * canonical write *also* mirrors those legacy payloads onto the same drag, so every existing drop
 * target keeps working untouched while rows migrate. The mirrors come out once every target reads
 * {@link readEntityDragObject}.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API} for the
 * underlying `dataTransfer` contract.
 */
import type { DragSource } from '@docket/ui/lib/draggable';

import { writeInitiativeDragObject } from '@/components/initiatives/hierarchy-dnd';
import { writeScheduleDragObject } from '@/components/scheduling/scheduling-drag-object';

/** The data-transfer type carrying a Docket core object. */
export const ENTITY_DRAG_MIME = 'application/x-docket-entity';

/** The fields every dragged core object carries, whatever its kind. */
interface EntityDragBase {
  /** Stable object id. */
  readonly id: string;
  /** The workspace the object belongs to — drop targets use it to reject cross-workspace moves. */
  readonly organizationId: string;
  /** Human-readable label, also written as `text/plain` for drags leaving the app. */
  readonly title: string;
}

/**
 * A core object in flight.
 *
 * @remarks
 * Discriminated on `kind` so a drop target can accept exactly the kinds it understands and narrow
 * to the extra context that kind carries. Initiatives carry their parent edge because re-parenting
 * needs to know which link to move; the other kinds need nothing beyond the base fields today.
 */
export type EntityDragItem =
  | (EntityDragBase & {
      readonly kind: 'initiative';
      /** The row's current parent, or null at the root. */
      readonly parentInitiativeId: string | null;
      /** The hierarchy edge tying the row to its parent, or null at the root. */
      readonly parentLinkId: string | null;
    })
  | (EntityDragBase & { readonly kind: 'program' })
  | (EntityDragBase & { readonly kind: 'project' })
  | (EntityDragBase & { readonly kind: 'task' })
  | (EntityDragBase & { readonly kind: 'cycle' })
  | (EntityDragBase & { readonly kind: 'team' });

/** Every kind {@link readEntityDragObject} will accept. */
const ENTITY_DRAG_KINDS = [
  'initiative',
  'program',
  'project',
  'task',
  'cycle',
  'team',
] as const satisfies readonly EntityDragItem['kind'][];

/**
 * Write a core object onto a native drag event, plus the legacy payloads it supersedes.
 *
 * @param transfer - The drag event's `dataTransfer`.
 * @param item - The object being dragged.
 *
 * @example
 * ```tsx
 * onDragStart={(event) => writeEntityDragObject(event.dataTransfer, { kind: 'project', ...p })}
 * ```
 */
export function writeEntityDragObject(transfer: DataTransfer, item: EntityDragItem): void {
  transfer.setData(ENTITY_DRAG_MIME, JSON.stringify(item));
  transfer.setData('text/plain', item.title);

  // Legacy mirrors — see the module remarks. These write their own `effectAllowed`, so the
  // canonical value is set afterward and wins.
  if (item.kind === 'task') {
    writeScheduleDragObject(transfer, {
      kind: 'task',
      taskId: item.id,
      organizationId: item.organizationId,
      title: item.title,
    });
  } else if (item.kind === 'initiative') {
    writeInitiativeDragObject(transfer, {
      id: item.id,
      parentInitiativeId: item.parentInitiativeId,
      parentLinkId: item.parentLinkId,
    });
  }

  // A universal source permits every drop effect; each target narrows it via `dropEffect`
  // (the treegrid moves, the calendar links).
  transfer.effectAllowed = 'all';
}

/**
 * Parse a core object from a drag, returning null for anything this app did not write.
 *
 * @remarks
 * Defensive by construction: unknown kinds, missing fields, and malformed JSON from a foreign drag
 * all read as null rather than throwing into a `dragover` handler.
 *
 * @param transfer - The drag event's `dataTransfer`.
 * @returns The dragged object, or null when the drag carries no Docket object.
 */
export function readEntityDragObject(transfer: DataTransfer): EntityDragItem | null {
  const raw = transfer.getData(ENTITY_DRAG_MIME);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as Record<string, unknown>;
    const kind = candidate['kind'];
    const id = candidate['id'];
    const organizationId = candidate['organizationId'];
    const title = candidate['title'];
    if (
      typeof kind !== 'string' ||
      !(ENTITY_DRAG_KINDS as readonly string[]).includes(kind) ||
      typeof id !== 'string' ||
      typeof organizationId !== 'string' ||
      typeof title !== 'string'
    ) {
      return null;
    }
    if (kind === 'initiative') {
      return {
        kind,
        id,
        organizationId,
        title,
        parentInitiativeId:
          typeof candidate['parentInitiativeId'] === 'string'
            ? candidate['parentInitiativeId']
            : null,
        parentLinkId:
          typeof candidate['parentLinkId'] === 'string' ? candidate['parentLinkId'] : null,
      };
    }
    return { kind, id, organizationId, title } as EntityDragItem;
  } catch {
    return null;
  }
}

/** Options for {@link entityDragSource}. */
export interface EntityDragSourceOptions {
  /** Whether the viewer may drag this row; defaults to true. */
  readonly enabled?: boolean;
  /** Run once the gesture ends, to clear drag-local UI state. */
  readonly onDragEnd?: () => void;
  /** Run as the gesture starts, after the payload is written (e.g. to mark the row in-flight). */
  readonly onDragStart?: () => void;
}

/**
 * Build the drag source for a core object — the value every row spreads onto its root.
 *
 * @param item - The object the row represents.
 * @param options - Optional gating and lifecycle hooks.
 * @returns A {@link DragSource} for `@docket/ui`'s `dragSourceProps`.
 *
 * @example
 * ```tsx
 * <EntityListRow drag={entityDragSource({ kind: 'program', id, organizationId, title })} … />
 * ```
 */
export function entityDragSource(
  item: EntityDragItem,
  options: EntityDragSourceOptions = {},
): DragSource {
  return {
    enabled: options.enabled ?? true,
    onDragStart: (event) => {
      writeEntityDragObject(event.dataTransfer, item);
      options.onDragStart?.();
    },
    ...(options.onDragEnd ? { onDragEnd: () => options.onDragEnd?.() } : {}),
  };
}
