'use client';

import { CornerDownLeft, type LucideIcon } from '@docket/ui/icons';
import { MENU_METRICS, menuBadge, menuItemClass, menuTrailingText } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { isValidElement, type JSX } from 'react';

import { OrgChip } from '@/components/org-chip';

import type { PaletteItem } from './types';
import { SEARCH_KIND_LABEL } from './use-hub-search';

/**
 * Render a row's leading glyph.
 *
 * @remarks
 * `PaletteItem.icon` is either a `LucideIcon` component reference (every search hit, static
 * command, and org switch) or an already-rendered node (the `#` label mode's own color swatch).
 * `typeof icon === 'function'` cannot tell these apart on its own: the icon components this app
 * re-exports (`@docket/ui/icons`, backed by `@mui/icons-material`) are `forwardRef`/`memo`-wrapped,
 * so they are `object`s at runtime, not bare functions — and passing that wrapper object straight
 * to React as a child (instead of instantiating it) throws "Objects are not valid as a React
 * child". `isValidElement` is the reliable discriminant instead: a wrapped icon component is not a
 * React element (it is a component *type*), while the swatch already is one.
 */
function paletteIcon(icon: PaletteItem['icon']): JSX.Element {
  if (icon != null && !isValidElement(icon)) {
    const Icon = icon as LucideIcon;
    return <Icon aria-hidden="true" className="shrink-0" />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center', MENU_METRICS.iconBox)}
    >
      {icon}
    </span>
  );
}

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
  return (
    <li
      id={rowId}
      role="option"
      aria-selected={active}
      onClick={onSelect}
      onMouseMove={onHover}
      className={cn(
        // A palette row is a menu row.
        menuItemClass('standard'),
        'cursor-pointer',
        // The palette drives its own highlight from `aria-activedescendant`, not from focus, so
        // the active row applies the spec's focus layer directly.
        { 'bg-on-surface/10': active },
      )}
    >
      {paletteIcon(item.icon)}
      <span className="flex min-w-0 flex-1 flex-col items-start py-0.5">
        <span className="w-full truncate">{item.label}</span>
        {item.breadcrumb && item.breadcrumb.length > 0 ? (
          <span className="text-on-surface-variant text-label-small w-full truncate">
            {item.breadcrumb.join(' › ')}
          </span>
        ) : null}
      </span>

      {item.org ? <OrgChip orgId={item.org.id} name={item.org.name} /> : null}

      {item.source ? (
        <span className={cn(menuBadge('standard'), 'bg-surface-container ml-0')}>
          {item.source}
        </span>
      ) : null}

      {item.kindLabel ? (
        <span className={cn(menuBadge('standard'), 'border-outline-variant ml-0 border')}>
          {item.kindLabel}
        </span>
      ) : item.hitType ? (
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
