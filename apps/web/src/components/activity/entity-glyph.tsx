/**
 * `activity` — the canonical entity glyph and type label.
 *
 * @remarks
 * Keyed on {@link CanonicalEntityKind} rather than on a provider, which is the point of the
 * canonical taxonomy: a Linear issue and a Docket task are both `work_item`, so they carry the
 * same glyph and the row does not have to know where the work lives.
 *
 * Extracted from the stream's episode header so the highlights row and the timeline cannot drift
 * into two different pictures of the same kind of thing.
 */
import type { CanonicalEntityKind } from '@docket/connections/event-contract';
import {
  Activity,
  Building,
  CalendarToday,
  FileText,
  FolderKanban,
  ListChecks,
  MessageSquare,
  Target,
  type LucideIcon,
} from '@docket/ui/icons';

/**
 * The quiet subject glyph for a canonical entity kind.
 *
 * @param kind - The canonical entity kind, or `null` for an event with no resolved subject.
 * @returns the icon component to render.
 */
export function entityGlyph(kind: CanonicalEntityKind | null): LucideIcon {
  switch (kind) {
    case 'work_item':
      return ListChecks;
    case 'project':
    case 'program':
      return FolderKanban;
    case 'initiative':
    case 'cycle':
      return Target;
    case 'calendar_event':
      return CalendarToday;
    case 'message':
    case 'thread':
      return MessageSquare;
    case 'document':
      return FileText;
    case 'organization':
      return Building;
    default:
      return Activity;
  }
}

/**
 * The human type label shown beneath a subject title.
 *
 * @remarks
 * Rendered through a `capitalize` class rather than pre-capitalized here, so the label stays one
 * derivation of the enum instead of a second hand-written map that can fall behind it.
 *
 * @param kind - The canonical entity kind, or `null`.
 * @returns the display label.
 */
export function entityTypeLabel(kind: CanonicalEntityKind | null): string {
  return kind ? kind.replaceAll('_', ' ') : 'Event';
}
