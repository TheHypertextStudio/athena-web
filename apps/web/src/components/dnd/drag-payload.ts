/**
 * `components/dnd/drag-payload` — what a Docket object writes onto a native drag.
 *
 * @remarks
 * One MIME type carries one {@link ObjectRef}, so a drop target never has to know which surface
 * the drag started from. That inversion is the point of the whole drag contract: the calendar
 * accepts a task and schedules it, a project row accepts a task and adopts it, and neither one
 * imports the other — both just read the object in flight.
 *
 * **Why this exists alongside `@/lib/entity-drag`.** `entity-drag` shipped first and covers the
 * six *work* kinds (initiative, program, project, task, cycle, team). It has no vocabulary for
 * calendar events or time blocks, which is exactly the gap that makes "drag a task into a time
 * block" and "associate a project with a calendar event" impossible to express. Rather than fork,
 * this module writes the fuller object payload *and* mirrors the legacy one for every kind
 * `entity-drag` understands, so the drop targets already reading it keep working untouched while
 * surfaces migrate.
 *
 * **Reading during `dragover` is not possible.** Browsers put the drag data in protected mode
 * until the drop, so `getData` returns `''` on `dragenter`/`dragover` — only `dataTransfer.types`
 * is readable. That is why {@link hasObjectPayload} exists and why the in-flight object is also
 * tracked in React state by {@link ./drag-context}: a target has to decide whether it accepts the
 * drag *before* it can read it.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer} for the protected-mode
 * rules this module works within.
 */
import { type EntityDragItem, writeEntityDragObject } from '@/lib/entity-drag';

import { isObjectKind, type ObjectMeta, type ObjectRef } from '@/lib/actions/object';

/** The data-transfer type carrying a full {@link ObjectRef}. */
export const OBJECT_DRAG_MIME = 'application/x-docket-object';
/** Versioned data-transfer type carrying an ordered multi-object drag. */
export const OBJECT_SET_DRAG_MIME = 'application/x-docket-object-set+json;version=1';

/** The kinds `@/lib/entity-drag` understands, and so the kinds worth mirroring for. */
const LEGACY_MIRROR_KINDS: readonly EntityDragItem['kind'][] = [
  'initiative',
  'program',
  'project',
  'task',
  'cycle',
  'team',
];

/**
 * Write an object onto a native drag.
 *
 * @remarks
 * Also writes `text/plain` (so a drag that leaves the app drops the object's title into whatever
 * received it) and, for the kinds that predate this payload, the legacy `entity-drag` mirror.
 * `effectAllowed` is set to `'all'`: the *source* permits everything and each target narrows it
 * with `dropEffect`, which is what lets the same drag mean "move" over the hierarchy and "link"
 * over the calendar.
 *
 * @param transfer - The drag event's `dataTransfer`.
 * @param object - The object being dragged.
 */
export function writeObjectPayload(transfer: DataTransfer, object: ObjectRef): void {
  transfer.setData(OBJECT_DRAG_MIME, JSON.stringify(object));
  transfer.setData('text/plain', object.title);

  if (
    object.organizationId !== null &&
    (LEGACY_MIRROR_KINDS as readonly string[]).includes(object.kind)
  ) {
    writeEntityDragObject(transfer, toLegacyItem(object, object.organizationId));
  }

  transfer.effectAllowed = 'all';
}

/** Write an ordered object selection while preserving every single-object compatibility flavor. */
export function writeObjectSetPayload(
  transfer: DataTransfer,
  objects: readonly ObjectRef[],
  primary: ObjectRef,
): void {
  writeObjectPayload(transfer, primary);
  transfer.setData(OBJECT_SET_DRAG_MIME, JSON.stringify({ version: 1, objects }));
}

/** Project an {@link ObjectRef} onto the legacy `entity-drag` shape. */
function toLegacyItem(object: ObjectRef, organizationId: string): EntityDragItem {
  const base = { id: object.id, organizationId, title: object.title };
  if (object.kind === 'initiative') {
    const parentInitiativeId = object.meta?.['parentInitiativeId'];
    const parentLinkId = object.meta?.['parentLinkId'];
    return {
      ...base,
      kind: 'initiative',
      parentInitiativeId: typeof parentInitiativeId === 'string' ? parentInitiativeId : null,
      parentLinkId: typeof parentLinkId === 'string' ? parentLinkId : null,
    };
  }
  return { ...base, kind: object.kind as Exclude<EntityDragItem['kind'], 'initiative'> };
}

/**
 * Whether a drag carries a Docket object at all.
 *
 * @remarks
 * The only question answerable during `dragenter`/`dragover`, where the payload itself is
 * unreadable. A target uses this to decide whether the drag is even ours before consulting
 * {@link ./drag-context.useDragState} for what it is.
 *
 * @param transfer - The drag event's `dataTransfer`.
 * @returns `true` when the drag was started by this app.
 */
export function hasObjectPayload(transfer: DataTransfer): boolean {
  return [...transfer.types].includes(OBJECT_DRAG_MIME);
}

/**
 * Read the object a drag carries.
 *
 * @remarks
 * Defensive by construction — a foreign drag, a truncated payload, or an unknown kind all read as
 * `null` rather than throwing inside a drop handler, because a thrown exception there leaves the
 * page in a half-dragged state with no way out.
 *
 * @param transfer - The drag event's `dataTransfer`, read during `drop`.
 * @returns The dragged object, or `null` when the drag carries none.
 */
export function readObjectPayload(transfer: DataTransfer): ObjectRef | null {
  const raw = transfer.getData(OBJECT_DRAG_MIME);
  if (raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    const kind = candidate['kind'];
    const id = candidate['id'];
    const title = candidate['title'];
    const organizationId = candidate['organizationId'];
    if (!isObjectKind(kind) || typeof id !== 'string' || id === '' || typeof title !== 'string') {
      return null;
    }
    const meta = candidate['meta'];
    return {
      kind,
      id,
      title,
      organizationId: typeof organizationId === 'string' ? organizationId : null,
      ...(typeof meta === 'object' && meta !== null && !Array.isArray(meta)
        ? { meta: meta as ObjectMeta }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Read an ordered object set, falling back to the legacy primary object when necessary. */
export function readObjectSetPayload(transfer: DataTransfer): readonly ObjectRef[] {
  const raw = transfer.getData(OBJECT_SET_DRAG_MIME);
  if (raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      const candidate = parsed as { version?: unknown; objects?: unknown };
      if (candidate.version === 1 && Array.isArray(candidate.objects)) {
        const objects = candidate.objects
          .map((object) => {
            const scratch = {
              getData: (type: string) => (type === OBJECT_DRAG_MIME ? JSON.stringify(object) : ''),
            } as DataTransfer;
            return readObjectPayload(scratch);
          })
          .filter((object): object is ObjectRef => object !== null);
        if (objects.length === candidate.objects.length) return objects;
      }
    } catch {
      // Fall through to the single-object compatibility payload.
    }
  }
  const primary = readObjectPayload(transfer);
  return primary === null ? [] : [primary];
}
