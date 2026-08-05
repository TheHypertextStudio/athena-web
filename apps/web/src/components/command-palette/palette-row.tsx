'use client';

import { CornerDownLeft } from '@docket/ui/icons';
import { menuBadge, menuItemClass, menuTrailingText } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { OrgChip } from '@/components/org-chip';

import type { PaletteItem } from './types';
import { SEARCH_KIND_LABEL } from './use-hub-search';

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
        // A palette row is a menu row. It used to be its own recipe — 12px padding against the
        // menu's 16dp, 16px icons against 20dp, and `surface-container-highest` for the active
        // row instead of a state layer — which is the drift this collapses.
        menuItemClass('standard'),
        'cursor-pointer',
        // The palette drives its own highlight from `aria-activedescendant`, not from focus, so
        // the active row applies the spec's focus layer directly.
        { 'bg-on-surface/10': active },
      )}
    >
      <Icon aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>

      {item.org ? <OrgChip orgId={item.org.id} name={item.org.name} /> : null}

      {item.source ? (
        <span className={cn(menuBadge('standard'), 'bg-surface-container ml-0')}>
          {item.source}
        </span>
      ) : null}

      {item.hitType ? (
        <span className={cn(menuBadge('standard'), 'border-outline-variant ml-0 border')}>
          {SEARCH_KIND_LABEL[item.hitType]}
        </span>
      ) : item.hint ? (
        <span className={cn(menuTrailingText('standard'), 'ml-0 shrink-0')}>{item.hint}</span>
      ) : null}

      {active ? (
        <CornerDownLeft aria-hidden="true" className="text-on-surface-variant shrink-0" />
      ) : null}
    </li>
  );
}
