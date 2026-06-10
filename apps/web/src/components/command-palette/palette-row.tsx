'use client';

import { CornerDownLeft } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { OrgChip } from '@/components/org-chip';

import type { PaletteItem } from './types';

/** Human labels for each search-hit entity kind, shown as the trailing kind tag. */
const HIT_TYPE_LABEL: Record<NonNullable<PaletteItem['hitType']>, string> = {
  task: 'Task',
  project: 'Project',
  program: 'Program',
};

/** Props for {@link PaletteRow}. */
export interface PaletteRowProps {
  /** The command this row represents. */
  item: PaletteItem;
  /** Whether this row is the keyboard-active row (highlighted; shows the return hint). */
  active: boolean;
  /** Stable element id, so the input's `aria-activedescendant` can point at the active row. */
  rowId: string;
  /** Select this row (mouse click). */
  onSelect: () => void;
  /** Mark this row active on hover, so mouse + keyboard share one active row. */
  onHover: () => void;
}

/**
 * A single selectable row in the command palette list.
 *
 * @remarks
 * Rendered as an ARIA `option` (the list is a `listbox`), so the palette input can own focus
 * while `aria-activedescendant` tracks the active row for screen readers. Carries the
 * command's glyph + label, an optional org chip (for org-chipped commands and search hits),
 * a trailing entity-kind tag for search results, and a return-key affordance when active.
 * Hover and keyboard share a single active row, so the highlight never desyncs.
 */
export function PaletteRow({
  item,
  active,
  rowId,
  onSelect,
  onHover,
}: PaletteRowProps): JSX.Element {
  const Icon = item.icon;
  return (
    <li
      id={rowId}
      role="option"
      aria-selected={active}
      onClick={onSelect}
      onMouseMove={onHover}
      className={cn(
        'text-body flex cursor-pointer items-center gap-3 rounded-md px-3 py-2',
        active ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-4 shrink-0', active ? 'text-on-surface' : 'text-on-surface-variant')}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>

      {item.org ? <OrgChip orgId={item.org.id} name={item.org.name} /> : null}

      {item.hitType ? (
        <span className="text-on-surface-variant border-outline-variant shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium">
          {HIT_TYPE_LABEL[item.hitType]}
        </span>
      ) : item.hint ? (
        <span className="text-on-surface-variant shrink-0 text-xs">{item.hint}</span>
      ) : null}

      {active ? (
        <CornerDownLeft aria-hidden="true" className="text-on-surface-variant size-3.5 shrink-0" />
      ) : null}
    </li>
  );
}
