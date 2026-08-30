'use client';

/**
 * `entity-display/work-status` — the one presentation of a work status, whatever it is called.
 *
 * @remarks
 * Projects, Programs, and Initiatives each used to carry their own `STATUS_LABEL` record and their
 * own `statusGlyphType` switch over a fixed set of keys. That only worked while the keys were a
 * closed union. A workspace now names its own statuses, so a switch over `planned | active | …`
 * answers `unstarted` for every stage anyone renamed, and the label record answers `undefined`.
 *
 * The fix is to stop deriving presentation from the key at all. A status carries its own name and
 * its own {@link WorkStatusCategory}; the name is what a person reads, and the category is where
 * the glyph and its colour come from. So these take exactly that pair, and the surface rendering
 * them resolves it — from the row itself where the DTO carries a category, otherwise through
 * {@link import('./use-work-status').useWorkStatus}.
 *
 * There is deliberately no per-status colour anywhere here: two statuses in the same category are
 * the same colour, because the colour means "this is in progress", not "this is called Building".
 */
import type { WorkStatusCategory } from '@docket/types';
import { StatusIcon } from '@docket/ui/components';
import { Badge } from '@docket/ui/primitives';
import type { CSSProperties, JSX } from 'react';

import type { FieldOption } from '@/components/views/field-catalog';

/**
 * A status reduced to what presentation needs: what it is called, and how it behaves.
 *
 * @remarks
 * A structural subset of the registry's `StatusLike`, so a workspace status satisfies it directly.
 * Cycle statuses — which follow their dates rather than a workspace's set — satisfy it too, which
 * is what lets a cycle row use the same badge and glyph as everything else.
 */
export interface WorkStatusDisplay {
  /** The stored key, which identifies the status within its own set. */
  readonly key: string;
  /** The name the workspace gave it, and the only status text a person ever reads. */
  readonly name: string;
  /** The category it behaves as, which drives every glyph and colour decision. */
  readonly category: WorkStatusCategory;
}

/**
 * The badge emphasis a category earns.
 *
 * @remarks
 * Live work is the one thing a roster should pick out at a glance, so `started` takes the filled
 * default and everything else reads quiet. This replaces three copies of `status === 'active'`,
 * each of which went quiet the moment a workspace renamed its in-progress stage.
 */
function badgeVariant(category: WorkStatusCategory): 'default' | 'secondary' {
  return category === 'started' ? 'default' : 'secondary';
}

/** Props for {@link WorkStatusBadge}. */
export interface WorkStatusBadgeProps {
  /** The status name to show. */
  name: string;
  /** The category it behaves as, which sets the badge emphasis. */
  category: WorkStatusCategory;
}

/** A small badge naming a status, emphasised while the work is live. */
export function WorkStatusBadge({ name, category }: WorkStatusBadgeProps): JSX.Element {
  return <Badge variant={badgeVariant(category)}>{name}</Badge>;
}

/** Props for {@link WorkStatusIcon}. */
export interface WorkStatusIconProps {
  /** The status name, which becomes the glyph's accessible label. */
  name: string;
  /** The category it behaves as, which picks the glyph and its colour token. */
  category: WorkStatusCategory;
  /** Extra classes merged after the token colour (spacing). */
  className?: string;
  /**
   * Inline style forwarded to the glyph.
   *
   * @remarks
   * The only supported way to resize it is `--status-icon-size`; a second `size-*` class loses a
   * race with MUI's layer. See `docs/design/design-system.md`.
   */
  style?: CSSProperties;
}

/**
 * The status ring/check glyph, named by the status a workspace actually chose.
 *
 * @remarks
 * The glyph comes from the category so the vocabulary stays constant across workspaces, while the
 * accessible name is the workspace's own word for the stage — someone using a screen reader hears
 * "In review", not "started".
 */
export function WorkStatusIcon({
  name,
  category,
  className,
  style,
}: WorkStatusIconProps): JSX.Element {
  return <StatusIcon type={category} label={name} className={className} style={style} />;
}

/**
 * Read one kind of work's statuses as filter-catalog options.
 *
 * @remarks
 * The `hint` is the category, which is what a grouped header renders its glyph from — the same
 * pairing {@link WorkStatusIcon} draws, arrived at through the catalog instead of a component.
 *
 * @param statuses - The set, already in board order.
 * @returns one option per status, keyed by its stored key.
 */
export function statusFieldOptions(statuses: readonly WorkStatusDisplay[]): readonly FieldOption[] {
  return statuses.map((status) => ({
    value: status.key,
    label: status.name,
    hint: status.category,
  }));
}

/**
 * A catalog `rank` that orders status values the way the workspace ordered its set.
 *
 * @remarks
 * The set arrives sorted by category then position, so a status's index in it *is* its board rank.
 * That is the ordering the settings screen shows and the one a grouped roster reads top-to-bottom,
 * and it survives a workspace adding a sixth status between two existing ones.
 *
 * @param statuses - The set, already in board order.
 * @returns a rank function placing anything unrecognized last.
 */
export function statusRankOf(
  statuses: readonly WorkStatusDisplay[],
): (value: string | number | null) => number {
  return (value) => {
    if (value === null) return statuses.length;
    const index = statuses.findIndex((status) => status.key === String(value));
    return index === -1 ? statuses.length : index;
  };
}

/**
 * What to render for a status key the set no longer holds.
 *
 * @remarks
 * A row still renders — under its own key, in the neutral `backlog` treatment — because a status
 * that has left a set is a reason to show the row plainly rather than to hide what it says.
 *
 * @param key - The stored status key.
 * @returns a display standing in for the missing status.
 */
export function unknownStatus(key: string): WorkStatusDisplay {
  return { key, name: key, category: 'backlog' };
}
